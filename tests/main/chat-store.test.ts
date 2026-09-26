import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { doingNow, usageByAccount } from '../../src/shared/chat'
import { palette, hexOf } from '../../src/shared/office'
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

  it('refuses attachments it can’t send, so the composer keeps the message', () => {
    const { engine, store, chat } = office
    const id = working('Fix the bid flow')
    engine.emit(id, sdk.result())
    const rows = chat(id).rows.length
    expect(store.sendMessage(id, 'Look at these', 'nope')).toMatchObject({ error: expect.stringContaining('attachments') })
    expect(chat(id).rows).toHaveLength(rows)
    expect(engine.sent.at(-1)?.text).toBe('Fix the bid flow')
  })

  it('holds the predicted next prompt until the user sends something', () => {
    const { engine, store, chat } = office
    const id = working('Fix the bid flow')
    engine.emit(id, sdk.result())
    engine.emit(id, { type: 'prompt_suggestion', suggestion: 'Run the tests', uuid: 'u', session_id: 's' } as unknown as SDKMessage)
    expect(chat(id).suggestion).toBe('Run the tests')
    store.sendMessage(id, 'Ship it')
    expect(chat(id).suggestion).toBeUndefined()
  })

  it('sends each message under its row id, so file checkpoints line up with the transcript', () => {
    const { engine, store, chat } = office
    const id = working('Fix the bid flow')
    engine.emit(id, sdk.result())
    store.sendMessage(id, 'Now add a test')
    const userRows = chat(id).rows.filter((row) => row.kind === 'user').map((row) => row.id)
    expect(engine.sentIds).toEqual(userRows)
  })

  it('stops one subagent by its task, and keeps background subagents running when the turn is interrupted', async () => {
    const { engine, store, chat } = office
    const id = working()
    engine.emit(id, sdk.toolUse([{ id: 'b1', name: 'Agent', input: { description: 'Scan bids' } }]))
    engine.emit(id, sdk.taskStarted('b1'))
    engine.emit(id, sdk.toolResult('b1', 'Async agent launched'))
    await store.stopTask(id, 'b1')
    await store.stopTask(id, 'nobody')
    expect(engine.calls.filter((call) => call.startsWith('stopTask'))).toEqual([`stopTask:${id}:t`])

    await store.interruptChat(id)
    engine.emit(id, sdk.errorResult('[Request interrupted by user]'))
    expect(chat(id)).toMatchObject({ state: 'working', subagents: [{ id: 'b1', description: 'Scan bids' }] })
    engine.emit(id, sdk.taskNotification('b1'))
    await store.stopTask(id, 'b1')
    expect(engine.calls.filter((call) => call.startsWith('stopTask'))).toHaveLength(1)
  })

  it('measures the context window after each turn, and keeps it out of the saved chat', async () => {
    const { engine, chat } = office
    const id = working()
    engine.emit(id, sdk.result())
    await vi.waitFor(() => expect(chat(id).context).toEqual({ tokens: 42_000, max: 200_000, percent: 21 }))
    expect(office.db.listChats()[0]).not.toHaveProperty('context')
  })

  it('previews and restores files from before a message, but not mid-turn or for a message elsewhere', async () => {
    const { engine, store, chat } = office
    const id = working('Fix the bid flow')
    const first = chat(id).rows[0]!.id
    expect(await store.rewindFiles(id, first, true)).toMatchObject({ canRewind: false, error: expect.stringContaining('finish') })
    engine.emit(id, sdk.result())
    expect(await store.rewindFiles(id, 'elsewhere', true)).toMatchObject({ canRewind: false })

    expect(await store.rewindFiles(id, first, true)).toEqual({ canRewind: true, files: 2, insertions: 3, deletions: 7 })
    expect(chat(id).rows.at(-1)?.kind).not.toBe('other')
    await store.rewindFiles(id, first, false)
    expect(engine.calls.filter((call) => call.startsWith('rewind'))).toEqual([`rewind:${id}:${first}:dry`, `rewind:${id}:${first}:real`])
    expect(chat(id).rows.at(-1)).toMatchObject({ kind: 'other', label: expect.stringContaining('Restored') })
  })

  it('titles a chat by its topic once the model names it, and keeps a title it was given', async () => {
    const { engine, store, chat } = office
    engine.topics.push('Bid flow rounding bug', 'Ignored')
    const id = office.start('Currently the bid flow rounds 10.005 down, can you look at why that happens')
    expect(chat(id).title).toBe('Currently the bid flow rounds 10.005 down, can you look at w')
    const named = store.start('main', dir, 'Work on the ticket', undefined, undefined, { title: 'MWS-1 Fix bids' })
    await new Promise((done) => setTimeout(done, 0))
    expect(chat(id).title).toBe('Bid flow rounding bug')
    expect('chatId' in named && chat(named.chatId).title).toBe('MWS-1 Fix bids')
    office.db.close()
    office = openOffice(dir)
    expect(office.chat(id).title).toBe('Bid flow rounding bug')
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
    engine.emit(id, sdk.toolUse([{ id: 'a2', name: 'Agent', input: { description: 'Explore auth' } }]))
    engine.emit(id, sdk.taskStarted('a2'))
    engine.emit(id, sdk.toolUse([{ id: 'a1-read', name: 'Read', input: { file_path: '/repo/bid.ts' } }], 'a1'))
    expect(chat(id).subagents).toEqual([
      { id: 'a1', description: 'Explore bids', activity: 'Reading bid.ts' },
      { id: 'a2', description: 'Explore auth' },
    ])
    expect(chat(id).rows.find((row) => row.id === 'a1-read')).toMatchObject({ parentToolUseId: 'a1' })

    engine.emit(id, sdk.toolResult('a2', 'Async agent launched'))
    engine.emit(id, sdk.toolResult('a1', 'Found it'))
    expect(chat(id).subagents).toEqual([{ id: 'a2', description: 'Explore auth' }])

    engine.emit(id, sdk.taskNotification('a2'))
    expect(chat(id).subagents).toEqual([])
  })

  it('stays Working while background subagents run past the main turn, and shows what each is doing', () => {
    const { engine, chat } = office
    const id = working()
    engine.emit(id, sdk.toolUse([{ id: 'b1', name: 'Agent', input: { description: 'Scan bids' } }]))
    engine.emit(id, sdk.taskStarted('b1'))
    engine.emit(id, sdk.toolUse([{ id: 'b2', name: 'Agent', input: { description: 'Scan auth' } }]))
    engine.emit(id, sdk.taskStarted('b2'))
    engine.emit(id, sdk.toolResult('b1', 'Async agent launched'))
    engine.emit(id, sdk.toolResult('b2', 'Async agent launched'))
    engine.emit(id, sdk.result())
    expect(chat(id)).toMatchObject({ state: 'working', unread: false })
    expect(caption(id)).toBe('2 subagents exploring')

    engine.emit(id, sdk.toolUse([{ id: 'b1-read', name: 'Read', input: { file_path: '/repo/bid.ts' } }], 'b1'))
    engine.emit(id, sdk.taskProgress('b2', 'Tracing the login flow'))
    expect(chat(id).subagents).toEqual([
      { id: 'b1', description: 'Scan bids', activity: 'Reading bid.ts' },
      { id: 'b2', description: 'Scan auth', activity: 'Tracing the login flow' },
    ])

    engine.emit(id, sdk.taskNotification('b1'))
    engine.emit(id, sdk.taskNotification('b2'))
    engine.emit(id, sdk.text('Both scans are in'))
    engine.emit(id, sdk.result())
    expect(chat(id)).toMatchObject({ state: 'done', subagents: [] })
  })

  it('stays Working while a background shell task runs past the main turn', () => {
    const { engine, chat } = office
    const id = working()
    engine.emit(id, sdk.backgroundTasks({}, { ambient: true }))
    engine.emit(id, sdk.result())
    expect(chat(id)).toMatchObject({ state: 'working', unread: false })
    expect(caption(id)).toBe('Waiting on background tasks')

    engine.emit(id, sdk.backgroundTasks({ ambient: true }))
    engine.emit(id, sdk.result())
    expect(chat(id).state).toBe('done')
  })

  it('lists background commands, but not subagents, so each can be stopped on its own', async () => {
    const { engine, store, chat } = office
    const id = working()
    engine.emit(id, sdk.backgroundTasks({ description: 'pnpm dev' }, { task_type: 'local_agent', description: 'Scan bids' }, { ambient: true }))
    expect(chat(id).backgroundJobs).toEqual([{ id: 't0', description: 'pnpm dev' }])
    await store.stopTask(id, 't0')
    await store.stopTask(id, 't1')
    expect(engine.calls.filter((call) => call.startsWith('stopTask'))).toEqual([`stopTask:${id}:t0`])

    engine.emit(id, sdk.backgroundTasks())
    expect(chat(id).backgroundJobs).toEqual([])
    expect(office.db.listChats()[0]).not.toHaveProperty('backgroundJobs')
  })

  it('wakes a Done agent back to Working when it resumes on its own', () => {
    const { engine, chat } = office
    const id = working()
    engine.emit(id, sdk.result())
    expect(chat(id).state).toBe('done')
    engine.emit(id, sdk.toolUse([{ id: 'r1', name: 'Read', input: { file_path: '/repo/a.ts' } }]))
    expect(chat(id)).toMatchObject({ state: 'working', unread: false, activity: 'Reading a.ts' })
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
    const request = (requestId: string, tool: string, createdAt: number) => ({ id: requestId, tool, summary: tool, input: {}, createdAt, dangerous: false, alwaysAllow: false })
    store.addPending(id, request('r1', 'Bash', 100))
    store.addPending(id, request('r2', 'Edit', 200))
    expect(chat(id)).toMatchObject({ state: 'needs-you', oldestPendingAt: 100 })
    expect(caption(id)).toBe('Waiting for you · Bash')

    store.resolvePending(id, 'r1')
    expect(chat(id)).toMatchObject({ state: 'needs-you', pending: [{ id: 'r2', toolName: 'Edit' }], pendingRequests: [{ id: 'r2' }], oldestPendingAt: 200 })
    store.resolvePending(id, 'r2')
    expect(chat(id)).toMatchObject({ state: 'working', pending: [], pendingRequests: [], oldestPendingAt: undefined })
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

  it('resumes only the chats stuck on login once their account logs in again', () => {
    const { engine, store, chat } = office
    const expired = working()
    const crashed = working('Crashed')
    const theirs = working('Research', 'research')
    engine.exit(expired, 'Failed to authenticate. API Error: 401 OAuth access token is invalid')
    engine.exit(crashed, 'Claude Code process exited with code 1')
    engine.exit(theirs, 'Failed to authenticate. API Error: 401 OAuth access token is invalid')

    store.loginFixed('main')

    expect(chat(expired).state).toBe('working')
    expect(chat(crashed).stuck?.reason).toBe('crashed')
    expect(chat(theirs).stuck?.reason).toBe('needs-login')
  })

  it('gives each chat a palette colour at creation, never repeats one in a department, and keeps it across a reload', () => {
    const ids = Array.from({ length: palette.length + 3 }, (_, i) => office.start(`Chat ${i}`))
    const colours = ids.map((id) => office.chat(id).colour)
    expect(colours.slice(0, palette.length)).toEqual(palette.map(hexOf))
    expect(new Set(colours.filter(Boolean)).size).toBe(palette.length)
    expect(colours.slice(palette.length)).toEqual([undefined, undefined, undefined])
    const research = office.start('In the gym', 'research')
    expect(office.chat(research).colour).toBe(hexOf(palette[0]))

    office.db.close()
    office = openOffice(dir)
    expect(ids.map((id) => office.chat(id).colour)).toEqual(colours)
  })
})
