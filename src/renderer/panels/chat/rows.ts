import type { ChatRow } from '../../../shared/chat'

export type ToolRow = Extract<ChatRow, { kind: 'tool' }>

export type Entry = { row: ChatRow; children: ChatRow[] }

const subagentTools = new Set(['Agent', 'Task'])

export const isSubagent = (row: ToolRow): boolean => subagentTools.has(row.name)

const parentOf = (row: ChatRow) => (row.kind === 'text' || row.kind === 'tool' ? row.parentToolUseId : undefined)

export function entries(rows: readonly ChatRow[]): Entry[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const rootOf = (row: ChatRow) => {
    let current = row
    for (let depth = 0, parent = parentOf(current); parent && byId.has(parent) && depth < 8; depth++, parent = parentOf(current)) current = byId.get(parent)!
    return current
  }
  const roots = new Map<string, Entry>()
  for (const row of rows) if (rootOf(row) === row) roots.set(row.id, { row, children: [] })
  for (const row of rows) {
    const root = rootOf(row)
    if (root !== row) roots.get(root.id)?.children.push(row)
  }
  return [...roots.values()]
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const lines = (value: unknown) => (text(value) ? text(value).split('\n').length : 0)
const baseName = (path: unknown) => text(path).split('/').pop() ?? ''
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

export function diffStats(row: Pick<ToolRow, 'name' | 'input'>): { added: number; removed: number } | undefined {
  const input = (row.input ?? {}) as Record<string, unknown>
  switch (row.name) {
    case 'Edit':
      return { added: lines(input.new_string), removed: lines(input.old_string) }
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : []
      return edits.reduce<{ added: number; removed: number }>((sum, edit) => ({ added: sum.added + lines(edit.new_string), removed: sum.removed + lines(edit.old_string) }), { added: 0, removed: 0 })
    }
    case 'Write':
      return { added: lines(input.content), removed: 0 }
    default:
      return undefined
  }
}

export function toolTarget(row: Pick<ToolRow, 'name' | 'input'>): string {
  const input = (row.input ?? {}) as Record<string, unknown>
  switch (row.name) {
    case 'Bash':
      return text(input.command).split('\n')[0] ?? ''
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'Read':
    case 'NotebookEdit':
      return baseName(input.file_path ?? input.notebook_path)
    case 'Grep':
    case 'Glob':
      return text(input.pattern)
    case 'WebFetch':
      return URL.parse(text(input.url))?.hostname ?? text(input.url)
    case 'WebSearch':
      return text(input.query)
    case 'Agent':
    case 'Task':
      return text(input.description)
    default: {
      const first = Object.values(input).find((value) => typeof value === 'string')
      return typeof first === 'string' ? first : ''
    }
  }
}

export function resultSummary(row: Pick<ToolRow, 'result'>): string {
  const result = row.result
  if (!result) return 'running…'
  const body = result.text.trim()
  if (!body) return result.isError ? 'Error' : 'Done'
  const first = clip(body.split('\n')[0]!, 80)
  const count = body.split('\n').length
  const summary = count > 1 ? `${first} · ${count} lines` : first
  return result.isError ? `Error: ${summary}` : summary
}

export function toolDetail(row: Pick<ToolRow, 'name' | 'input'>): string {
  const input = (row.input ?? {}) as Record<string, unknown>
  if (row.name === 'Bash') return text(input.command)
  try {
    return JSON.stringify(input, null, 2) ?? ''
  } catch {
    return ''
  }
}

export function subagentState(row: ToolRow, running: ReadonlySet<string>): 'running' | 'done' | 'failed' {
  if (row.result?.isError) return 'failed'
  return row.result && !running.has(row.id) ? 'done' : 'running'
}

export const plainLabel = (row: ChatRow) => ('label' in row && typeof row.label === 'string' ? row.label : String((row as { kind?: unknown }).kind ?? 'event'))

export type Artifact = { title: string; url: string; path: string; version?: number; edited: boolean }

export function artifacts(rows: readonly ChatRow[]): Map<string, Artifact> {
  const published = new Map<string, Artifact>()
  const seen = new Set<string>()
  for (const row of rows) {
    if (row.kind !== 'tool' || row.name !== 'Artifact' || !row.result || row.result.isError) continue
    const input = (row.input ?? {}) as Record<string, unknown>
    if (input.action !== undefined && input.action !== 'publish') continue
    const url = /\bat (https:\/\/\S+)/.exec(row.result.text)?.[1] ?? text(input.url)
    const path = text(input.file_path)
    if (!url || !path) continue
    const version = Number(/\(Version (\d+)\)/.exec(row.result.text)?.[1]) || undefined
    const title = text(input.title) || baseName(path).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
    published.set(row.id, { title, url, path, version, edited: seen.has(url) || !!input.url || (version ?? 1) > 1 })
    seen.add(url)
  }
  return published
}

export function latestArtifacts(rows: readonly ChatRow[]): Artifact[] {
  const byUrl = new Map<string, Artifact>()
  for (const artifact of artifacts(rows).values()) {
    byUrl.delete(artifact.url)
    byUrl.set(artifact.url, artifact)
  }
  return [...byUrl.values()].reverse()
}
