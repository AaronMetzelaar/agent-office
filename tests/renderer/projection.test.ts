import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Vector3 } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPatchSync } from '../../src/main/store/ipc-sync'
import { countsFor } from '../../src/renderer/office/labels'
import { anchorsFor, layoutFloor, queueSpots, type DeptId } from '../../src/renderer/office/layout'
import { createNav, newWalker, stepWalker } from '../../src/renderer/office/nav'
import { placementFor } from '../../src/renderer/office/pose'
import { buildQueue, queuePositions } from '../../src/shared/queue'
import { assignColours, createProjection, projectOf, toAgents, type ChatSource } from '../../src/renderer/state/projection'
import { departmentOf } from '../../src/shared/office'
import type { ChatPatchBatch, ChatView } from '../../src/shared/chat'
import type { AccountView } from '../../src/shared/ipc'
import { sdk } from '../fakes/fake-engine'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

const accounts: AccountView[] = [
  { id: 'main', label: 'main', createdAt: 0, health: { status: 'ok' } },
  { id: 'research', label: 'research', createdAt: 0, health: { status: 'ok' } },
]

let dir: string
let office: ReturnType<typeof openOffice>
let source: ChatSource & { flush(): Promise<void> }

beforeEach(() => {
  vi.useFakeTimers()
  dir = mkdtempSync(join(tmpdir(), 'agent-office-projection-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  office = openOffice(dir)
  const listeners = new Set<(batch: ChatPatchBatch) => void>()
  const sync = createPatchSync(office.store, (batch) => listeners.forEach((listener) => listener(batch)))
  sync.setVisible(true)
  source = {
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

const agentsOf = (projection: ReturnType<typeof createProjection>) => toAgents(projection.chats.values(), accounts, Date.now(), new Map())

describe('store projection', () => {
  it('captions from the store: an Edit reads "Editing BidFlow.vue", a pending Bash reads "Waiting for you · Bash"', async () => {
    const projection = createProjection(source)
    await projection.ready
    const id = office.start('Fix the bid flow')
    office.engine.init(id)
    office.engine.emit(id, sdk.toolUse([{ id: 'edit-1', name: 'Edit', input: { file_path: '/repo/components/BidFlow.vue' } }]))
    await source.flush()
    expect(agentsOf(projection)[0]).toMatchObject({ state: 'working', caption: 'Editing BidFlow.vue' })

    void office.engine.ask(id, 'Bash', { command: 'pnpm test' })
    await source.flush()
    expect(agentsOf(projection)[0]).toMatchObject({ state: 'needs-you', caption: 'Waiting for you · Bash', request: { tool: 'Bash', summary: 'pnpm test' } })
  })

  it('a store diff to Needs you gives the chat the next queue spot, updates its sign in amber, and starts its walk within a frame', async () => {
    const projection = createProjection(source)
    await projection.ready
    const early = office.start('Waiting already')
    office.engine.init(early)
    void office.engine.ask(early, 'Bash', { command: 'git status' })
    const id = office.start('Fix the bid flow')
    office.engine.init(id)
    await source.flush()

    const before = agentsOf(projection)
    expect(countsFor(before.filter((a) => a.dept === 'side')).find((c) => c.key === 'needs')?.n).toBe(1)
    const floor = layoutFloor({ side: 2 })
    const [x, z] = floor.zones.side.world[1]!
    const seat = anchorsFor('desk', x, z).seat
    const walker = newWalker(new Vector3(seat[0], 0, seat[1]))

    await vi.advanceTimersByTimeAsync(1)
    void office.engine.ask(id, 'Bash', { command: 'pnpm test' })
    await source.flush()

    const after = agentsOf(projection)
    expect(countsFor(after.filter((a) => a.dept === 'side')).find((c) => c.key === 'needs')?.n).toBe(2)
    const queue = buildQueue(after)
    const index = queuePositions(queue).get(id)!
    expect(index).toBe(1)
    const place = placementFor({ state: 'needs-you', kind: 'desk', spot: 'desk', parked: false, queueIndex: index, spots: queueSpots.length })
    expect(place.anchor).toBe('queue')
    const spot = new Vector3(queueSpots[index]![0], 0, queueSpots[index]![1])
    const nav = createNav()
    nav.rebuild(floor.frame, () => [0, 0])
    const start = walker.pos.distanceTo(spot)
    expect(stepWalker(walker, spot, 1 / 60, nav.route, true)).toBe(true)
    expect(walker.goal).toBe(spot)
    expect(walker.path.at(-1)).toEqual(spot)
    for (let frame = 0; frame < 30; frame++) stepWalker(walker, spot, 1 / 60, nav.route, true)
    expect(walker.pos.distanceTo(spot)).toBeLessThan(start)
  })

  it('ignores patches the snapshot already covers and applies the newer ones', async () => {
    const listeners: ((batch: ChatPatchBatch) => void)[] = []
    let resolve!: () => void
    const chat = { id: 'c', title: 'Old', state: 'working', rows: [] } as unknown as ChatView
    const projection = createProjection({
      getSnapshot: () => new Promise((done) => (resolve = () => done({ seq: 5, chats: [{ ...chat }], logins: [] }))),
      onChatPatches: (listener) => {
        listeners.push(listener)
        return () => {}
      },
    })
    listeners[0]!({ seq: 5, patches: [{ id: 'c', fields: { title: 'Stale' } }] })
    listeners[0]!({ seq: 6, patches: [{ id: 'c', fields: { title: 'New' } }], logins: [{ accountId: 'main', label: 'main' }] })
    resolve()
    await projection.ready
    expect(projection.chats.get('c')?.title).toBe('New')
    expect(projection.logins).toEqual([{ accountId: 'main', label: 'main' }])
  })
})

describe('placement and colour', () => {
  const research = new Set(['research'])

  it('maps folders to departments with the placeholder rules', () => {
    const at = (cwd: string, accountId = 'main') => departmentOf({ cwd }, research.has(accountId))
    expect(at('/Users/a/Documents/GitHub/monorepo/frontend/marketplace/components')).toBe('mkt')
    expect(at('/Users/a/Documents/GitHub/monorepo/frontend/admin')).toBe('adm')
    expect(at('/Users/a/Documents/GitHub/monorepo/frontend/mobile')).toBe('mob')
    expect(at('/Users/a/Documents/GitHub/monorepo/services/api')).toBe('plat')
    expect(at('/Users/a/Documents/GitHub/monorepo/.claude/worktrees/auc-1302')).toBe('plat')
    expect(at('/Users/a/Documents/GitHub/portfolio')).toBe('side')
    expect(at('/Users/a/Documents/GitHub/monorepo/frontend/marketplace', 'research')).toBe('gym')
    expect(departmentOf({ cwd: '/x', department: 'mob' }, false)).toBe('mob')
    expect(projectOf('/Users/a/Documents/GitHub/cookbook/.claude/worktrees/pages')).toBe('cookbook')
  })

  it('lets a chat the store parked doze in the lounge, with how long ago it finished', () => {
    const now = Date.now()
    const day = 86_400_000
    const chat = { id: 'p', accountId: 'main', cwd: '/x/portfolio', title: 'Old', archived: false, parked: true, state: 'idle', stateSince: now - 2 * day, lastActivityAt: now - 2 * day, createdAt: 0, pending: [], pendingRequests: [], subagents: [] } as unknown as ChatView
    expect(toAgents([chat], accounts, now, new Map())[0]).toMatchObject({ parked: true, caption: 'Dozing · 2d ago' })
  })

  it('gives 15 agents 15 different colours and keeps them stable', () => {
    const agents = Array.from({ length: 15 }, (_, i) => ({ id: `a${i}`, dept: (['mkt', 'mob', 'side'] as const)[i % 3] as DeptId, createdAt: i }))
    const colours = assignColours(agents, new Map())
    expect(new Set(colours.values()).size).toBe(15)
    const again = assignColours([...agents.slice(3), { id: 'new', dept: 'mkt' as DeptId, createdAt: 99 }], colours)
    for (const agent of agents.slice(3)) expect(again.get(agent.id)).toBe(colours.get(agent.id))
    expect(new Set(again.values()).size).toBe(13)
  })

  it('never repeats a colour inside a department, even past the palette', () => {
    const agents = Array.from({ length: 60 }, (_, i) => ({ id: `a${i}`, dept: (['mkt', 'gym'] as const)[i % 2] as DeptId, createdAt: i }))
    const colours = assignColours(agents, new Map())
    for (const dept of ['mkt', 'gym']) {
      const inDept = agents.filter((a) => a.dept === dept).map((a) => colours.get(a.id))
      expect(new Set(inDept).size).toBe(inDept.length)
    }
  })
})
