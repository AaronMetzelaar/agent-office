import type { ChatState, StuckReason } from './chat'

export interface Queueable {
  id: string
  accountId: string
  state: ChatState
  since: number
  stuckReason?: StuckReason
}

export interface QueueItem {
  key: string
  kind: 'request' | 'stuck' | 'login'
  chatId?: string
  accountId: string
  label?: string
  since: number
  chats: string[]
}

export function buildQueue(agents: readonly Queueable[], logins: readonly { accountId: string; label: string }[] = []): QueueItem[] {
  const items: QueueItem[] = []
  const grouped = new Map(logins.map((login) => [login.accountId, { key: `login:${login.accountId}`, kind: 'login' as const, accountId: login.accountId, label: login.label, since: Infinity, chats: [] as string[] } as QueueItem]))
  for (const agent of agents) {
    const login = agent.state === 'stuck' && agent.stuckReason === 'needs-login' ? grouped.get(agent.accountId) : undefined
    if (login) {
      login.chats.push(agent.id)
      if (agent.since < login.since) Object.assign(login, { since: agent.since, chatId: agent.id })
    } else if (agent.state === 'needs-you' || agent.state === 'stuck') items.push({ key: agent.id, kind: agent.state === 'stuck' ? 'stuck' : 'request', chatId: agent.id, accountId: agent.accountId, since: agent.since, chats: [agent.id] })
  }
  return [...items, ...grouped.values()].sort((a, b) => a.since - b.since || (a.key < b.key ? -1 : 1))
}

export function queuePositions(queue: readonly QueueItem[]): Map<string, number> {
  const positions = new Map<string, number>()
  for (const item of queue) if (item.chatId) positions.set(item.chatId, positions.size)
  return positions
}
