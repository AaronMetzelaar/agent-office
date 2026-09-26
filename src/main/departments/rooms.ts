import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { mwsRooms, playgroundRoom, repoPath, reviewRoom, tiedRoomIn, type RoomDef } from '../../shared/departments'
import { palette } from '../../shared/office'
import type { Db } from '../store/db'
import type { LoadedConfig } from './config'
import { isMwsMonorepo, memo, repoInfo } from './repo-info'

export type Ask = (accountId: string, system: string, prompt: string) => Promise<string | undefined>
type Tied = RoomDef & { account: string }
type Choice = { review?: boolean; chosen?: string }

interface Entry {
  folder: string
  room: string
}

const mwsApps = [
  ['marketplace', 'mkt'],
  ['admin', 'adm'],
  ['mobile', 'mob'],
] as const

const inside = (path: string, folder: string) => folder === '/' || path === folder || path.startsWith(`${folder}/`)
const onto = (path: string, from: string, to: string) => (inside(path, from) ? to + path.slice(from.length) : undefined)
const tilde = (path: string) => (inside(path, homedir()) ? `~${path.slice(homedir().length)}` : path)
const hex = (accent: string) => Number.parseInt(accent.slice(1), 16)
const slotAccents = [0x0891b2, 0xca8a04, 0xdc2626, 0x4f46e5, 0x65a30d, 0xc026d3]
const namePrompt = 'A coding agent is starting on the task below, in the folder below. None of the office rooms fit it, so it gets a new room. On the first line, name the room in 1 to 3 words, like a team or project name. On the second line, say in one sentence what work belongs in this room. Reply with the two lines only.'
const clean = (line: string) => line.replace(/^["'`*#\s]+|["'`*.\s]+$/g, '')

function storedRoom(value: unknown): RoomDef | undefined {
  const room = value as Partial<RoomDef> & { folder?: unknown }
  if (typeof room?.id !== 'string' || typeof room.name !== 'string') return undefined
  if (typeof room.subtitle === 'string' && typeof room.accent === 'number' && typeof room.look === 'string') return room as RoomDef
  const folder = typeof room.folder === 'string' ? room.folder : undefined
  const slot = Number(/^r(\d)$/.exec(room.id)?.[1] ?? 1)
  return {
    id: room.id,
    name: room.name,
    subtitle: folder ? tilde(folder) : 'room made by Claude',
    accent: slotAccents[slot - 1] ?? palette[0],
    look: 'plain',
    ...(typeof room.about === 'string' ? { about: room.about } : {}),
    ...(folder ? { root: folder, parent: basename(dirname(folder)) } : {}),
    createdAt: 0,
  }
}

const realpath = memo((path) => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
})

const locate = memo((cwd): { path: string; root?: string } => {
  const real = realpath(cwd)
  const info = repoInfo(real)
  return info ? { path: onto(real, info.top, info.root) ?? real, root: info.root } : { path: realpath(repoPath(real)) }
})

const longest = (path: string, entries: readonly Entry[]) =>
  entries.reduce<Entry | undefined>((best, entry) => (inside(path, entry.folder) && entry.folder.length > (best?.folder.length ?? -1) ? entry : best), undefined)?.room

function freeAccent(rooms: readonly Pick<RoomDef, 'id' | 'accent'>[], busy: ReadonlySet<string>): number {
  const weight = (accent: number) => rooms.reduce((sum, room) => sum + (room.accent !== accent ? 0 : busy.has(room.id) ? rooms.length + 1 : 1), 0)
  return palette.reduce((best, accent) => (weight(accent) < weight(best) ? accent : best))
}

export type Rooms = ReturnType<typeof createRooms>

export function createRooms(settings: Pick<Db, 'setting' | 'saveSetting'>, loaded: LoadedConfig, occupied: () => Iterable<string>, ask?: Ask) {
  const events = new EventEmitter<{ changed: [] }>()
  const saved = settings.setting('rooms')
  const built = (Array.isArray(saved) ? saved : []).flatMap((value) => storedRoom(value) ?? [])
  const savedRoots = settings.setting('mwsRoots')
  const roots = (Array.isArray(savedRoots) ? savedRoots : []).filter((root): root is string => typeof root === 'string')
  const making = new Map<string, Promise<RoomDef | undefined>>()
  const explicit = loaded.config.rooms.flatMap((room) => (room.accent ? [{ id: room.id, accent: hex(room.accent) }] : []))
  const config: RoomDef[] = []
  for (const room of loaded.config.rooms) {
    const subtitle = room.account ? `${room.account} account` : (room.folders ?? []).map(tilde).join(' · ')
    const accent = room.accent ? hex(room.accent) : freeAccent([...built, ...explicit, ...config], new Set())
    config.push({ id: room.id, name: room.name, subtitle, accent, look: room.look ?? 'plain', ...(room.account ? { account: room.account } : {}) })
  }
  const tied = config.filter((room): room is Tied => !!room.account)
  const configEntries = loaded.config.rooms.flatMap((room) => (room.folders ?? []).map((folder) => ({ folder: realpath(folder), room: room.id })))
  const playgroundEntries = loaded.config.playground.map((folder) => ({ folder: realpath(folder), room: playgroundRoom.id }))
  const mwsEntries = () => roots.flatMap((root) => [...mwsApps.map(([app, room]) => ({ folder: join(root, 'frontend', app), room })), { folder: root, room: 'plat' }])

  const list = (): RoomDef[] => [...(roots.length ? mwsRooms : []), playgroundRoom, reviewRoom, ...config, ...built]
  const byId = (id: string) => list().find((room) => room.id === id)
  const tiedRoom = (label?: string) => tiedRoomIn(tied, label)

  function remember(root: string) {
    if (roots.includes(root)) return
    roots.push(root)
    settings.saveSetting('mwsRoots', roots)
    events.emit('changed')
  }

  const draft = (root: string, name = basename(root), about?: string): RoomDef => ({
    id: `r-${createHash('sha256').update(root).digest('hex').slice(0, 10)}`,
    name,
    ...(about ? { about } : {}),
    subtitle: tilde(root),
    accent: freeAccent(list(), new Set(occupied())),
    look: 'plain',
    root,
    parent: basename(dirname(root)),
    createdAt: Date.now(),
  })

  function build(root: string, name?: string, about?: string) {
    return add(draft(root, name, about))
  }

  function add(room: RoomDef) {
    built.push(room)
    settings.saveSetting('rooms', built)
    events.emit('changed')
    return room.id
  }

  function home(cwd: string): string | { root: string } {
    const { path, root } = locate(cwd)
    if (root && isMwsMonorepo(root)) remember(root)
    const room = longest(path, [...configEntries, ...mwsEntries(), ...playgroundEntries])
    const own = built.find((room) => room.root === (root ?? path))?.id
    if (room && !(room === playgroundRoom.id && own)) return room
    if (own) return own
    if (!root) return playgroundRoom.id
    return loaded.unreadable ? playgroundRoom.id : { root }
  }

  async function name(accountId: string, root: string, task: string): Promise<RoomDef | undefined> {
    const reply = ask ? await ask(accountId, namePrompt, `Folder: ${root}\n\nTask: ${task.slice(0, 4000)}`).catch(() => undefined) : undefined
    const [title, about] = (reply ?? '').split('\n').map(clean).filter(Boolean)
    return built.find((room) => room.root === root) ?? byId(build(root, title?.slice(0, 28) || undefined, about))
  }

  const decide = (cwd: string, label: string | undefined, { review, chosen }: Choice) => (review ? reviewRoom.id : chosen && byId(chosen) ? chosen : (tiedRoom(label) ?? home(cwd)))

  function resolve(cwd: string, label?: string, { build: allowed, ...choice }: Choice & { build?: boolean } = {}): string {
    const room = decide(cwd, label, choice)
    return typeof room === 'string' ? room : allowed ? build(room.root) : playgroundRoom.id
  }

  return {
    events,
    configErrors: { ...(loaded.unreadable ? { unreadable: loaded.unreadable } : {}), skipped: loaded.skipped },
    list,
    byId,
    nameOf: (id?: string) => ((id && byId(id)) || playgroundRoom).name,
    resolve,
    tiedRoom,
    isTied: (id: string) => tied.some((room) => room.id === id),
    roomFor(cwd: string, label?: string): RoomDef & { isNew?: true } {
      const room = decide(cwd, label, {})
      return typeof room === 'string' ? (byId(room) ?? playgroundRoom) : { ...draft(room.root), isNew: true }
    },
    folders(id: string): string[] {
      return [...configEntries, ...mwsEntries(), ...built.flatMap((room) => (room.root ? [{ folder: room.root, room: room.id }] : []))].filter((entry) => entry.room === id).map((entry) => tilde(entry.folder))
    },
    make(accountId: string, cwd: string, task: string): Promise<RoomDef | undefined> {
      if (loaded.unreadable) return Promise.resolve(undefined)
      const { root } = locate(cwd)
      const known = root && built.find((room) => room.root === root)
      if (known) return Promise.resolve(known)
      const room = home(cwd)
      if (!root || (typeof room === 'string' && room !== playgroundRoom.id)) return Promise.resolve(undefined)
      const pending = making.get(root) ?? name(accountId, root, task).finally(() => making.delete(root))
      making.set(root, pending)
      return pending
    },
    evidenceRoom(file: string, chatCwd: string): string | undefined {
      const cwd = locate(chatCwd).path
      const path = repoPath(onto(file, chatCwd, cwd) ?? file)
      const room = longest(path, [...configEntries, ...mwsEntries()]) ?? longest(path, built.flatMap((room) => (room.root ? [{ folder: room.root, room: room.id }] : [])))
      return room ?? (inside(path, cwd) ? resolve(chatCwd) : undefined)
    },
    revalidate(chat: { cwd: string; department?: string; review?: boolean }, label?: string): string | undefined {
      const room = chat.department ? byId(chat.department) : undefined
      const stale = !!room?.root && !!longest(realpath(room.root), configEntries)
      const kept = chat.department && ((room && !stale) || (loaded.unreadable && chat.department.startsWith('c-')))
      return kept ? undefined : resolve(chat.cwd, label, { review: chat.review })
    },
  }
}
