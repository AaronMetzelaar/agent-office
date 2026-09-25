import type { Limits } from './guardrails'
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

export const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type ImageType = (typeof imageTypes)[number]
export const maxImageBytes = 5 * 1024 * 1024
export type Attachment = { kind: 'image'; name: string; mediaType: ImageType; data: string } | { kind: 'file'; name: string; path: string }

export type ChatRow =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; id: string; text: string; parentToolUseId?: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; parentToolUseId?: string; result?: { text: string; isError: boolean } }
  | { kind: 'other'; id: string; label: string }

export interface BackgroundJob {
  id: string
  description: string
}

export interface ContextUsage {
  tokens: number
  max: number
  percent: number
}

export interface RewindPreview {
  canRewind: boolean
  error?: string
  files?: number
  insertions?: number
  deletions?: number
}

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
  finished?: number
  state: ChatState
  stuck?: Stuck
  halt?: string
  paused?: boolean
  limits?: Limits
  stateSince: number
  unread: boolean
  activity: string
  pending: { id: string; toolName: string }[]
  pendingRequests: PendingRequestView[]
  oldestPendingAt?: number
  answered?: Answered[]
  earlier?: boolean
  subagents: { id: string; description: string; activity?: string }[]
  backgroundJobs?: BackgroundJob[]
  usage: Usage
  partial: string
  suggestion?: string
  context?: ContextUsage
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

export const isBusy = (state: ChatState) => state === 'starting' || state === 'working' || state === 'needs-you'

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
      return `Waiting for you · ${chat.halt ?? chat.pending[0]?.toolName ?? 'a decision'}`
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

export const simulatorTool = 'mcp__Claude_Code_iOS_Simulator__control'
export type SimulatorShot = { image: string } | { error: string }
const udid = /\b[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}\b/i
const deviceId = /^(booted|[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12})$/i

export const isSimulatorDevice = (value: unknown): value is string => typeof value === 'string' && deviceId.test(value)

function simulatorIn(row: ChatRow): string | undefined {
  if (row.kind !== 'tool') return undefined
  const input = (row.input ?? {}) as { device?: unknown; command?: unknown }
  if (row.name === simulatorTool) return isSimulatorDevice(input.device) ? input.device : 'booted'
  if (row.name === 'Bash' && typeof input.command === 'string' && /\bsimctl (boot|install|launch|terminate|openurl|io|spawn|ui|status_bar|push|privacy|addmedia|location)\b|\b(detox|maestro) test\b/.test(input.command)) return udid.exec(input.command)?.[0] ?? 'booted'
  return undefined
}

export function simulatorOf(rows: readonly ChatRow[], thisTurn = false): string | undefined {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]!
    if (thisTurn && row.kind === 'user') return undefined
    const device = simulatorIn(row)
    if (device) return device
  }
  return undefined
}

export const usingSimulator = (chat: Pick<ChatView, 'state' | 'rows'>) => isBusy(chat.state) && simulatorOf(chat.rows, true) !== undefined
