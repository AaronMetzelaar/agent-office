import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LoadedConfig } from '../../src/main/departments/config'
import { createJev } from '../../src/main/departments/jev'
import { createRooms } from '../../src/main/departments/rooms'
import type { Post } from '../../src/main/workflow/linear'
import { legacyRooms, mwsRooms, playgroundRoom, reviewRoom, type RoomDef } from '../../src/shared/departments'
import { gitRepo, mwsMonorepo } from '../fakes/repos'

function jevApi(answer: unknown, status = 200) {
  const calls: { headers: Record<string, string>; body: { state: { task: string; folder: string }; questions: { room: { criteria: Record<string, string> } } } }[] = []
  const post: Post = async (_url, init) => {
    calls.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ answers: { room: answer } }), { status })
  }
  return { post, calls }
}

const root = '/Users/me/code/monorepo'
const office: RoomDef = { id: 'r1', name: 'Agent Office', about: 'The Electron office app', subtitle: '~/code/agent-office', accent: 0x0891b2, look: 'plain', root: '/Users/me/code/agent-office' }
const registry = (rooms: readonly RoomDef[], folders: Record<string, string[]> = {}) => ({ list: () => rooms, folders: (id: string) => folders[id] ?? [] })
const floor = registry([...mwsRooms, playgroundRoom, reviewRoom, legacyRooms.find((room) => room.id === 'gym')!], { adm: [`${root}/frontend/admin`] })
const none = registry([playgroundRoom, reviewRoom])

describe('Jev room pick', () => {
  it('asks Jev for every chat, offering the rooms on the floor but not Side projects, PR reviews or account rooms', async () => {
    const api = jevApi({ choice: 'mob', confidence: 0.9 })
    expect(await createJev(() => 'ts_key', floor, api.post)(`${root}/frontend/admin/.claude/worktrees/x`, 'Fix the bid screen crash')).toBe('mob')
    expect(api.calls[0]!.headers.authorization).toBe('Bearer ts_key')
    expect(api.calls[0]!.body.state).toEqual({ task: 'Fix the bid screen crash', folder: `${root}/frontend/admin` })
    expect(Object.keys(api.calls[0]!.body.questions.room.criteria)).toEqual(['mkt', 'adm', 'mob', 'plat', 'new'])
    expect(api.calls[0]!.body.questions.room.criteria.adm).toContain('monorepo/frontend/admin')
  })

  it('offers the rooms Claude made with their folders, and always a new room', async () => {
    const api = jevApi({ choice: 'r1', confidence: 0.8 })
    expect(await createJev(() => 'k', registry([playgroundRoom, office], { r1: [office.root!] }), api.post)('/Users/me/code/agent-office', 'x')).toBe('r1')
    expect(api.calls[0]!.body.questions.room.criteria.r1).toBe('Agent Office: The Electron office app. Its agents work in /Users/me/code/agent-office')
    expect(Object.keys(api.calls[0]!.body.questions.room.criteria)).toEqual(['r1', 'new'])
  })

  it('leaves the choice to the desk or folder when Jev is unsure, fails, answers outside the options or has no key', async () => {
    expect(await createJev(() => 'k', floor, jevApi({ choice: 'mob', confidence: 0.3 }).post)(root, 'x')).toBeUndefined()
    expect(await createJev(() => 'k', floor, jevApi({ choice: 'gym', confidence: 1 }).post)(root, 'x')).toBeUndefined()
    expect(await createJev(() => 'k', floor, jevApi({}, 500).post)(root, 'x')).toBeUndefined()
    const unused = jevApi({ choice: 'mob', confidence: 1 })
    expect(await createJev(() => undefined, none, unused.post)(root, 'x')).toBeUndefined()
    expect(unused.calls).toHaveLength(0)
  })
})

describe('rooms Claude makes', { timeout: 60_000 }, () => {
  let dir: string
  beforeEach(() => void (dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-made-')))))
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const loaded = (): LoadedConfig => ({ config: { rooms: [], playground: [], commands: {} }, skipped: [] })

  function setup(replies: (string | undefined)[], saved?: unknown) {
    const settings = new Map<string, unknown>(saved ? [['rooms', saved]] : [])
    const asked: string[] = []
    const rooms = createRooms({ setting: (key) => settings.get(key), saveSetting: (key, value) => void settings.set(key, value) }, loaded(), () => [], async (_account, _system, prompt) => (asked.push(prompt), replies.shift()))
    let changes = 0
    rooms.events.on('changed', () => changes++)
    return { rooms, settings, asked, changes: () => changes }
  }

  it('names a room for a new repository, saves it with its folder and hands the same room to later chats there', async () => {
    const repo = gitRepo(join(dir, 'agent-office'), { 'src/main.ts': '' })
    const { rooms, settings, asked, changes } = setup(['"Agent Office"\nThe Electron app that shows agents in an office.'])
    const [first, second] = await Promise.all([rooms.make('main', join(repo, 'src'), 'Add rooms'), rooms.make('main', repo, 'More')])
    expect(first).toMatchObject({ name: 'Agent Office', about: 'The Electron app that shows agents in an office', root: repo, look: 'plain' })
    expect(second).toBe(first)
    expect(await rooms.make('main', repo, 'Again')).toBe(first)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain(`Folder: ${repo}`)
    expect(settings.get('rooms')).toEqual([first])
    expect(changes()).toBe(1)
    expect(rooms.resolve(join(repo, 'src'), 'main')).toBe(first!.id)
  })

  it('names the room after the folder when Claude gives no name for a repository', async () => {
    const repo = gitRepo(join(dir, 'shop'))
    expect(await setup([undefined]).rooms.make('main', repo, 't')).toMatchObject({ name: 'shop', root: repo })
  })

  it('makes a room without a folder for work inside a folder a room already covers, and none without a name', async () => {
    const mono = mwsMonorepo(join(dir, 'monorepo'))
    const { rooms } = setup(['Docs\nHandbooks and guides', undefined])
    expect(rooms.resolve(mono, 'main')).toBe('plat')
    const docs = await rooms.make('main', mono, 'Write the handbook')
    expect(docs).toMatchObject({ name: 'Docs', about: 'Handbooks and guides', subtitle: 'room made by Claude' })
    expect(docs!.root).toBeUndefined()
    expect(rooms.resolve(mono, 'main')).toBe('plat')
    expect(await rooms.make('main', mono, 'More')).toBeUndefined()
  })

  it('carries over rooms saved by the six-slot version, and drops entries it can’t read', () => {
    const saved = [{ id: 'r1', name: 'Agent Office', about: 'The Electron office app', folder: '/Users/me/code/agent-office' }, { id: 'r2', name: 'Docs', about: 'Handbooks' }, { name: 'broken' }, 7]
    const list = setup([], saved).rooms.list()
    expect(list.find((room) => room.id === 'r1')).toMatchObject({ name: 'Agent Office', about: 'The Electron office app', root: '/Users/me/code/agent-office', look: 'plain', accent: 0x0891b2 })
    expect(list.find((room) => room.id === 'r2')).toMatchObject({ name: 'Docs', subtitle: 'room made by Claude', accent: 0xca8a04 })
    expect(list.map((room) => room.id)).toEqual(['side', 'rev', 'r1', 'r2'])
  })
})
