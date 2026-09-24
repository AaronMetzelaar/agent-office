import { plural, type GitSafety, type Proc } from '../../shared/housekeeping'
import { gitStatus, unpushedCommits, type Run } from '../review/git'
import { pullRequest } from '../review/github'
import { gitError } from '../worktrees/create'

export interface Signals {
  kill(pid: number, signal: NodeJS.Signals): void
  alive(pid: number): boolean
  sleep(ms: number): Promise<void>
  graceMs: number
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function stopProcesses(targets: readonly Proc[], signals: Signals): Promise<{ stopped: Proc[]; stubborn: Proc[] }> {
  const ours = targets.filter((proc) => proc.pid > 1 && proc.pid !== process.pid && proc.pid !== process.ppid)
  for (const proc of ours) {
    try {
      signals.kill(proc.pid, 'SIGTERM')
    } catch {}
  }
  const deadline = Date.now() + signals.graceMs
  let running = ours.filter((proc) => signals.alive(proc.pid))
  while (running.length && Date.now() < deadline) {
    await signals.sleep(Math.min(200, signals.graceMs))
    running = running.filter((proc) => signals.alive(proc.pid))
  }
  return { stopped: ours.filter((proc) => !running.includes(proc)), stubborn: running }
}

export async function gitSafety(path: string, gh: Run): Promise<GitSafety> {
  let uncommitted: number
  let unpushed: number
  try {
    ;[{ uncommitted }, unpushed] = await Promise.all([gitStatus(path), unpushedCommits(path)])
  } catch {
    return { label: 'Git state unknown', safe: false, blocked: 'its git state couldn’t be read' }
  }
  if (!Number.isFinite(unpushed)) return { label: 'Git state unknown', safe: false, blocked: 'its git state couldn’t be read' }
  if (uncommitted) return { label: `${uncommitted} uncommitted`, safe: false, blocked: plural(uncommitted, 'uncommitted change') }
  if (!unpushed) return { label: 'Clean', safe: true }
  const { pr, notice } = await pullRequest(path, gh)
  if (pr?.state === 'merged') return { label: 'PR merged', safe: true }
  const why = plural(unpushed, 'unpushed commit')
  return { label: `${unpushed} unpushed`, safe: false, blocked: notice ? `${why}, and the PR state is unknown` : why }
}

export async function removeWorktree(run: Run, repo: string, path: string): Promise<string | undefined> {
  try {
    await run('git', ['worktree', 'remove', path], repo)
    return undefined
  } catch (error) {
    return gitError(error)
  }
}
