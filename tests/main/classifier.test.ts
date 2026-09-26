import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlacement } from '../../src/main/departments/classifier'
import { showsAccountBadge } from '../../src/shared/departments'
import { sdk } from '../fakes/fake-engine'
import { openOffice } from '../fakes/office'
import { claudeWorktree, gitRepo, mwsMonorepo } from '../fakes/repos'

vi.mock('electron', async () => await import('../fakes/electron'))

let dir: string
let office: ReturnType<typeof openOffice>
let open: string | undefined
let placement: ReturnType<typeof createPlacement>
let root: string
const monorepo = () => root
const mkt = (file = 'components/BidFlow.vue', base = monorepo()) => join(base, 'frontend/marketplace', file)
const mob = (file = 'src/screens/Bids.tsx') => join(monorepo(), 'frontend/mobile', file)

const tool = (name: string, input: Record<string, unknown>) => ({ id: randomUUID(), name, input })
const read = (file_path: string) => tool('Read', { file_path })
const edit = (file_path: string) => tool('Edit', { file_path })
const touch = (chatId: string, ...tools: ReturnType<typeof tool>[]) => office.engine.emit(chatId, sdk.toolUse(tools))
const repeat = (times: number, act: () => void) => Array.from({ length: times }).forEach(act)
const department = (chatId: string) => office.chat(chatId).department

function startIn(folder: string, account = 'main', options?: object) {
  mkdirSync(folder, { recursive: true })
  const result = office.store.start(account, folder, 'Fix the bid flow', undefined, undefined, options)
  if ('error' in result) throw new Error(result.error)
  office.engine.init(result.chatId)
  return result.chatId
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-classifier-')))
  root = mwsMonorepo(join(dir, 'code', 'mws'))
  office = openOffice(dir)
  open = undefined
  placement = createPlacement(office.engine, office.store, office.rooms, (chatId) => chatId === open)
})

afterEach(() => {
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('department placement', { timeout: 60_000 }, () => {
  it('places a monorepo chat whose file events are mostly under frontend/marketplace in Marketplace, and saves the department', () => {
    const id = startIn(monorepo())
    expect(department(id)).toBe('plat')
    touch(id, edit(mkt()), read(mkt('pages/index.vue')))
    expect(department(id)).toBe('plat')
    touch(id, read(mkt('stores/bids.ts')))
    expect(department(id)).toBe('mkt')
    expect(office.db.listChats().find((record) => record.id === id)?.department).toBe('mkt')
  })

  it('moves a chat in a .claude/worktrees worktree of the monorepo to Marketplace on marketplace edits', () => {
    const tree = claudeWorktree(monorepo(), 'bid-flow')
    const id = startIn(tree)
    expect(department(id)).toBe('plat')
    repeat(2, () => touch(id, edit(mkt('components/BidFlow.vue', tree))))
    expect(department(id)).toBe('mkt')
  })

  it('never moves a chat into a repo that has no room, and moves it into one that does', () => {
    const shop = gitRepo(join(dir, 'shop'))
    const blog = gitRepo(join(dir, 'blog'))
    const id = startIn(shop)
    const home = department(id)
    repeat(6, () => touch(id, edit(join(blog, 'post.md'))))
    expect(department(id)).toBe(home)
    const other = startIn(blog)
    expect(department(other)).not.toBe(home)
    repeat(6, () => touch(id, edit(join(blog, 'post.md'))))
    expect(department(id)).toBe(department(other))
  })

  it('ignores one stray mobile read, and moves only when a shift holds 60% on two evaluations in a row', () => {
    const id = startIn(join(monorepo(), 'frontend/marketplace'))
    repeat(10, () => touch(id, read(mkt())))
    touch(id, read(mob()))
    expect(department(id)).toBe('mkt')
    repeat(5, () => touch(id, edit(mob())))
    expect(department(id)).toBe('mkt')
    touch(id, edit(mob()))
    expect(department(id)).toBe('mob')
  })

  it('keeps a chat where it is when its work splits evenly between two departments', () => {
    const id = startIn(monorepo())
    repeat(12, () => {
      touch(id, edit(mkt()))
      touch(id, edit(mob()))
    })
    expect(department(id)).toBe('plat')
  })

  it('counts subagent activity toward the parent, and ignores files outside the rules and the chat folder', () => {
    const id = startIn(monorepo())
    repeat(4, () => office.engine.emit(id, sdk.toolUse([tool('Glob', { pattern: '*.tsx', path: join(monorepo(), 'frontend/mobile') })], 'agent-1')))
    expect(department(id)).toBe('mob')
    repeat(10, () => touch(id, read(join(dir, 'elsewhere/notes.md')), tool('Grep', { pattern: 'bid' })))
    expect(department(id)).toBe('mob')
  })

  it('holds a move while the chat is queued at your door, and makes it once the chat is released', async () => {
    const id = startIn(join(monorepo(), 'frontend/marketplace'))
    const asked = office.engine.askTool(id, 'Bash', { command: 'pnpm test' })
    expect(office.chat(id).state).toBe('needs-you')
    repeat(3, () => touch(id, edit(mob())))
    expect(department(id)).toBe('mkt')
    office.broker.resolveRequest(office.chat(id).pendingRequests[0]!.id, { kind: 'allow' }, 'chat')
    await asked
    expect(office.chat(id).state).toBe('working')
    expect(department(id)).toBe('mob')
  })

  it('holds a move while the chat’s panel is open', () => {
    const id = startIn(join(monorepo(), 'frontend/marketplace'))
    open = id
    repeat(3, () => touch(id, edit(mob())))
    placement.release()
    expect(department(id)).toBe('mkt')
    open = undefined
    placement.release()
    expect(department(id)).toBe('mob')
  })
})

describe('the research account', { timeout: 60_000 }, () => {
  it('always lives in the gym, whatever files it touches', () => {
    const id = startIn(join(dir, 'enigma-rsa'), 'research')
    expect(department(id)).toBe('c-research-gym')
    repeat(6, () => touch(id, edit(mkt())))
    expect(department(id)).toBe('c-research-gym')
  })

  it('keeps the department an overflow chat was started in, with an account badge', () => {
    office.rooms.resolve(monorepo())
    const id = startIn(join(monorepo(), 'frontend/marketplace'), 'research', { dept: 'mkt' })
    expect(department(id)).toBe('mkt')
    repeat(6, () => touch(id, edit(mob())))
    expect(department(id)).toBe('mob')
    const rooms = [{ id: 'mkt' }, { id: 'c-research-gym', account: 'research' }]
    expect(showsAccountBadge(rooms, 'mkt', 'research')).toBe(true)
    expect(showsAccountBadge(rooms, 'c-research-gym', 'research')).toBe(false)
    expect(showsAccountBadge(rooms, 'c-research-gym', 'main')).toBe(true)
    expect(showsAccountBadge(rooms, 'mkt', 'main')).toBe(false)
  })
})

describe('PR review agents', { timeout: 60_000 }, () => {
  it('sit in PR reviews because they were started as a review, whatever the PR’s files or the requested section', () => {
    const id = startIn(join(monorepo(), 'frontend/marketplace'), 'main', { review: true, dept: 'mkt' })
    expect(office.chat(id)).toMatchObject({ department: 'rev', review: true })
    repeat(6, () => touch(id, edit(mkt())))
    expect(department(id)).toBe('rev')
    expect(office.db.listChats().find((record) => record.id === id)).toMatchObject({ department: 'rev', review: true })
  })

  it('never counts a prompt that merely mentions a review as a review agent', () => {
    mkdirSync(monorepo(), { recursive: true })
    const result = office.store.start('main', monorepo(), '/pr-review-rundown https://github.com/mws/monorepo/pull/7')
    if ('error' in result) throw new Error(result.error)
    expect(office.chat(result.chatId).department).toBe('plat')
    expect(office.chat(result.chatId).review).toBeUndefined()
  })
})
