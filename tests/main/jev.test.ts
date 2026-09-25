import { describe, expect, it } from 'vitest'
import { createJev } from '../../src/main/departments/jev'
import { createRooms } from '../../src/main/departments/rooms'
import type { Post } from '../../src/main/workflow/linear'
import { defaultRules, deptNames, roomIds, type Room } from '../../src/shared/departments'

function jevApi(answer: unknown, status = 200) {
  const calls: { headers: Record<string, string>; body: { state: { task: string; folder: string }; questions: { room: { criteria: Record<string, string> } } } }[] = []
  const post: Post = async (_url, init) => {
    calls.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ answers: { room: answer } }), { status })
  }
  return { post, calls }
}

const root = '/Users/me/code/monorepo'
const none = { list: () => [], full: () => false }
const office: Room = { id: 'r1', name: 'Agent Office', about: 'The Electron office app', folder: '/Users/me/code/agent-office' }

describe('Jev room pick', () => {
  it('asks Jev for every chat, including one whose folder or desk already names a section', async () => {
    const api = jevApi({ choice: 'mob', confidence: 0.9 })
    expect(await createJev(() => 'ts_key', defaultRules, none, api.post)(`${root}/frontend/admin/.claude/worktrees/x`, 'Fix the bid screen crash')).toBe('mob')
    expect(api.calls[0]!.headers.authorization).toBe('Bearer ts_key')
    expect(api.calls[0]!.body.state).toEqual({ task: 'Fix the bid screen crash', folder: `${root}/frontend/admin` })
    expect(Object.keys(api.calls[0]!.body.questions.room.criteria)).toEqual(['mkt', 'adm', 'mob', 'plat', 'new'])
    expect(api.calls[0]!.body.questions.room.criteria.adm).toContain('monorepo/frontend/admin')
  })

  it('offers the rooms Claude made with their folders, and Side projects instead of a new room once every spare room is taken', async () => {
    const rules = [...defaultRules, { path: office.folder!, dept: office.id }]
    const open = jevApi({ choice: 'r1', confidence: 0.8 })
    expect(await createJev(() => 'k', rules, { list: () => [office], full: () => false }, open.post)('/Users/me/code/agent-office', 'x')).toBe('r1')
    expect(open.calls[0]!.body.questions.room.criteria.r1).toBe('Agent Office: The Electron office app. Its agents work in /Users/me/code/agent-office')
    const full = jevApi({ choice: 'new', confidence: 1 })
    expect(await createJev(() => 'k', rules, { list: () => [office], full: () => true }, full.post)('/Users/me/else', 'x')).toBeUndefined()
    expect(Object.keys(full.calls[0]!.body.questions.room.criteria)).toEqual(['mkt', 'adm', 'mob', 'plat', 'r1', 'side'])
  })

  it('leaves the choice to the desk or folder when Jev is unsure, fails, answers outside the options or has no key', async () => {
    expect(await createJev(() => 'k', defaultRules, none, jevApi({ choice: 'mob', confidence: 0.3 }).post)(root, 'x')).toBeUndefined()
    expect(await createJev(() => 'k', defaultRules, none, jevApi({ choice: 'gym', confidence: 1 }).post)(root, 'x')).toBeUndefined()
    expect(await createJev(() => 'k', defaultRules, none, jevApi({}, 500).post)(root, 'x')).toBeUndefined()
    const unused = jevApi({ choice: 'mob', confidence: 1 })
    expect(await createJev(() => undefined, defaultRules, none, unused.post)(root, 'x')).toBeUndefined()
    expect(unused.calls).toHaveLength(0)
  })
})

describe('rooms Claude makes', () => {
  function setup(replies: (string | undefined)[], saved?: unknown) {
    const settings = new Map<string, unknown>(saved ? [['rooms', saved]] : [])
    const asked: string[] = []
    const changes: (readonly Room[])[] = []
    const rooms = createRooms(
      { setting: (key) => settings.get(key), saveSetting: (key, value) => void settings.set(key, value) },
      async (_account, _system, prompt) => (asked.push(prompt), replies.shift()),
      (list) => changes.push([...list]),
    )
    return { rooms, settings, asked, changes }
  }

  it('names a room for a new repository, saves it with its folder and hands the same room to later chats there', async () => {
    const { rooms, settings, asked, changes } = setup(['"Agent Office"\nThe Electron app that shows agents in an office.'])
    const [first, second] = await Promise.all([rooms.make('main', '/Users/me/code/agent-office/.claude/worktrees/x', 'Add rooms', defaultRules), rooms.make('main', '/Users/me/code/agent-office', 'More', defaultRules)])
    const room = { id: 'r1', name: 'Agent Office', about: 'The Electron app that shows agents in an office', folder: '/Users/me/code/agent-office' }
    expect(first).toEqual(room)
    expect(second).toBe(first)
    expect(await rooms.make('main', '/Users/me/code/agent-office', 'Again', defaultRules)).toBe(first)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('Folder: /Users/me/code/agent-office')
    expect(settings.get('rooms')).toEqual([room])
    expect(changes).toEqual([[room]])
    expect(deptNames.r1).toBe('Agent Office')
  })

  it('keeps a room made for work inside a known folder off the folder rules, and loads saved rooms by name', async () => {
    const { rooms } = setup(['Docs'], [office])
    expect(rooms.list()).toEqual([office])
    expect(await rooms.make('main', root, 'Write the handbook', defaultRules)).toEqual({ id: 'r2', name: 'Docs', about: 'Docs' })
  })

  it('makes no room when Claude gives no name or every spare room is taken', async () => {
    expect(await setup([undefined]).rooms.make('main', '/x', 't', defaultRules)).toBeUndefined()
    const full = setup(['Extra'], roomIds.map((id) => ({ id, name: id, about: id })))
    expect(full.rooms.full()).toBe(true)
    expect(await full.rooms.make('main', '/x', 't', defaultRules)).toBeUndefined()
    expect(full.asked).toHaveLength(0)
  })
})
