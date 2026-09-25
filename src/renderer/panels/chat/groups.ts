import type { ChatRow } from '../../../shared/chat'
import { artifacts, entries, isSubagent, toolTarget, type Artifact, type ToolRow } from './rows'

export type AgentItem = { kind: 'agent'; row: ToolRow; items: Item[]; summary: string }
export type GroupItem = { kind: 'group'; id: string; rows: ChatRow[]; summary: string }
export type ArtifactItem = { kind: 'artifact'; row: ToolRow; artifact: Artifact }
export type Item = { kind: 'row'; row: ChatRow } | AgentItem | GroupItem | ArtifactItem

type Phrase = (count: number) => string
type Kind = { key: string; phrase: Phrase; perFile?: boolean }

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`
const times = (count: number) => (count === 1 ? 'once' : `${count} times`)
const shortName = (name: string) => name.split('__').pop() || name
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const inputOf = (row: ToolRow) => (row.input ?? {}) as Record<string, unknown>

const edited: Kind = { key: 'edit', phrase: (n) => `edited ${plural(n, 'file')}`, perFile: true }
const searched: Kind = { key: 'search', phrase: (n) => `searched ${times(n)}` }
const kinds: Record<string, Kind> = {
  Bash: { key: 'bash', phrase: (n) => `ran ${plural(n, 'command')}` },
  Read: { key: 'read', phrase: (n) => `read ${plural(n, 'file')}`, perFile: true },
  Edit: edited,
  MultiEdit: edited,
  NotebookEdit: edited,
  Write: { key: 'write', phrase: (n) => `wrote ${plural(n, 'file')}`, perFile: true },
  Grep: searched,
  Glob: searched,
  WebFetch: { key: 'fetch', phrase: (n) => `fetched ${plural(n, 'page')}` },
  WebSearch: { key: 'web', phrase: (n) => `searched the web ${times(n)}` },
  TodoWrite: { key: 'todo', phrase: () => 'updated the todo list' },
}
const kindOf = (name: string): Kind => kinds[name] ?? { key: `tool:${name}`, phrase: (n) => `used ${shortName(name)}${n === 1 ? '' : ` ${n} times`}` }

const entities: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'" }
const tag = (source: string, name: string) => source.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? ''

const isNotification = (row: ChatRow): row is Extract<ChatRow, { kind: 'user' }> => row.kind === 'user' && row.text.startsWith('<task-notification>')

export function notice(row: { text: string }): { summary: string; failed: boolean; command: boolean } {
  const summary = tag(row.text, 'summary').replace(/&(?:lt|gt|amp|quot|#39);/g, (entity) => entities[entity]!)
  return { summary: summary || 'Background task finished', failed: tag(row.text, 'status') === 'failed', command: /^Background (shell )?command/.test(summary) }
}

const groupable = (row: ChatRow) => (row.kind === 'tool' && !isSubagent(row)) || (row.kind === 'other' && !/\s/.test(row.label)) || isNotification(row)

export function summarize(rows: readonly ChatRow[]): string {
  const tools = rows.filter((row): row is ToolRow => row.kind === 'tool' && !isSubagent(row))
  const notices = rows.filter(isNotification).map(notice)
  const [only] = tools
  const described = text(only && inputOf(only).description).trim()
  if (tools.length === 1 && only?.name === 'Bash' && described && !notices.length) return only.result?.isError ? `${described} (failed)` : described
  const buckets = new Map<string, { phrase: Phrase; seen: Set<string>; failed: number }>()
  for (const tool of tools) {
    const { key, phrase, perFile } = kindOf(tool.name)
    const bucket = buckets.get(key) ?? buckets.set(key, { phrase, seen: new Set(), failed: 0 }).get(key)!
    const input = inputOf(tool)
    bucket.seen.add((perFile && text(input.file_path ?? input.notebook_path)) || tool.id)
    if (tool.result?.isError) bucket.failed++
  }
  const parts = [...buckets.values()].map(({ phrase, seen, failed }) => phrase(seen.size) + (failed ? ` (${failed} failed)` : ''))
  const commands = notices.filter((entry) => entry.command).length
  if (commands) parts.push(`finished ${plural(commands, 'background command')}`)
  if (notices.length > commands) parts.push(`finished ${plural(notices.length - commands, 'background task')}`)
  const line = parts.join(', ') || plural(rows.length, 'event')
  return line.charAt(0).toUpperCase() + line.slice(1)
}

const verbs: Record<string, string> = {
  Bash: 'Running',
  Read: 'Reading',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  NotebookEdit: 'Editing',
  Write: 'Writing',
  Grep: 'Searching',
  Glob: 'Searching',
  WebFetch: 'Fetching',
  WebSearch: 'Searching the web for',
}

export function doing(rows: readonly ChatRow[]): { verb: string; target: string } | undefined {
  const tool = rows.findLast((row): row is ToolRow => row.kind === 'tool' && !row.result)
  if (!tool) return undefined
  const verb = verbs[tool.name]
  return verb ? { verb, target: toolTarget(tool) } : { verb: 'Using', target: shortName(tool.name) }
}

function subagentLine(row: ToolRow, children: readonly ChatRow[]): string {
  const steps = children.filter(groupable)
  return [text(inputOf(row).subagent_type), steps.length ? summarize(steps) : ''].filter(Boolean).join(' · ')
}

export function items(rows: readonly ChatRow[], published = artifacts(rows)): Item[] {
  const out: Item[] = []
  for (const { row, children } of entries(rows)) {
    const last = out.at(-1)
    const artifact = published.get(row.id)
    if (artifact && row.kind === 'tool') out.push({ kind: 'artifact', row, artifact })
    else if (!groupable(row)) out.push(row.kind === 'tool' ? { kind: 'agent', row, items: items(children, published), summary: subagentLine(row, children) } : { kind: 'row', row })
    else if (last?.kind === 'group') last.rows.push(row)
    else out.push({ kind: 'group', id: row.id, rows: [row], summary: '' })
  }
  for (const item of out) if (item.kind === 'group') item.summary = summarize(item.rows)
  return out
}
