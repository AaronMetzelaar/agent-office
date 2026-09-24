export interface Thresholds {
  parkAfterMs: number
  cleanupAfterMs: number
}

const hour = 3_600_000
export const day = 24 * hour
export const defaultThresholds: Thresholds = { parkAfterMs: day, cleanupAfterMs: 3 * day }
export const parkChoices: [number, string][] = [
  [6 * hour, '6 hours'],
  [12 * hour, '12 hours'],
  [day, '1 day'],
  [2 * day, '2 days'],
  [3 * day, '3 days'],
]
export const cleanupChoices: [number, string][] = [
  [day, '1 day'],
  [2 * day, '2 days'],
  [3 * day, '3 days'],
  [5 * day, '5 days'],
  [7 * day, '7 days'],
]

export interface Proc {
  pid: number
  command: string
  bytes: number
}

export interface AgentMemory {
  chatId: string
  bytes: number
  processes: Proc[]
}

export interface OutsideMemory {
  cwd: string
  bytes: number
  pids: number[]
}

export interface GitSafety {
  label: string
  safe: boolean
  blocked?: string
}

export interface WorktreeView {
  path: string
  repo: string
  branch?: string
  locked: boolean
  bytes?: number
  chatIds: string[]
  git?: GitSafety
}

export interface HousekeepingView {
  at: number
  totalMemory: number
  bytes: number
  hot: boolean
  agents: AgentMemory[]
  outside: OutsideMemory[]
  worktrees: WorktreeView[]
  thresholds: Thresholds
  candidates: string[]
  safe: string[]
  stubborn: Record<string, Proc[]>
}

export interface StopReport {
  freedBytes: number
  stopped: number
  stubborn: Proc[]
}

export interface CleanupSummary {
  chats: number
  freedBytes: number
  diskBytes: number
  removed: number
  skipped: { chatId: string; reason: string }[]
  stubborn: Proc[]
}

export const hotShare = 0.4

const mb = 2 ** 20
export const gb = (bytes: number) => `${(bytes / 2 ** 30).toFixed(1)} GB`
export const size = (bytes: number) => (bytes >= 1000 * mb ? gb(bytes) : `${Math.round(bytes / mb)} MB`)
export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

export function summaryText(summary: CleanupSummary): string {
  const disk = summary.diskBytes ? ` (${size(summary.diskBytes)} on disk)` : ''
  const stuck = summary.stubborn.length ? ` · ${plural(summary.stubborn.length, 'process', 'processes')} didn’t stop` : ''
  return `Freed ${gb(summary.freedBytes)} · removed ${plural(summary.removed, 'worktree')}${disk}${stuck}`
}

export function stopText(report: StopReport): string {
  const stuck = report.stubborn.length ? ` · ${plural(report.stubborn.length, 'process', 'processes')} didn’t stop` : ''
  return `Stopped ${plural(report.stopped, 'process', 'processes')} · freed ${size(report.freedBytes)}${stuck}`
}
