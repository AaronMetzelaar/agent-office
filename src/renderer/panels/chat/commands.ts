import { kindLabels, type CommandEntry, type CommandKind } from '../../../shared/commands'

export interface Span {
  start: number
  end: number
}

export interface Trigger extends Span {
  query: string
}

export interface CommandGroup {
  label: string
  entries: CommandEntry[]
}

export type PickerAction = { kind: 'move'; index: number } | { kind: 'choose' } | { kind: 'close' }

type Key = { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }

const kinds: CommandKind[] = ['skill', 'command', 'plugin', 'builtin']
const recentKey = 'agent-office:recent-commands'

export function slashTrigger(text: string, caret: number): Trigger | undefined {
  const match = /(^|\s)\/([\w:.-]*)$/.exec(text.slice(0, caret))
  if (!match) return undefined
  return { start: match.index + match[1]!.length, end: caret + /^\S*/.exec(text.slice(caret))![0].length, query: match[2]! }
}

export function insertCommand(text: string, name: string, { start, end }: Span): { text: string; caret: number } {
  const lead = start > 0 && !/\s/.test(text[start - 1]!) ? ' ' : ''
  const head = `${text.slice(0, start)}${lead}/${name} `
  return { text: head + text.slice(end).replace(/^ /, ''), caret: head.length }
}

function subsequence(name: string, query: string): number {
  let at = -1
  let gaps = 0
  for (const char of query) {
    const next = name.indexOf(char, at + 1)
    if (next < 0) return 0
    if (at >= 0) gaps += next - at - 1
    at = next
  }
  return Math.max(1.5, 2 - gaps * 0.01)
}

export function score({ name, description }: CommandEntry, query: string): number {
  const q = query.toLowerCase()
  if (!q) return 1
  const lower = name.toLowerCase()
  const at = lower.indexOf(q)
  if (at === 0) return 4 - lower.length * 0.001
  if (at > 0) return /[:\-_.]/.test(lower[at - 1]!) ? 3 : 2.5
  return subsequence(lower, q) || (description.toLowerCase().includes(q) ? 1 : 0)
}

export function groupCommands(entries: readonly CommandEntry[], query: string, recent: readonly string[] = [], limit = Infinity): CommandGroup[] {
  const q = query.trim()
  const rank = new Map(recent.map((name, index) => [name, index]))
  let groups: CommandGroup[]
  if (!q) {
    const byName = new Map(entries.map((entry) => [entry.name, entry]))
    const used = recent.flatMap((name) => byName.get(name) ?? [])
    const rest = entries.filter((entry) => !rank.has(entry.name)).sort((a, b) => a.name.localeCompare(b.name))
    groups = [{ label: 'Recently used', entries: used }, ...kinds.map((kind) => ({ label: kindLabels[kind], entries: rest.filter((entry) => entry.kind === kind) }))]
  } else {
    const scored = entries
      .map((entry) => ({ entry, score: score(entry, q) }))
      .filter((item) => item.score > 0)
      .map((item) => ({ ...item, score: item.score + (rank.has(item.entry.name) ? 0.1 - rank.get(item.entry.name)! * 0.001 : 0) }))
      .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    groups = kinds
      .map((kind) => ({ kind, items: scored.filter((item) => item.entry.kind === kind) }))
      .filter((group) => group.items.length)
      .sort((a, b) => b.items[0]!.score - a.items[0]!.score)
      .map((group) => ({ label: kindLabels[group.kind], entries: group.items.map((item) => item.entry) }))
  }
  let left = limit
  return groups
    .map((group) => {
      const kept = group.entries.slice(0, Math.max(0, left))
      left -= kept.length
      return { ...group, entries: kept }
    })
    .filter((group) => group.entries.length)
}

export function pickerKey(event: Key, active: number, count: number): PickerAction | undefined {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return undefined
  if (event.key === 'Escape') return { kind: 'close' }
  if (!count) return undefined
  if (event.key === 'ArrowDown') return { kind: 'move', index: (active + 1) % count }
  if (event.key === 'ArrowUp') return { kind: 'move', index: (active - 1 + count) % count }
  if (event.key === 'Enter' || event.key === 'Tab') return { kind: 'choose' }
  return undefined
}

export function recentCommands(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(recentKey) ?? '[]')
    return Array.isArray(saved) ? saved.filter((name): name is string => typeof name === 'string') : []
  } catch {
    return []
  }
}

export function rememberCommand(name: string, recent: readonly string[]): string[] {
  const next = [name, ...recent.filter((other) => other !== name)].slice(0, 8)
  try {
    localStorage.setItem(recentKey, JSON.stringify(next))
  } catch {}
  return next
}
