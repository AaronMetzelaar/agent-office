import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export interface DesktopChat {
  sessionId: string
  instance: string
  title?: string
  cwd?: string
  archived: boolean
  createdAt?: number
  lastActivityAt?: number
  lastFocusedAt?: number
  priorSessionIds: string[]
}

export const sessionsFolder = 'claude-code-sessions'
export const desktopDir = () => process.env.AGENT_OFFICE_DESKTOP_DIR ?? join(homedir(), 'Library', 'Application Support')

const metaFile = /^local_.*\.json$/
const cliId = /"cliSessionId"\s*:\s*"([^"]+)"/
const prefixBytes = 4096
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
const time = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

export function instances(root: string): string[] {
  try {
    return readdirSync(root).filter((name) => statSync(join(root, name, sessionsFolder), { throwIfNoEntry: false })?.isDirectory())
  } catch {
    return []
  }
}

export function parseMeta(json: string, instance: string): DesktopChat | undefined {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json)
  } catch {
    return undefined
  }
  const sessionId = text(raw?.cliSessionId)
  if (!sessionId) return undefined
  return {
    sessionId,
    instance,
    title: text(raw.title),
    cwd: text(raw.cwd),
    archived: raw.isArchived === true,
    createdAt: time(raw.createdAt),
    lastActivityAt: time(raw.lastActivityAt),
    lastFocusedAt: time(raw.lastFocusedAt),
    priorSessionIds: Array.isArray(raw.priorCliSessionIds) ? raw.priorCliSessionIds.filter((id): id is string => typeof id === 'string') : [],
  }
}

function metaFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((path) => metaFile.test(basename(path))).map((path) => join(dir, path))
  } catch {
    return []
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function readPrefix(path: string): string {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(prefixBytes)
    return buffer.toString('utf8', 0, readSync(fd, buffer, 0, prefixBytes, 0))
  } catch {
    return ''
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function createDesktopMeta(root: string) {
  const cache = new Map<string, { mtimeMs: number; sessionId?: string; chat?: DesktopChat }>()

  function read(since = 0, wanted: ReadonlySet<string> = new Set()): Map<string, DesktopChat> {
    const chats = new Map<string, DesktopChat>()
    const seen = new Set<string>()
    for (const instance of instances(root)) {
      for (const file of metaFiles(join(root, instance, sessionsFolder))) {
        const mtimeMs = statSync(file, { throwIfNoEntry: false })?.mtimeMs
        if (mtimeMs === undefined) continue
        seen.add(file)
        let entry = cache.get(file)
        if (entry?.mtimeMs !== mtimeMs) cache.set(file, (entry = { mtimeMs, sessionId: cliId.exec(readPrefix(file))?.[1] }))
        if (mtimeMs < since && entry.sessionId && !wanted.has(entry.sessionId)) continue
        if (!('chat' in entry)) entry.chat = parseMeta(readText(file), instance)
        const chat = entry.chat
        if (chat && (chats.get(chat.sessionId)?.lastActivityAt ?? -Infinity) <= (chat.lastActivityAt ?? 0)) chats.set(chat.sessionId, chat)
      }
    }
    for (const file of cache.keys()) if (!seen.has(file)) cache.delete(file)
    return chats
  }

  function watchChanges(onChange: () => void): () => void {
    const watchers = instances(root).flatMap((instance) => {
      try {
        return [watch(join(root, instance, sessionsFolder), { recursive: true }, (_event, file) => file && metaFile.test(basename(file)) && onChange())]
      } catch {
        return []
      }
    })
    return () => watchers.forEach((watcher) => watcher.close())
  }

  return { read, watch: watchChanges }
}
