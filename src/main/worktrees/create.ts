import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { repoRoot } from '../permissions/repo-root'

const run = promisify(execFile)
const ticket = /\b([A-Z]{2,6}-\d{1,6})\b/

export interface WorktreePlan {
  repo: string
  slug: string
  path: string
  cwd: string
}

export function slugFor(prompt: string): string {
  const id = ticket.exec(prompt)?.[1]?.toLowerCase()
  const words = prompt
    .replace(ticket, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, id ? 4 : 5)
  return [id, ...words].filter(Boolean).join('-').slice(0, 48).replace(/-+$/, '') || 'agent'
}

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] })

function branchExists(repo: string, branch: string): boolean {
  try {
    git(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}

export function planWorktree(folder: string, base: string): WorktreePlan {
  let prefix: string
  try {
    prefix = git(folder, ['rev-parse', '--show-prefix']).trim().replace(/\/$/, '')
  } catch {
    throw new Error('This folder isn’t in a git repository, so it can’t get a fresh worktree.')
  }
  const repo = repoRoot(folder)
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`
    const path = join(repo, '.claude', 'worktrees', slug)
    if (!existsSync(path) && !branchExists(repo, slug)) return { repo, slug, path, cwd: join(path, prefix) }
  }
}

export function gitError(error: unknown): string {
  const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim()
  const line = stderr.split('\n').find((text) => /^(fatal|error):/.test(text)) ?? stderr.split('\n').at(-1)
  return line?.replace(/^(fatal|error):\s*/, '') || (error instanceof Error ? error.message : String(error))
}

export async function createWorktree({ repo, slug, path }: WorktreePlan): Promise<void> {
  try {
    await run('git', ['worktree', 'add', '-b', slug, path], { cwd: repo, timeout: 120_000 })
  } catch (error) {
    await run('git', ['worktree', 'remove', '--force', path], { cwd: repo }).catch(() => {})
    await rm(path, { recursive: true, force: true })
    await run('git', ['worktree', 'prune'], { cwd: repo }).catch(() => {})
    await run('git', ['branch', '-D', slug], { cwd: repo }).catch(() => {})
    throw new Error(gitError(error))
  }
}
