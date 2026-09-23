import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { windowResolver } from '../../src/main/permissions/registry'
import { createPatchSync } from '../../src/main/store/ipc-sync'
import type { ChatPatchBatch } from '../../src/shared/chat'
import type { AccountView } from '../../src/shared/ipc'
import { sdk } from '../fakes/fake-engine'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let office: ReturnType<typeof openOffice>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-permissions-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  office = openOffice(dir)
})

afterEach(() => {
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

const bashRule = (command: string): PermissionUpdate[] => [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: command }], behavior: 'allow', destination: 'localSettings' }]

function working(prompt?: string, account?: string) {
  const id = office.start(prompt, account)
  office.engine.init(id)
  return id
}

const requests = (id: string) => office.chat(id).pendingRequests

describe('permission broker', () => {
  it('allow once resolves the SDK callback with allow and the chat returns to Working', async () => {
    const id = working()
    const decision = office.engine.ask(id, 'Bash', { command: 'pnpm test' }, { suggestions: bashRule('pnpm test') })

    expect(office.chat(id)).toMatchObject({ state: 'needs-you', pending: [{ toolName: 'Bash' }] })
    const [request] = requests(id)
    expect(request).toMatchObject({ tool: 'Bash', summary: 'pnpm test', input: { command: 'pnpm test' }, dangerous: false, alwaysAllow: true })
    expect(office.chat(id).oldestPendingAt).toBe(request!.createdAt)

    expect(office.broker.resolveRequest(request!.id, { kind: 'allow' }, 'inbox')).toEqual({ ok: true })
    expect(await decision).toEqual({ behavior: 'allow', updatedInput: { command: 'pnpm test' } })
    expect(office.chat(id)).toMatchObject({ state: 'working', pendingRequests: [], oldestPendingAt: undefined })
    expect(office.rules.list()).toEqual([])
  })

  it('deny passes the message back to Claude', async () => {
    const id = working()
    const decision = office.engine.ask(id, 'Bash', { command: 'pnpm build' })
    office.broker.resolveRequest(requests(id)[0]!.id, { kind: 'deny', message: 'Run the tests first' }, 'chat')
    expect(await decision).toEqual({ behavior: 'deny', message: 'Run the tests first' })
  })

  it('two pending requests in one chat resolve independently, oldest first', async () => {
    vi.useFakeTimers({ now: 1_000 })
    const id = working()
    const first = office.engine.ask(id, 'Bash', { command: 'pnpm lint' })
    vi.setSystemTime(2_000)
    const second = office.engine.ask(id, 'Edit', { file_path: join(dir, 'a.ts') })

    expect(requests(id).map((request) => [request.tool, request.createdAt])).toEqual([
      ['Bash', 1_000],
      ['Edit', 2_000],
    ])
    expect(office.chat(id).oldestPendingAt).toBe(1_000)

    const [lint, edit] = requests(id)
    office.broker.resolveRequest(edit!.id, { kind: 'deny' }, 'chat')
    expect(await second).toMatchObject({ behavior: 'deny' })
    expect(office.chat(id)).toMatchObject({ state: 'needs-you', oldestPendingAt: 1_000 })

    office.broker.resolveRequest(lint!.id, { kind: 'allow' }, 'chat')
    expect(await first).toMatchObject({ behavior: 'allow' })
    expect(office.chat(id).state).toBe('working')
  })

  it('answers from the notification and the chat within milliseconds run the tool once', async () => {
    const id = working()
    let runs = 0
    const decision = office.engine.ask(id, 'Bash', { command: 'pnpm test' }).then((result) => {
      if (result?.behavior === 'allow') runs++
      return result
    })
    const requestId = requests(id)[0]!.id

    expect(office.broker.resolveRequest(requestId, { kind: 'allow' }, 'notification')).toEqual({ ok: true })
    expect(office.broker.resolveRequest(requestId, { kind: 'allow' }, 'chat')).toEqual({ error: 'already answered (notification)' })
    expect(office.broker.resolveRequest(requestId, { kind: 'deny' }, 'phone')).toEqual({ error: 'already answered (notification)' })
    await decision
    expect(runs).toBe(1)
    expect(office.db.sql.prepare("select count(*) as n from waits where kind = 'request'").get()).toEqual({ n: 1 })
  })

  it('resolving a request whose session died returns "session ended", and the chat shows Stuck', async () => {
    const id = working()
    const decision = office.engine.ask(id, 'Bash', { command: 'pnpm test' })
    const requestId = requests(id)[0]!.id
    office.engine.exit(id, 'Claude Code process exited with code 1')

    expect(office.broker.resolveRequest(requestId, { kind: 'allow' }, 'chat')).toEqual({ error: 'session ended' })
    expect(office.chat(id)).toMatchObject({ state: 'stuck', stuck: { reason: 'crashed' }, pendingRequests: [] })
    expect(await decision).toMatchObject({ behavior: 'deny' })
  })

  it('a request whose process vanished without an exit event also ends the chat', () => {
    const id = working()
    void office.engine.ask(id, 'Bash', { command: 'pnpm test' })
    const requestId = requests(id)[0]!.id
    office.engine.stop(id)

    expect(office.broker.resolveRequest(requestId, { kind: 'allow' }, 'chat')).toEqual({ error: 'session ended' })
    expect(office.chat(id)).toMatchObject({ state: 'stuck', stuck: { reason: 'interrupted' } })
  })

  it('approving ExitPlanMode switches the session back to Auto mode; rejecting keeps planning', async () => {
    const id = working()
    await office.engine.setPermissionMode(id, 'plan')
    const rejected = office.engine.ask(id, 'ExitPlanMode', { plan: '1. Fix the bid flow' })
    expect(requests(id)[0]).toMatchObject({ tool: 'ExitPlanMode', summary: 'Plan ready for review', input: { plan: '1. Fix the bid flow' } })
    office.broker.resolveRequest(requests(id)[0]!.id, { kind: 'deny', message: 'Add tests to the plan' }, 'chat')
    expect(await rejected).toEqual({ behavior: 'deny', message: 'Add tests to the plan' })
    expect(office.engine.calls).toEqual([`setPermissionMode:${id}:plan`])

    const approved = office.engine.ask(id, 'ExitPlanMode', { plan: '1. Fix the bid flow\n2. Add tests' })
    office.broker.resolveRequest(requests(id)[0]!.id, { kind: 'allow' }, 'chat')
    expect(await approved).toMatchObject({ behavior: 'allow' })
    expect(office.engine.calls.at(-1)).toBe(`setPermissionMode:${id}:auto`)
    expect(office.chat(id).state).toBe('working')
  })

  it('plan approval restores the mode the chat was in before planning, not always Auto', async () => {
    const id = office.start()
    office.engine.emit(id, sdk.init(office.engine.sessionId(id)!, 'claude-fake-1', 'acceptEdits'))
    expect(office.chat(id).permissionMode).toBe('acceptEdits')
    office.engine.emit(id, sdk.status('plan'))
    expect(office.chat(id).permissionMode).toBe('plan')

    const approved = office.engine.ask(id, 'ExitPlanMode', { plan: '1. Fix the bid flow' })
    office.broker.resolveRequest(requests(id)[0]!.id, { kind: 'allow' }, 'chat')
    expect(await approved).toMatchObject({ behavior: 'allow' })
    expect(office.engine.calls.at(-1)).toBe(`setPermissionMode:${id}:acceptEdits`)
    expect(office.chat(id).permissionMode).toBe('acceptEdits')

    await office.store.setPlanMode(id, true)
    expect(office.engine.calls.at(-1)).toBe(`setPermissionMode:${id}:plan`)
    await office.store.setPlanMode(id, false)
    expect(office.engine.calls.at(-1)).toBe(`setPermissionMode:${id}:acceptEdits`)
  })

  it('records where each request was answered, so the chat can say so', () => {
    const id = working()
    void office.engine.ask(id, 'Bash', { command: 'pnpm test' })
    void office.engine.ask(id, 'Bash', { command: 'pnpm lint' })
    const [first, second] = requests(id)
    office.broker.resolveRequest(first!.id, { kind: 'allow' }, 'phone')
    office.broker.resolveRequest(second!.id, { kind: 'deny', message: 'Not now' }, 'chat')
    expect(office.chat(id).answered).toEqual([
      { id: first!.id, source: 'phone', decision: 'allow' },
      { id: second!.id, source: 'chat', decision: 'deny' },
    ])
  })

  it('answers AskUserQuestion through updatedInput', async () => {
    const id = working()
    const questions = [{ question: 'Which date library?', header: 'Library', multiSelect: false, options: [{ label: 'date-fns', description: '' }, { label: 'dayjs', description: '' }] }]
    const decision = office.engine.ask(id, 'AskUserQuestion', { questions })
    const request = requests(id)[0]!
    expect(request.summary).toBe('Which date library?')

    expect(office.broker.resolveRequest(request.id, { kind: 'allow' }, 'chat')).toEqual({ error: 'That answer doesn’t fit this request.' })
    expect(office.broker.resolveRequest(request.id, { kind: 'answer', answers: { 'Which date library?': 'dayjs' } }, 'chat')).toEqual({ ok: true })
    expect(await decision).toEqual({ behavior: 'allow', updatedInput: { questions, answers: { 'Which date library?': 'dayjs' } } })
  })

  it('an interrupt that cancels the request drops it from the queue', async () => {
    const id = working()
    const abort = new AbortController()
    const decision = office.engine.ask(id, 'Bash', { command: 'pnpm test' }, { signal: abort.signal })
    const requestId = requests(id)[0]!.id
    abort.abort()

    expect(await decision).toMatchObject({ behavior: 'deny' })
    expect(office.chat(id)).toMatchObject({ state: 'working', pendingRequests: [] })
    expect(office.broker.resolveRequest(requestId, { kind: 'allow' }, 'chat')).toEqual({ error: 'cancelled' })
  })

  it('refuses malformed decisions and unknown ids', () => {
    const id = working()
    void office.engine.ask(id, 'Bash', { command: 'pnpm test' })
    const requestId = requests(id)[0]!.id
    expect(office.broker.resolveRequest(requestId, { kind: 'bypass' }, 'chat')).toEqual({ error: 'Unknown request.' })
    expect(office.broker.resolveRequest(requestId, { kind: 'answer', answers: { q: 1 } }, 'chat')).toEqual({ error: 'Unknown request.' })
    expect(office.broker.resolveRequest('nope', { kind: 'allow' }, 'chat')).toEqual({ error: 'Unknown request.' })
    expect(office.broker.resolveRequest(requestId, { kind: 'allow' }, 'somewhere')).toEqual({ error: 'Unknown request.' })
    expect(office.chat(id).state).toBe('needs-you')
  })
})

describe('approval sources', () => {
  it('rejects a keyboard approval while the window is unfocused and accepts it when focused', async () => {
    const id = working()
    let focused = false
    const fromWindow = windowResolver(office.broker, () => focused)
    const decision = office.engine.ask(id, 'Bash', { command: 'pnpm test' })
    const requestId = requests(id)[0]!.id

    expect(fromWindow(requestId, { kind: 'allow' }, 'keyboard')).toEqual({ error: 'Keyboard answers only count while the window is focused.' })
    expect(office.chat(id).state).toBe('needs-you')
    focused = true
    expect(fromWindow(requestId, { kind: 'allow' }, 'keyboard')).toEqual({ ok: true })
    expect(await decision).toMatchObject({ behavior: 'allow' })
  })

  it('the window can’t claim to be a notification or the phone', () => {
    const id = working()
    void office.engine.ask(id, 'Bash', { command: 'pnpm test' })
    const fromWindow = windowResolver(office.broker, () => false)
    expect(fromWindow(requests(id)[0]!.id, { kind: 'allow' }, 'notification')).toEqual({ error: 'Unknown request.' })
    expect(fromWindow(requests(id)[0]!.id, { kind: 'allow' }, 'phone')).toEqual({ error: 'Unknown request.' })
  })

  it('accepts a notification approval for a non-dangerous request', async () => {
    const id = working()
    const decision = office.engine.ask(id, 'Bash', { command: 'pnpm test' })
    expect(office.broker.resolveRequest(requests(id)[0]!.id, { kind: 'allow' }, 'notification')).toEqual({ ok: true })
    expect(await decision).toMatchObject({ behavior: 'allow' })
  })

  it('a dangerous request needs a click: keys, notifications and the phone can only deny it', async () => {
    const id = working()
    const decision = office.engine.ask(id, 'Bash', { command: 'rm -rf dist' }, { suggestions: bashRule('rm -rf dist') })
    const request = requests(id)[0]!
    expect(request).toMatchObject({ dangerous: true, dangerReason: 'Deletes files recursively without asking (rm -rf)', alwaysAllow: false })

    const fromWindow = windowResolver(office.broker, () => true)
    for (const source of ['notification', 'phone'] as const) expect(office.broker.resolveRequest(request.id, { kind: 'allow' }, source)).toEqual({ error: 'Dangerous requests need a click in the app.' })
    expect(fromWindow(request.id, { kind: 'allow' }, 'keyboard')).toEqual({ error: 'Dangerous requests need a click in the app.' })
    expect(fromWindow(request.id, { kind: 'always' }, 'chat')).toEqual({ error: 'Always allow isn’t offered for this request.' })
    expect(fromWindow(request.id, { kind: 'allow' }, 'chat')).toEqual({ ok: true })
    expect(await decision).toMatchObject({ behavior: 'allow' })

    const second = office.engine.ask(id, 'Bash', { command: 'git push --force' })
    expect(office.broker.resolveRequest(requests(id)[0]!.id, { kind: 'deny' }, 'notification')).toEqual({ ok: true })
    expect(await second).toMatchObject({ behavior: 'deny' })
  })
})

describe('account gating', () => {
  it('refuses new turns on an account that needs login, with a typed error', () => {
    const id = working()
    office.engine.emit(id, sdk.result())
    const stuckOne = working('Other')
    office.engine.exit(stuckOne, 'Failed to authenticate. API Error: 401')
    office.loggedOut.add('main')
    const refusal = { error: expect.stringContaining('needs a new login'), code: 'needs-login' }

    expect(office.store.start('main', dir, 'New work')).toEqual(refusal)
    expect(office.store.sendMessage(id, 'One more thing')).toEqual(refusal)
    expect(office.store.resumeChat(stuckOne)).toEqual(refusal)
    expect(office.engine.sent.map((sent) => sent.text)).toEqual(['Fix the bid flow', 'Other'])
    expect(office.store.start('research', dir, 'Research work')).toMatchObject({ chatId: expect.any(String) })

    office.loggedOut.delete('main')
    expect(office.store.resumeChat(stuckOne)).toBeUndefined()
    expect(office.chat(stuckOne).state).toBe('working')
  })

  it('exposes one grouped queue item per account that needs login, in the snapshot and in patches', () => {
    vi.useFakeTimers()
    const pushed: ChatPatchBatch[] = []
    const sync = createPatchSync(office.store, (batch) => pushed.push(batch))
    const account = (id: string, status: 'ok' | 'needs-login'): AccountView => ({ id, label: id, createdAt: 0, health: { status } })
    for (const prompt of ['One', 'Two', 'Three']) office.engine.exit(working(prompt), 'Failed to authenticate. API Error: 401')

    sync.setAccounts([account('main', 'needs-login'), account('research', 'ok')])
    expect(sync.snapshot().logins).toEqual([{ accountId: 'main', label: 'main' }])

    sync.setAccounts([account('main', 'needs-login'), account('research', 'needs-login')])
    vi.advanceTimersByTime(16)
    expect(pushed.at(-1)?.logins).toEqual([
      { accountId: 'main', label: 'main' },
      { accountId: 'research', label: 'research' },
    ])

    pushed.length = 0
    sync.setAccounts([account('main', 'needs-login'), account('research', 'needs-login')])
    vi.advanceTimersByTime(16)
    expect(pushed).toEqual([])
  })
})
