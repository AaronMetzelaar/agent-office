import { EventEmitter } from 'node:events'
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NotificationConstructorOptions } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rendererEvents } from '../../src/main/host/forwarded'
import type { Hub } from '../../src/main/ipc'
import { createNotifier } from '../../src/main/notify'
import type { Visitors } from '../../src/main/outside/visitors'
import { wireChats } from '../../src/main/store/ipc-sync'
import type { ChatPatchBatch, ChatSnapshot, RoomsUpdate } from '../../src/shared/chat'
import { createFakeEngine } from '../fakes/fake-engine'
import { configOf, openOffice } from '../fakes/office'
import { gitRepo } from '../fakes/repos'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let office: ReturnType<typeof openOffice>

const noVisitors = { snapshot: () => [], has: () => false, open: () => {} } as unknown as Visitors

function hub() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const sent: [string, unknown][] = []
  const fake = { handle: (name: string, command: (...args: unknown[]) => unknown) => void handlers.set(name, command), send: (name: string, payload: unknown) => void sent.push([name, payload]) } as unknown as Hub
  return { fake, sent, call: (name: string) => handlers.get(name)!() }
}

function reopen(config = configOf()) {
  office.store.shutdown()
  office.db.close()
  office = openOffice(dir, createFakeEngine(), config)
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-rooms-host-')))
  office = openOffice(dir)
})

afterEach(() => {
  vi.useRealTimers()
  office.store.shutdown()
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('rooms on the host', { timeout: 60_000 }, () => {
  it('builds a room for a chat started in a new repo and sends the room list straight away', () => {
    const { fake, sent } = hub()
    wireChats(fake, office.store, noVisitors, office.rooms)
    const repo = gitRepo(join(dir, 'shop'))
    const id = office.start('Fix the cart', 'main', repo)
    const room = office.rooms.byId(office.chat(id).department!)
    expect(room).toMatchObject({ id: expect.stringMatching(/^r-/), name: 'shop', look: 'plain', root: repo })
    expect(sent).toEqual([['rooms', { rooms: office.rooms.list(), configErrors: { skipped: [] } }]])
    expect((sent[0]![1] as RoomsUpdate).rooms).toContainEqual(room)
  })

  it('keeps a room built while the window is hidden in the snapshot, and never filters the rooms event', () => {
    vi.useFakeTimers()
    const { fake, sent, call } = hub()
    wireChats(fake, office.store, noVisitors, office.rooms)
    const id = office.start('Fix the cart', 'main', gitRepo(join(dir, 'shop')))
    vi.advanceTimersByTime(50)
    const department = office.chat(id).department!
    const patches = sent.filter(([name]) => name === 'chatPatches').flatMap(([, batch]) => (batch as ChatPatchBatch).patches)
    expect(patches.every((patch) => !patch.fields || !('department' in patch.fields))).toBe(true)
    expect(sent.find(([name]) => name === 'rooms')?.[1]).toMatchObject({ rooms: expect.arrayContaining([expect.objectContaining({ id: department })]) })
    const snapshot = call('getSnapshot') as ChatSnapshot
    expect(snapshot.rooms?.map((room) => room.id)).toContain(department)
    expect(snapshot.chats.find((chat) => chat.id === id)?.department).toBe(department)
  })

  it('puts config errors in the snapshot', () => {
    reopen({ ...configOf(), skipped: ['Skipped room "Lab": look isn’t one of plain'] })
    const { fake, call } = hub()
    wireChats(fake, office.store, noVisitors, office.rooms)
    expect((call('getSnapshot') as ChatSnapshot).configErrors).toEqual({ skipped: ['Skipped room "Lab": look isn’t one of plain'] })
    reopen(configOf({}, 'Unexpected token } in JSON'))
    const second = hub()
    wireChats(second.fake, office.store, noVisitors, office.rooms)
    expect((second.call('getSnapshot') as ChatSnapshot).configErrors).toEqual({ unreadable: 'Unexpected token } in JSON', skipped: [] })
  })

  it('moves chats out of a config room that was removed from the file by the next host start, without building a room', () => {
    const lab = gitRepo(join(dir, 'lab'))
    reopen(configOf({ rooms: [{ id: 'c-lab', name: 'Lab', folders: [lab] }] }))
    const id = office.start('Tune the model', 'main', lab)
    expect(office.chat(id).department).toBe('c-lab')
    reopen()
    expect(office.chat(id).department).toBe('side')
    expect(office.db.listChats().find((record) => record.id === id)?.department).toBe('side')
    expect(office.rooms.list().map((room) => room.id)).toEqual(['side', 'rev'])
  })

  it('titles a notification with the name of the chat’s room', () => {
    const notes: NotificationConstructorOptions[] = []
    const notifier = createNotifier({
      store: office.store,
      department: (chat) => office.rooms.nameOf(chat.department),
      resolve: (requestId, decision) => office.broker.resolveRequest(requestId, decision, 'notification'),
      sendMessage: office.store.sendMessage,
      open: () => {},
      notification: (options) => {
        notes.push(options)
        return Object.assign(new EventEmitter(), { show: () => {}, close: () => {} })
      },
      push: () => {},
    })
    const id = office.start('Fix the cart', 'main', gitRepo(join(dir, 'shop')))
    office.finish(id)
    notifier.stop()
    expect(notes.at(-1)).toMatchObject({ title: `${office.chat(id).title} is done`, subtitle: 'shop' })
  })

  it('forwards every event the host sends to the window', () => {
    const root = join(__dirname, '../../src/main')
    const sources = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.ts'))
    const sent = new Set(sources.flatMap((file) => [...readFileSync(join(root, file), 'utf8').matchAll(/hub\.send\('(\w+)'/g)].map((match) => match[1]!)))
    expect([...sent].filter((name) => !rendererEvents.has(name))).toEqual([])
  })
})
