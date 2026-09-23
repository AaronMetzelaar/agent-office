import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { doingNow, usageByAccount } from '../../src/shared/chat'
import { sdk } from '../fakes/fake-engine'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let office: ReturnType<typeof openOffice>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-chats-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  office = openOffice(dir)
})

afterEach(() => {
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function working(prompt?: string, account?: string) {
  const id = office.start(prompt, account)
  office.engine.init(id)
  return id
}

const caption = (id: string) => doingNow(office.chat(id), Date.now())

describe('chat store', () => {
  it('goes Starting → Working → Done, then Done → Idle when read, and Idle → Working on send', () => {
    const { engine, store, chat } = office
    const id = office.start('Fix the bid flow')
    expect(chat(id)).toMatchObject({ state: 'starting', title: 'Fix the bid flow', rows: [{ kind: 'user', text: 'Fix the bid flow' }] })
    expect(engine.starts[0]?.options).toMatchObject({ accountId: 'main', cwd: dir, resume: undefined })
    expect(engine.sent).toEqual([{ chatId: id, text: 'Fix the bid flow' }])

    engine.init(id)
    expect(chat(id)).toMatchObject({ state: 'working', sessionId: engine.sessionId(id), model: 'claude-fake-1' })

    engine.emit(id, sdk.delta('Do'))
    engine.emit(id, sdk.delta('ne'))
    expect(chat(id).partial).toBe('Done')
    engine.emit(id, sdk.text('Done'))
    engine.emit(id, sdk.result())
    expect(chat(id)).toMatchObject({ state: 'done', unread: true, partial: '' })
    expect(chat(id).rows.map((row) => row.kind)).toEqual(['user', 'text'])

    store.markRead(id)
    expect(chat(id)).toMatchObject({ state: 'idle', unread: false })

    store.sendMessage(id, 'Now add a test')
    expect(chat(id).state).toBe('working')
    expect(engine.starts).toHaveLength(1)
    expect(engine.sent.at(-1)).toEqual({ chatId: id, text: 'Now add a test' })
  })

  it('keeps the latest cumulative usage per chat and sums it per account', () => {
    const { engine, store, chat } = office
    const first = working()
    engine.emit(first, sdk.result(100, 20, 0.01))
    store.sendMessage(first, 'again')
    engine.emit(first, sdk.result(250, 60, 0.03))
    const second = working('Other work')
    engine.emit(second, sdk.result(40, 10, 0.005))
    const third = working('Research', 'research')
    engine.emit(third, sdk.result(7, 3, 0.001))

    expect(chat(first).usage).toMatchObject({ inputTokens: 250, outputTokens: 60, costUsd: 0.03 })
    const totals = usageByAccount(store.snapshot())
    expect(totals.main).toMatchObject({ inputTokens: 290, outputTokens: 70 })
    expect(totals.main?.costUsd).toBeCloseTo(0.035)
    expect(totals.research).toMatchObject({ inputTokens: 7, outputTokens: 3 })
  })

  it('maps parallel tool calls in one turn to separate rows in order, whichever result lands first', () => {
    const { engine, chat } = office
    const id = working()
    engine.emit(id, sdk.toolUse([{ id: 't1', name: 'Read', input: { file_path: '/repo/a.ts' } }]))
    engine.emit(id, sdk.toolUse([{ id: 't2', name: 'Read', input: { file_path: '/repo/b.ts' } }]))
    engine.emit(id, sdk.toolResult('t2', 'b contents'))
    engine.emit(id, sdk.toolResult('t1', 'a contents'))

    expect(chat(id).rows.slice(1)).toEqual([
      { kind: 'tool', id: 't1', name: 'Read', input: { file_path: '/repo/a.ts' }, result: { text: 'a contents', isError: false } },
      { kind: 'tool', id: 't2', name: 'Read', input: { file_path: '/repo/b.ts' }, result: { text: 'b contents', isError: false } },
    ])
  })

  it('attaches subagent work by parent_tool_use_id and drops each subagent when it finishes', () => {
    const { engine, chat } = office
    const id = working()
    engine.emit(id, sdk.toolUse([{ id: 'a1', name: 'Agent', input: { description: 'Explore bids' } }]))
    engine.emit(id, sdk.toolUse([{ id: 'a2', name: 'Agent', input: { description: 'Explore auth', run_in_background: true } }]))
    engine.emit(id, sdk.toolUse([{ id: 'a1-read', name: 'Read', input: { file_path: '/repo/bid.ts' } }], 'a1'))
    expect(chat(id).subagents).toEqual([
      { id: 'a1', description: 'Explore bids' },
      { id: 'a2', description: 'Explore auth' },
    ])
    expect(chat(id).rows.find((row) => row.id === 'a1-read')).toMatchObject({ parentToolUseId: 'a1' })

    engine.emit(id, sdk.toolResult('a2', 'Async agent launched'))
    engine.emit(id, sdk.toolResult('a1', 'Found it'))
    expect(chat(id).subagents).toEqual([{ id: 'a2', description: 'Explore auth' }])

    engine.emit(id, sdk.taskNotification('a2'))
    expect(chat(id).subagents).toEqual([])
  })

  it('a rate limit error becomes Stuck (rate-limited) with the retry time', () => {
    const { engine, chat, accounts } = office
    const id = working()
    const info = { status: 'rejected' as const, rateLimitType: 'five_hour' as const, resetsAt: 1_790_000_000, utilization: 1 }
    engine.emit(id, sdk.rateLimit(info))
    engine.emit(id, sdk.apiError('rate_limit'))
    engine.emit(id, sdk.errorResult('You’ve hit your usage limit'))
    engine.exit(id, 'Claude Code returned an error result: You’ve hit your usage limit')

    expect(chat(id)).toMatchObject({ state: 'stuck', stuck: { reason: 'rate-limited', retryAt: 1_790_000_000_000 } })
    expect(accounts.recordHeadroom).toHaveBeenCalledWith('main', info)
  })

  it('a process exit mid-turn becomes Stuck (crashed), but an exit while idle changes nothing', () => {
    const { engine, store, chat } = office
    const id = working()
    engine.emit(id, sdk.delta('Half a'))
    engine.exit(id)
    expect(chat(id)).toMatchObject({ state: 'stuck', stuck: { reason: 'crashed', detail: 'The Claude process exited mid-turn' }, partial: '' })
    expect(chat(id).rows.at(-1)).toMatchObject({ kind: 'text', text: 'Half a' })

    const other = working('Other')
    office.engine.emit(other, sdk.result())
    store.markRead(other)
    engine.exit(other, 'Claude Code process exited with code 1')
    expect(chat(other).state).toBe('idle')
  })

  it('a thrown 401 marks the chat Stuck (needs-login) and tells the account once', () => {
    const { engine, chat, accounts } = office
    const id = working()
    engine.exit(id, 'Failed to authenticate. API Error: 401 OAuth access token is invalid')

    expect(chat(id).stuck).toEqual({ reason: 'needs-login', detail: 'Failed to authenticate. API Error: 401 OAuth access token is invalid' })
    expect(accounts.loginFailed).toHaveBeenCalledExactlyOnceWith('main')
  })

  it('an exception while handling one chat’s event marks only that chat Stuck', () => {
    const { engine, chat } = office
    const broken = working('Broken')
    const healthy = working('Healthy')
    const poison = {
      type: 'assistant',
      uuid: 'p',
      parent_tool_use_id: null,
      get message(): never {
        throw new Error('boom')
      },
    } as unknown as SDKMessage

    engine.emit(broken, poison)
    engine.emit(healthy, sdk.delta('still '))
    engine.emit(healthy, sdk.delta('going'))
    engine.emit(broken, sdk.delta('ignored'))

    expect(chat(broken)).toMatchObject({ state: 'stuck', stuck: { reason: 'crashed', detail: 'boom' } })
    expect(engine.running(broken)).toBe(false)
    expect(chat(healthy)).toMatchObject({ state: 'working', partial: 'still going' })
  })

  it('moves to Needs you with a pending request and back to Working when the last one resolves', () => {
    const { store, chat } = office
    const id = working()
    store.addPending(id, { id: 'r1', toolName: 'Bash' })
    store.addPending(id, { id: 'r2', toolName: 'Edit' })
    expect(chat(id).state).toBe('needs-you')
    expect(caption(id)).toBe('Waiting for you · Bash')

    store.resolvePending(id, 'r1')
    expect(chat(id)).toMatchObject({ state: 'needs-you', pending: [{ id: 'r2', toolName: 'Edit' }] })
    store.resolvePending(id, 'r2')
    expect(chat(id)).toMatchObject({ state: 'working', pending: [] })
  })

  it('denies and records permission requests until the broker exists', async () => {
    const id = working()
    const decision = await office.store.canUseTool(id, 'Bash', { command: 'rm -rf dist' }, { signal: new AbortController().signal, toolUseID: 'x' } as never)
    expect(decision).toMatchObject({ behavior: 'deny' })
    expect(office.chat(id).rows.at(-1)).toMatchObject({ kind: 'other', label: expect.stringContaining('Denied Bash') })
  })

  it('derives the doing-now caption from the latest events', () => {
    const { engine, store } = office
    const id = working()
    expect(caption(id)).toBe('Thinking')
    engine.emit(id, sdk.toolUse([{ id: 'e1', name: 'Edit', input: { file_path: '/repo/frontend/components/BidFlow.vue' } }]))
    expect(caption(id)).toBe('Editing BidFlow.vue')
    engine.emit(id, sdk.toolUse([{ id: 'b1', name: 'Bash', input: { command: 'pnpm test\necho done' } }]))
    expect(caption(id)).toBe('Running pnpm test')
    for (const agent of ['a1', 'a2', 'a3']) engine.emit(id, sdk.toolUse([{ id: agent, name: 'Agent', input: { description: agent } }]))
    expect(caption(id)).toBe('3 subagents exploring')
    for (const agent of ['a1', 'a2', 'a3']) engine.emit(id, sdk.toolResult(agent, 'ok'))
    engine.emit(id, sdk.result())
    expect(caption(id)).toBe('Done · ready to review')
    store.markRead(id)
    expect(doingNow(office.chat(id), Date.now() + 38 * 60_000)).toBe('Idle 38m')
  })

  it('an interrupted turn ends Done, not Stuck', async () => {
    const { engine, store, chat } = office
    const id = working()
    await store.interruptChat(id)
    engine.emit(id, sdk.errorResult('[Request interrupted by user]'))
    expect(engine.calls).toContain(`interrupt:${id}`)
    expect(chat(id).state).toBe('done')
  })

  it('model and effort changes persist and reach the running session', async () => {
    const { engine, store, chat } = office
    const id = working()
    await store.setModel(id, 'sonnet')
    await store.setEffort(id, 'high')
    await store.setEffort(id, 'turbo')
    expect(engine.calls).toEqual([`setModel:${id}:sonnet`, `setEffort:${id}:high`])
    expect(chat(id)).toMatchObject({ model: 'sonnet', effort: 'high' })
    expect(office.db.listChats()[0]).toMatchObject({ model: 'sonnet', effort: 'high' })
  })

  it('refuses a start with an unknown account, a missing folder or no prompt', () => {
    const { store } = office
    expect(store.start('nobody', dir, 'hi')).toEqual({ error: 'Pick an account first.' })
    expect(store.start('main', join(dir, 'missing'), 'hi')).toEqual({ error: 'Pick an existing folder.' })
    expect(store.start('main', 'relative/path', 'hi')).toEqual({ error: 'Pick an existing folder.' })
    expect(store.start('main', dir, '   ')).toEqual({ error: 'Write a prompt first.' })
    expect(store.start('main', dir, 'hi', 'opus; rm -rf', undefined)).toEqual({ error: 'That model name isn’t valid.' })
    expect(store.snapshot()).toEqual([])
  })

  it('removing an account makes its chats Stuck (needs-login) and stops their sessions', () => {
    const { engine, store, chat } = office
    const mine = working()
    const theirs = working('Research', 'research')
    store.accountRemoved('main')
    expect(chat(mine).stuck?.reason).toBe('needs-login')
    expect(engine.running(mine)).toBe(false)
    expect(chat(theirs).state).toBe('working')
  })
})
