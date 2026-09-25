export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx'
  text: string
  oldNo?: number
  newNo?: number
}

export interface Hunk {
  header: string
  lines: DiffLine[]
}

export interface DiffFile {
  path: string
  oldPath?: string
  status: FileStatus
  added: number
  removed: number
  binary: boolean
  hunks: Hunk[]
  truncated?: boolean
}

export type CheckState = 'pass' | 'fail' | 'pending' | 'skipped'

export interface CiCheck {
  name: string
  state: CheckState
  url?: string
  job?: string
}

export type ReviewDecision = 'approved' | 'changes-requested' | 'review-required'

export interface PullRequest {
  number: number
  title: string
  url: string
  state: 'open' | 'merged' | 'closed'
  draft: boolean
  review?: ReviewDecision
  unresolved?: number
  checks: CiCheck[]
}

export interface GitStatus {
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  uncommitted: number
}

export interface Review extends GitStatus {
  notRepo?: boolean
  base?: string
  unpushed?: number
  files: DiffFile[]
  pr?: PullRequest
  notice?: string
}

export type CiLog = { log: string } | { error: string }

export type FilePreview = { path: string } & ({ image: string } | { text: string } | { error: string })

export const editors = { code: 'VS Code', cursor: 'Cursor', windsurf: 'Windsurf', zed: 'Zed', subl: 'Sublime Text' } as const
export type Editor = keyof typeof editors
export const isEditor = (value: unknown): value is Editor => typeof value === 'string' && Object.hasOwn(editors, value)

export function ciState(checks: readonly CiCheck[]): 'none' | 'fail' | 'pending' | 'pass' {
  if (!checks.length) return 'none'
  if (checks.some((check) => check.state === 'fail')) return 'fail'
  if (checks.some((check) => check.state === 'pending')) return 'pending'
  return 'pass'
}
