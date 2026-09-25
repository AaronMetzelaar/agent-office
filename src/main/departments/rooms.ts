import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { mwsRooms, playgroundRoom, repoPath, reviewRoom, type RoomDef } from '../../shared/departments'
import { palette } from '../../shared/office'
import type { Db } from '../store/db'
import type { LoadedConfig } from './config'
import { isMwsMonorepo, memo, repoInfo } from './repo-info'

type Built = RoomDef & { root: string }
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

export function createRooms(settings: Pick<Db, 'setting' | 'saveSetting'>, loaded: LoadedConfig, occupied: () => Iterable<string>) {
  const events = new EventEmitter<{ changed: [] }>()
  const built = (settings.setting('rooms') as Built[] | undefined) ?? []
  const roots = (settings.setting('mwsRoots') as string[] | undefined) ?? []
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

  const list = (): RoomDef[] => [...(roots.length ? mwsRooms : []), reviewRoom, ...config, ...built, playgroundRoom]
  const byId = (id: string) => list().find((room) => room.id === id)
  const tiedRoom = (label?: string) => tied.filter((room) => label?.toLowerCase().includes(room.account.toLowerCase())).sort((a, b) => b.account.length - a.account.length)[0]?.id

  function remember(root: string) {
    if (roots.includes(root)) return
    roots.push(root)
    settings.saveSetting('mwsRoots', roots)
    events.emit('changed')
  }

  const draft = (root: string): Built => ({
    id: `r-${createHash('sha256').update(root).digest('hex').slice(0, 10)}`,
    name: basename(root),
    subtitle: tilde(root),
    accent: freeAccent(list(), new Set(occupied())),
    look: 'plain',
    root,
    parent: basename(dirname(root)),
    createdAt: Date.now(),
  })

  function build(root: string) {
    const room = draft(root)
    built.push(room)
    settings.saveSetting('rooms', built)
    events.emit('changed')
    return room.id
  }

  function home(cwd: string): string | { root: string } {
    const { path, root } = locate(cwd)
    if (root && isMwsMonorepo(root)) remember(root)
    const room = longest(path, [...configEntries, ...mwsEntries(), ...playgroundEntries])
    if (room) return room
    if (!root) return playgroundRoom.id
    return built.find((room) => room.root === root)?.id ?? (loaded.unreadable ? playgroundRoom.id : { root })
  }

  const decide = (cwd: string, label: string | undefined, { review, chosen }: Choice) => (review ? reviewRoom.id : chosen && byId(chosen) ? chosen : (tiedRoom(label) ?? home(cwd)))

  function resolve(cwd: string, label?: string, { build: allowed, ...choice }: Choice & { build?: boolean } = {}): string {
    const room = decide(cwd, label, choice)
    return typeof room === 'string' ? room : allowed ? build(room.root) : playgroundRoom.id
  }

  return {
    events,
    list,
    byId,
    resolve,
    tiedRoom,
    isTied: (id: string) => tied.some((room) => room.id === id),
    roomFor(cwd: string, label?: string): RoomDef & { isNew?: true } {
      const room = decide(cwd, label, {})
      return typeof room === 'string' ? (byId(room) ?? playgroundRoom) : { ...draft(room.root), isNew: true }
    },
    evidenceRoom(file: string, chatCwd: string): string | undefined {
      const cwd = locate(chatCwd).path
      const path = repoPath(onto(file, chatCwd, cwd) ?? file)
      const room = longest(path, [...configEntries, ...mwsEntries()]) ?? longest(path, built.map((room) => ({ folder: room.root, room: room.id })))
      return room ?? (inside(path, cwd) ? resolve(chatCwd) : undefined)
    },
    revalidate(chat: { cwd: string; department?: string; review?: boolean }, label?: string): string | undefined {
      const kept = chat.department && (byId(chat.department) || (loaded.unreadable && chat.department.startsWith('c-')))
      return kept ? undefined : resolve(chat.cwd, label, { review: chat.review })
    },
  }
}
