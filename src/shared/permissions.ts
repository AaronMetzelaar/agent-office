export const windowSources = ['chat', 'inbox', 'queue', 'keyboard'] as const
export type WindowSource = (typeof windowSources)[number]
export type RequestSource = WindowSource | 'notification' | 'phone'

export type Decision =
  | { kind: 'allow' }
  | { kind: 'always' }
  | { kind: 'deny'; message?: string }
  | { kind: 'answer'; answers: Record<string, string> }

export type ResolveResult = { ok: true } | { error: string }

export interface PendingRequestView {
  id: string
  tool: string
  summary: string
  input: Record<string, unknown>
  createdAt: number
  dangerous: boolean
  dangerReason?: string
  alwaysAllow: boolean
}

export interface RuleView {
  id: number
  accountId: string
  repoRoot: string
  rule: string
  createdAt: number
}
