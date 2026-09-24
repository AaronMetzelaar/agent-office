import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPatchSync } from '../../src/main/store/ipc-sync'
import { stripState } from '../../src/main/tray/strip'
import { buildInbox, finishedOf } from '../../src/renderer/state/inbox'
import { createProjection, toAgents, type ChatSource } from '../../src/renderer/state/projection'
import { emptyUsage, type ChatPatchBatch, type ChatView } from '../../src/shared/chat'
import type { AccountView } from '../../src/shared/ipc'
import { buildQueue } from '../../src/shared/queue'
import { sdk } from '../fakes/fake-engine'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

const accounts: AccountView[] = [
  { id: 'main', label: 'main', createdAt: 0, health: { status: 'ok' } },
  { id: 'research', label: 'research', createdAt: 0, health: { status: 'ok' } },
]

let dir: string
let office: ReturnType<typeof openOffice>
let source: ChatSource & { flush(): Promise<void>; batches: number }

beforeEach(() => {
  vi.useFakeTimers()
  dir = mkdtempSync(join(tmpdir(), 'agent-office-inbox-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  office = openOffice(dir)
  const listeners = new Set<(batch: ChatPatchBatch) => void>()
  const sync = createPatchSync(office.store, (batch) => {
    source.batches++
    listeners.forEach((listener) => listener(batch))
  })
  sync.setVisible(true)
  source = {
    batches: 0,
    getSnapshot: async () => sync.snapshot(),
    onChatPatches: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    flush: async () => void (await vi.advanceTimersByTimeAsync(20)),
  }
})

afterEach(() => {
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

const inboxOf = (projection: ReturnType<typeof createProjection>) => {
  const agents = toAgents(projection.chats.values(), accounts, Date.now(), new Map())
  return { agents, inbox: buildInbox(projection.chats, agents, projection.logins) }
}

function view(id: string, fields: Partial<ChatView> = {}): ChatView {
  const now = Date.now()
  return { id, accountId: 'main', cwd: '/Users/a/Documents/GitHub/monorepo/frontend/marketplace', title: id, archived: false, state: 'working', stateSince: now, unread: false, activity: 'Thinking', pending: [], pendingRequests: [], subagents: [], usage: emptyUsage(), partial: '', createdAt: now, lastActivityAt: now, rows: [], ...fields }
}

describe('inbox', () => {
  it('a new pending request appears in the inbox, the door queue and the tray count within one store diff', async () => {
    const projection = createProjection(source)
    await projection.ready
    const id = office.start('Run the tests')
    office.engine.init(id)
    await source.flush()
    expect(inboxOf(projection).inbox.waiting).toEqual([])

    const before = source.batches
    const command = 'pnpm test --filter marketplace -- --reporter=verbose --coverage --run tests/components/BidFlow.test.ts'
    void office.engine.ask(id, 'Bash', { command })
    await source.flush()

    expect(source.batches).toBe(before + 1)
    const { agents, inbox } = inboxOf(projection)
    expect(inbox.waiting).toHaveLength(1)
    expect(inbox.waiting[0]).toMatchObject({ kind: 'request', chatId: id, title: 'Run the tests', dept: 'Side projects' })
    expect(inbox.waiting[0]!.requests[0]!.summary).toBe(command)
    expect(buildQueue(agents).map((item) => item.chatId)).toEqual([id])
    expect(stripState(office.store.views(), []).needs).toBe(1)
  })

  it('lists waiting items in queue order and shows the last reply of each', async () => {
    const projection = createProjection(source)
    await projection.ready
    const first = office.start('First in line')
    office.engine.init(first)
    office.engine.emit(first, sdk.text('I looked at the flaky test.'))
    void office.engine.ask(first, 'Bash', { command: 'git status' })
    await vi.advanceTimersByTimeAsync(5)
    const second = office.start('Second in line')
    office.engine.init(second)
    void office.engine.ask(second, 'Edit', { file_path: join(dir, 'a.ts') })
    await source.flush()

    const { inbox } = inboxOf(projection)
    expect(inbox.waiting.map((item) => item.chatId)).toEqual([first, second])
    expect(inbox.waiting[0]!.lastReply).toBe('I looked at the flaky test.')
    expect(inbox.waiting[1]!.lastReply).toBeUndefined()
  })

  it('shows one login item per account and keeps its chats off the board', () => {
    const chats = new Map([
      ['a', view('a', { state: 'stuck', stuck: { reason: 'needs-login' } })],
      ['b', view('b', { state: 'stuck', stuck: { reason: 'needs-login' } })],
      ['c', view('c')],
    ])
    const agents = toAgents(chats.values(), accounts, Date.now(), new Map())
    const inbox = buildInbox(chats, agents, [{ accountId: 'main', label: 'main' }])
    expect(inbox.waiting).toMatchObject([{ kind: 'login', title: 'main needs login', detail: '2 chats waiting · log in again', requests: [] }])
    expect(inbox.board.flatMap((group) => group.rows.map((row) => row.id))).toEqual(['c'])
  })

  it('groups everyone else by department in floor order, with counts, time in state and a parked tally', () => {
    const now = Date.now()
    const chats = new Map([
      ['side', view('side', { cwd: '/Users/a/Documents/GitHub/portfolio', createdAt: now - 10, activity: 'Editing DotField.tsx' })],
      ['mkt-late', view('mkt-late', { state: 'done', createdAt: now - 5 })],
      ['mkt-early', view('mkt-early', { createdAt: now - 20, stateSince: now - 5 * 60_000 })],
      ['mkt-waiting', view('mkt-waiting', { state: 'needs-you', pending: [{ id: 'r', toolName: 'Bash' }] })],
      ['gym', view('gym', { accountId: 'research' })],
      ['old', view('old', { state: 'idle', parked: true })],
    ])
    const agents = toAgents(chats.values(), accounts, now, new Map())
    const { board, parked } = buildInbox(chats, agents, [])
    expect(board.map((group) => group.name)).toEqual(['Marketplace', 'Side projects', 'Research gym'])
    expect(board[0]!.rows.map((row) => [row.id, row.state])).toEqual([
      ['mkt-early', 'working'],
      ['mkt-late', 'done'],
    ])
    expect(board[0]!.counts).toEqual([
      { key: 'needs', label: 'needs you', n: 1 },
      { key: 'working', label: 'working', n: 1 },
      { key: 'done', label: 'done', n: 1 },
    ])
    expect(board[0]!.rows[0]!.since).toBe(now - 5 * 60_000)
    expect(board[1]!.rows[0]!.caption).toBe('Editing DotField.tsx')
    expect(parked).toBe(1)
  })

  it('lists standby chats in a Standby group, newest first, with their department and when they finished', () => {
    const now = Date.now()
    const hour = 3_600_000
    const chats = new Map([
      ['working', view('working')],
      ['unread', view('unread', { state: 'done', unread: true })],
      ['read', view('read', { state: 'idle', lastActivityAt: now - 2 * hour })],
      ['gym-read', view('gym-read', { state: 'idle', accountId: 'research', lastActivityAt: now - hour })],
      ['old', view('old', { state: 'done', unread: true, parked: true, lastActivityAt: now - 30 * hour })],
      ['waiting', view('waiting', { state: 'needs-you', pending: [{ id: 'r', toolName: 'Bash' }] })],
    ])
    const agents = toAgents(chats.values(), accounts, now, new Map())
    const { board, standby } = buildInbox(chats, agents, [])
    expect(board.flatMap((group) => group.rows.map((row) => row.id))).toEqual(['working', 'unread'])
    expect(standby).toMatchObject([
      { id: 'gym-read', dept: 'Research gym', at: now - hour, dozing: false },
      { id: 'read', dept: 'Marketplace', at: now - 2 * hour, dozing: false },
      { id: 'old', dept: 'Marketplace', dozing: true },
    ])
    expect(agents.find((agent) => agent.id === 'read')?.caption).toBe('Standby · 2h ago')
  })

  it('keeps finished chats off the floor and lists them in Finished, newest first, with department and when they finished', () => {
    const now = Date.now()
    const chats = new Map([
      ['live', view('live')],
      ['older', view('older', { state: 'idle', finished: now - 7_200_000 })],
      ['newer', view('newer', { state: 'done', accountId: 'research', finished: now - 60_000, visitor: 'desktop' })],
      ['gone', view('gone', { state: 'idle', finished: now, archived: true })],
    ])
    expect(toAgents(chats.values(), accounts, now, new Map()).map((agent) => agent.id)).toEqual(['live'])
    expect(finishedOf(chats.values(), accounts)).toMatchObject([
      { id: 'newer', dept: 'Research gym', at: now - 60_000, visitor: true },
      { id: 'older', dept: 'Marketplace', at: now - 7_200_000, visitor: false },
    ])
  })

  it('moves a stuck chat sent to the Lounge out of Waiting for you and into Standby, until it works again', () => {
    const chats = new Map([['stuck', view('stuck', { state: 'stuck', stuck: { reason: 'crashed' } })]])
    const agents = toAgents(chats.values(), accounts, Date.now(), new Map())
    expect(buildInbox(chats, agents, []).waiting.map((item) => item.chatId)).toEqual(['stuck'])
    const sent = buildInbox(chats, agents, [], new Set(['stuck']))
    expect(sent.waiting).toEqual([])
    expect(sent.standby.map((row) => row.id)).toEqual(['stuck'])
    const busy = new Map([['stuck', view('stuck', { state: 'needs-you', pending: [{ id: 'r', toolName: 'Bash' }] })]])
    expect(buildInbox(busy, toAgents(busy.values(), accounts, Date.now(), new Map()), [], new Set(['stuck'])).waiting.map((item) => item.chatId)).toEqual(['stuck'])
  })
})
