import type { Decision, PendingRequestView, RequestSource } from './permissions'

export const efforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof efforts)[number]
export const effortLabels: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }
export const defaultEffort: Effort = 'medium'
export const defaultModel = 'claude-opus-5-5'
export const modelLabels: Record<string, string> = { [defaultModel]: 'Opus 5.5', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' }

export const chatModes = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'] as const
export type ChatMode = (typeof chatModes)[number]

export type Visitor = 'desktop' | 'terminal'

export type ChatState = 'starting' | 'working' | 'needs-you' | 'done' | 'idle' | 'stuck'
export type StuckReason = 'needs-login' | 'rate-limited' | 'crashed' | 'interrupted' | 'error'

export interface Stuck {
  reason: StuckReason
  detail?: string
  retryAt?: number
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
}

export type ChatRow =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; id: string; text: string; parentToolUseId?: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; parentToolUseId?: string; result?: { text: string; isError: boolean } }
  | { kind: 'other'; id: string; label: string }

export interface Answered {
  id: string
  source: RequestSource
  decision: Decision['kind']
}

export interface OlderRows {
  rows: ChatRow[]
  more: boolean
}

export interface ChatFields {
  id: string
  accountId: string
  cwd: string
  title: string
  sessionId?: string
  model?: string
  effort?: Effort
  permissionMode?: ChatMode
  worktree?: string
  setup?: 'worktree' | 'worktree-failed'
  forkPending?: boolean
  visitor?: Visitor
  moved?: boolean
  retained?: boolean
  colour?: string
  department?: string
  review?: boolean
  archived: boolean
  parked?: boolean
  state: ChatState
  stuck?: Stuck
  stateSince: number
  unread: boolean
  activity: string
  pending: { id: string; toolName: string }[]
  pendingRequests: PendingRequestView[]
  oldestPendingAt?: number
  answered?: Answered[]
  earlier?: boolean
  subagents: { id: string; description: string }[]
  usage: Usage
  partial: string
  createdAt: number
  lastActivityAt: number
}

export interface ChatView extends ChatFields {
  rows: ChatRow[]
}

export interface ChatPatch {
  id: string
  fields?: Partial<ChatFields>
  rows?: ChatRow[]
  replaceRows?: boolean
  partialAppend?: string
}

export interface LoginItem {
  accountId: string
  label: string
}

export interface ChatSnapshot {
  seq: number
  chats: ChatView[]
  logins: LoginItem[]
}

export interface ChatPatchBatch {
  seq: number
  patches: ChatPatch[]
  logins?: LoginItem[]
}

export interface Refusal {
  error: string
  code: 'needs-login'
}

export type StartChatResult = { chatId: string } | { error: string; code?: Refusal['code'] }

export const maxRows = 200

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 })

export function applyPatch(chat: ChatView, patch: ChatPatch): ChatView {
  const next: ChatView = { ...chat, ...patch.fields }
  if (patch.partialAppend) next.partial += patch.partialAppend
  if (patch.replaceRows) next.rows = patch.rows ?? []
  else if (patch.rows) {
    next.rows = [...next.rows]
    for (const row of patch.rows) {
      const index = next.rows.findIndex((existing) => existing.id === row.id)
      if (index === -1) next.rows.push(row)
      else next.rows[index] = row
    }
  }
  if (next.rows.length > maxRows) next.rows = next.rows.slice(-maxRows)
  return next
}

export function usageByAccount(chats: ChatFields[]): Record<string, Usage> {
  const totals: Record<string, Usage> = {}
  for (const chat of chats) {
    const total = (totals[chat.accountId] ??= emptyUsage())
    for (const key of Object.keys(total) as (keyof Usage)[]) total[key] += chat.usage[key]
  }
  return totals
}

const stuckLabels: Record<StuckReason, string> = {
  'needs-login': 'needs login',
  'rate-limited': 'rate limited',
  crashed: 'crashed',
  interrupted: 'interrupted',
  error: 'error',
}

export function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

export function doingNow(chat: ChatFields, now: number): string {
  switch (chat.state) {
    case 'starting':
      return chat.setup === 'worktree' ? 'Setting up worktree…' : 'Starting…'
    case 'needs-you':
      return `Waiting for you · ${chat.pending[0]?.toolName ?? 'a decision'}`
    case 'done':
      return 'Done · ready to review'
    case 'idle':
      return `Idle ${ago(now - chat.stateSince)}`
    case 'stuck': {
      if (chat.setup === 'worktree-failed') return 'Stuck · worktree failed'
      const stuck = chat.stuck ?? { reason: 'crashed' }
      const until = stuck.retryAt ? ` until ${new Date(stuck.retryAt).toTimeString().slice(0, 5)}` : ''
      return `Stuck · ${stuckLabels[stuck.reason]}${until}`
    }
    case 'working': {
      const running = chat.subagents.length
      if (running > 0) return `${running} subagent${running === 1 ? '' : 's'} exploring`
      return chat.activity
    }
  }
}
