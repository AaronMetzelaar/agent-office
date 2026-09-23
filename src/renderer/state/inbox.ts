import type { ChatView, LoginItem } from '../../shared/chat'
import { hexOf, type DeptId } from '../../shared/office'
import type { PendingRequestView } from '../../shared/permissions'
import { buildQueue, type QueueItem } from '../../shared/queue'
import { countsFor, stateKey, type StateKey } from '../office/labels'
import { dept, depts } from '../office/layout'
import type { Agent } from './projection'

export interface WaitingItem {
  key: string
  kind: QueueItem['kind']
  chatId?: string
  accountId: string
  title: string
  colour: string
  dept?: string
  accent?: string
  since: number
  requests: PendingRequestView[]
  detail: string
  lastReply?: string
}

export interface BoardRow {
  id: string
  title: string
  colour: string
  state: StateKey
  caption: string
  since: number
}

export interface BoardGroup {
  id: DeptId
  name: string
  accent: string
  counts: ReturnType<typeof countsFor>
  rows: BoardRow[]
}

export interface Inbox {
  waiting: WaitingItem[]
  board: BoardGroup[]
  parked: number
}

export const emptyInbox: Inbox = { waiting: [], board: [], parked: 0 }

export function lastReply(chat: Pick<ChatView, 'rows' | 'partial'> | undefined): string | undefined {
  if (!chat) return undefined
  if (chat.partial) return chat.partial
  const row = chat.rows.findLast((row) => row.kind === 'text' && !row.parentToolUseId && !!row.text.trim())
  return row?.kind === 'text' ? row.text : undefined
}

export function buildInbox(chats: ReadonlyMap<string, ChatView>, agents: readonly Agent[], logins: readonly LoginItem[]): Inbox {
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const queue = buildQueue(agents, logins)
  const queued = new Set(queue.flatMap((item) => item.chats))
  const waiting = queue.map((item): WaitingItem => {
    const agent = item.chatId ? byId.get(item.chatId) : undefined
    const chat = item.chatId ? chats.get(item.chatId) : undefined
    const base = { key: item.key, kind: item.kind, chatId: item.chatId, accountId: item.accountId, since: item.since, lastReply: lastReply(chat) }
    if (item.kind === 'login') return { ...base, title: `${item.label ?? 'An account'} needs login`, colour: '#dc2626', requests: [], detail: `${item.chats.length} chat${item.chats.length === 1 ? '' : 's'} waiting · log in again` }
    return {
      ...base,
      title: agent?.title ?? chat?.title ?? '',
      colour: agent ? hexOf(agent.colour) : '#9ca3af',
      ...(agent ? { dept: dept[agent.dept].name, accent: hexOf(dept[agent.dept].accent) } : {}),
      requests: item.kind === 'request' ? (chat?.pendingRequests ?? []) : [],
      detail: agent?.caption ?? '',
    }
  })
  const seated = agents.filter((agent) => !agent.parked)
  const board = depts
    .map((d): BoardGroup => ({
      id: d.id,
      name: d.name,
      accent: hexOf(d.accent),
      counts: countsFor(seated.filter((agent) => agent.dept === d.id)),
      rows: seated
        .filter((agent) => agent.dept === d.id && !queued.has(agent.id))
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((agent) => ({ id: agent.id, title: agent.title, colour: hexOf(agent.colour), state: stateKey(agent.state), caption: agent.caption, since: agent.since })),
    }))
    .filter((group) => group.rows.length > 0)
  return { waiting, board, parked: agents.length - seated.length }
}
