import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ChatState, Visitor } from '../../shared/chat'
import { normalize, type ChatEvent } from '../sessions/normalize'
import type { DesktopChat } from './desktop-meta'
import { isSessionId } from './listener'

export interface VisitorSeed {
  sessionId: string
  source: Visitor
  instance?: string
  cwd: string
  title: string
  titled: boolean
  state: ChatState
  createdAt: number
  lastActivityAt: number
  archived: boolean
  evidence: ChatEvent[][]
}

interface Entry {
  type?: string
  isSidechain?: boolean
  isMeta?: boolean
  timestamp?: string
  cwd?: string
  entrypoint?: string
  message?: { content?: unknown; stop_reason?: string | null }
}

interface Head {
  prompt?: string
  cwd?: string
  entrypoint?: string
  createdAt?: number
}

interface Tail {
  ending?: { at: number; interrupted: boolean }
  evidence: ChatEvent[][]
}

interface File {
  sessionId: string
  path: string
  mtimeMs: number
  size: number
}

export const activeWindowMs = 24 * 60 * 60_000
export const workingWindowMs = 5 * 60_000
const headBytes = 256 * 1024
const tailBytes = [128 * 1024, 2 * 1024 * 1024]
const unfinished = new Set(['tool_use', 'pause_turn'])
const reminders = /<system-reminder>[\s\S]*?<\/system-reminder>/g

export const titleOf = (text: string) => text.trim().split('\n')[0]!.slice(0, 60)

function readSlice(path: string, bytes: number, fromEnd: boolean): string {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const buffer = Buffer.alloc(Math.min(bytes, size))
    const read = readSync(fd, buffer, 0, buffer.length, fromEnd ? size - buffer.length : 0)
    return buffer.toString('utf8', 0, read)
  } finally {
    closeSync(fd)
  }
}

function entries(text: string, dropFirst: boolean): Entry[] {
  const lines = text.split('\n')
  if (dropFirst) lines.shift()
  return lines.flatMap((line) => {
    try {
      const entry: unknown = JSON.parse(line)
      return entry && typeof entry === 'object' ? [entry as Entry] : []
    } catch {
      return []
    }
  })
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((block: { type?: unknown; text?: unknown }) => (block?.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n')
}

function promptOf(entry: Entry): string | undefined {
  const text = textOf(entry.message?.content).replace(reminders, '').trim()
  return text && !/^(<|Caveat:|\[Request interrupted)/.test(text) ? titleOf(text) : undefined
}

const isTurn = (entry: Entry) => (entry.type === 'user' || entry.type === 'assistant') && !entry.isSidechain && !entry.isMeta

function endingOf(entry: Entry, mtimeMs: number): Tail['ending'] {
  const at = Date.parse(entry.timestamp ?? '') || mtimeMs
  if (entry.type === 'assistant') return entry.message?.stop_reason && !unfinished.has(entry.message.stop_reason) ? { at, interrupted: false } : undefined
  return textOf(entry.message?.content).startsWith('[Request interrupted') ? { at, interrupted: true } : undefined
}

function readHead(path: string): Head {
  const head = entries(readSlice(path, headBytes, false), false)
  const stamped = head.find((entry) => entry.timestamp)?.timestamp
  return {
    prompt: head.filter((entry) => entry.type === 'user' && isTurn(entry)).map(promptOf).find(Boolean),
    cwd: head.find((entry) => typeof entry.cwd === 'string')?.cwd,
    entrypoint: head.find((entry) => typeof entry.entrypoint === 'string')?.entrypoint,
    createdAt: stamped ? Date.parse(stamped) || undefined : undefined,
  }
}

function readTail(file: File): Tail {
  for (const bytes of tailBytes) {
    const turns = entries(readSlice(file.path, bytes, true), file.size > bytes).filter(isTurn)
    const last = turns.at(-1)
    if (!last && file.size > bytes) continue
    return { ending: last && endingOf(last, file.mtimeMs), evidence: turns.filter((entry) => entry.type === 'assistant').map((entry) => normalize(entry as unknown as SDKMessage)) }
  }
  return { evidence: [] }
}

export function inferState(tail: Pick<Tail, 'ending'>, mtimeMs: number, now: number, focusedAt?: number): ChatState {
  if (tail.ending) return !tail.ending.interrupted && focusedAt !== undefined && focusedAt < tail.ending.at ? 'done' : 'idle'
  return now - mtimeMs < workingWindowMs ? 'working' : 'idle'
}

const folders = (dir: string) => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function fileOf(sessionId: string, path: string): File | undefined {
  const stat = statSync(path, { throwIfNoEntry: false })
  return stat?.isFile() ? { sessionId, path, mtimeMs: stat.mtimeMs, size: stat.size } : undefined
}

export function createDiscovery({ projectsDir, desktop }: { projectsDir: string; desktop: (since?: number, wanted?: ReadonlySet<string>) => ReadonlyMap<string, DesktopChat> }) {
  const heads = new Map<string, Head>()
  const tails = new Map<string, Tail & { mtimeMs: number; size: number }>()

  const transcripts = (): File[] =>
    folders(projectsDir).flatMap((folder) =>
      folders(join(projectsDir, folder)).flatMap((name) => {
        const sessionId = name.replace(/\.jsonl$/, '')
        const file = name.endsWith('.jsonl') && isSessionId(sessionId) ? fileOf(sessionId, join(projectsDir, folder, name)) : undefined
        return file ? [file] : []
      }),
    )

  function seed(file: File, meta: DesktopChat | undefined, now: number): VisitorSeed | undefined {
    const head = meta?.title && meta.cwd ? {} : (heads.get(file.path) ?? readHead(file.path))
    if (head.prompt || file.size >= headBytes) heads.set(file.path, head)
    const source: Visitor | undefined = meta ? 'desktop' : head.entrypoint === 'cli' ? 'terminal' : undefined
    if (!source) return undefined
    let tail = tails.get(file.path)
    if (tail?.mtimeMs !== file.mtimeMs || tail.size !== file.size) tails.set(file.path, (tail = { mtimeMs: file.mtimeMs, size: file.size, ...readTail(file) }))
    const cwd = meta?.cwd ?? head.cwd ?? ''
    const title = meta?.title ?? head.prompt
    return {
      sessionId: file.sessionId,
      source,
      instance: meta?.instance,
      cwd,
      title: title ?? (basename(cwd) || 'Outside chat'),
      titled: !!title,
      state: inferState(tail, file.mtimeMs, now, meta?.lastFocusedAt),
      createdAt: meta?.createdAt ?? head.createdAt ?? file.mtimeMs,
      lastActivityAt: Math.max(file.mtimeMs, meta?.lastActivityAt ?? 0),
      archived: meta?.archived ?? false,
      evidence: tail.evidence,
    }
  }

  return {
    scan(now: number, skip: ReadonlySet<string>): VisitorSeed[] {
      const since = now - activeWindowMs
      const files = transcripts()
      const metas = desktop(since, new Set(files.flatMap((file) => (file.mtimeMs >= since ? [file.sessionId] : []))))
      const prior = new Set([...metas.values()].flatMap((meta) => meta.priorSessionIds))
      return files.flatMap((file) => {
        const meta = metas.get(file.sessionId)
        if (skip.has(file.sessionId) || prior.has(file.sessionId) || now - Math.max(file.mtimeMs, meta?.lastActivityAt ?? 0) > activeWindowMs) return []
        return seed(file, meta, now) ?? []
      })
    },

    describe(sessionId: string, now: number): VisitorSeed | undefined {
      if (!isSessionId(sessionId)) return undefined
      for (const folder of folders(projectsDir)) {
        const file = fileOf(sessionId, join(projectsDir, folder, `${sessionId}.jsonl`))
        if (file) return seed(file, desktop(now - activeWindowMs, new Set([sessionId])).get(sessionId), now)
      }
      return undefined
    },
  }
}
