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
  branch: string
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

export const branchPrompt = 'Name a git branch for this request to a coding agent, as type/short-summary. Type is feature, fix, hotfix or docs. The summary is 2 to 5 lowercase words joined by hyphens, like fix/mobile-menu-scroll. Keep any ticket id such as auc-1302 at the start of the summary. Reply with the branch only.'

const suggestion = /^(feature|fix|hotfix|docs)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/
const fixWords = /\b(fix|bug|broken|crash(es)?|errors?|fail(s|ing)?|wrong|can'?t|cannot|doesn'?t|won'?t|isn'?t)\b/i
const docsWords = /\b(docs?|readme|documentation)\b/i

export function branchFor(prompt: string, suggested?: string): string {
  const id = ticket.exec(prompt)?.[1]?.toLowerCase()
  const match = suggestion.exec(suggested?.trim().split('\n')[0]!.toLowerCase() ?? '')
  const type = match?.[1] ?? (fixWords.test(prompt) ? 'fix' : docsWords.test(prompt) ? 'docs' : 'feature')
  const summary = match?.[2] ?? slugFor(prompt)
  const named = id && !summary.includes(id) ? `${id}-${summary}` : summary
  return `${type}/${named.slice(0, 48).replace(/-+$/, '')}`
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
  const dir = base.split('/').at(-1)!
  let prefix: string
  try {
    prefix = git(folder, ['rev-parse', '--show-prefix']).trim().replace(/\/$/, '')
  } catch {
    throw new Error('This folder isn’t in a git repository, so it can’t get a fresh worktree.')
  }
  const repo = repoRoot(folder)
  if (!repo) throw new Error('Git took too long to answer, so the worktree wasn’t created. Try again in a moment.')
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : `-${n}`
    const path = join(repo, '.claude', 'worktrees', dir + suffix)
    if (!existsSync(path) && !branchExists(repo, base + suffix)) return { repo, branch: base + suffix, path, cwd: join(path, prefix) }
  }
}

export function gitError(error: unknown): string {
  const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim()
  const line = stderr.split('\n').find((text) => /^(fatal|error):/.test(text)) ?? stderr.split('\n').at(-1)
  return line?.replace(/^(fatal|error):\s*/, '') || (error instanceof Error ? error.message : String(error))
}

export async function createWorktree({ repo, branch, path }: WorktreePlan): Promise<void> {
  try {
    await run('git', ['worktree', 'add', '-b', branch, path], { cwd: repo, timeout: 120_000 })
  } catch (error) {
    await run('git', ['worktree', 'remove', '--force', path], { cwd: repo }).catch(() => {})
    await rm(path, { recursive: true, force: true })
    await run('git', ['worktree', 'prune'], { cwd: repo }).catch(() => {})
    await run('git', ['branch', '-D', branch], { cwd: repo }).catch(() => {})
    throw new Error(gitError(error))
  }
}
