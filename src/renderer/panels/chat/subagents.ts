import type { InjectionKey } from 'vue'
import type { ChatRow } from '../../../shared/chat'
import type { AgentItem, Item } from './groups'

export type AgentStatus = 'running' | 'done' | 'failed' | 'stopped'

export interface AgentOutcome {
  status: AgentStatus
  agentId?: string
  tools?: number
  tokens?: number
  ms?: number
  report?: string
}

export const statusLabels: Record<AgentStatus, string> = { running: 'Working', done: 'Done', failed: 'Failed', stopped: 'Stopped' }

export const openSubagentKey: InjectionKey<(item: AgentItem) => void> = Symbol('openSubagent')

const tag = (source: string, name: string) => source.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim()

function usage(source: string) {
  const block = tag(source, 'usage') ?? ''
  const count = (key: string) => {
    const match = block.match(new RegExp(`${key}\\D{0,3}(\\d+)`))
    return match ? Number(match[1]) : undefined
  }
  return { tokens: count('subagent_tokens'), tools: count('tool_uses'), ms: count('duration_ms') }
}

const noteStatus: Record<string, AgentStatus> = { completed: 'done', failed: 'failed', stopped: 'stopped', killed: 'stopped' }

export function findAgent(list: readonly Item[], id: string): AgentItem | undefined {
  for (const entry of list) {
    if (entry.kind !== 'agent') continue
    if (entry.row.id === id) return entry
    const nested = findAgent(entry.items, id)
    if (nested) return nested
  }
  return undefined
}

export function notesByToolUse(rows: readonly ChatRow[]): Map<string, string> {
  const notes = new Map<string, string>()
  for (const row of rows) {
    if (row.kind !== 'user' || !row.text.startsWith('<task-notification>')) continue
    const id = tag(row.text, 'tool-use-id')
    if (id) notes.set(id, row.text)
  }
  return notes
}

export function agentOutcome(item: AgentItem, running: ReadonlySet<string>, note?: string): AgentOutcome {
  const result = item.row.result
  const text = result?.text ?? ''
  const agentId = text.match(/\nagentId: ([\w-]+)/)?.[1] ?? (note && tag(note, 'task-id'))
  const launched = text.startsWith('Async agent launched')
  const status: AgentStatus = running.has(item.row.id) || !result ? 'running' : note ? (noteStatus[tag(note, 'status') ?? ''] ?? 'done') : result.isError ? 'failed' : 'done'
  const report = note ? tag(note, 'result') : launched ? undefined : text.replace(/\n*agentId: [\s\S]*$/, '').trim()
  const stats = usage(note ?? text)
  return { status, ...(agentId ? { agentId } : {}), ...stats, ...(report ? { report } : {}) }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`
const tokenCount = (count: number) => (count < 1000 ? plural(count, 'token') : `${(count / 1000).toFixed(1)}k tokens`)

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function agentStats({ agentType, tools, tokens, ms }: { agentType?: string; tools?: number; tokens?: number; ms?: number }): string {
  return [agentType, tools ? plural(tools, 'tool use') : '', tokens ? tokenCount(tokens) : '', ms === undefined ? '' : elapsed(ms)].filter(Boolean).join(' · ')
}
