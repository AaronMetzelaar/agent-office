import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=office@test', '-c', 'user.name=office', ...args], { cwd, stdio: 'ignore' })

export function gitRepo(path: string, files: Record<string, string> = {}) {
  mkdirSync(path, { recursive: true })
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(path, file)), { recursive: true })
    writeFileSync(join(path, file), text)
  }
  git(path, 'init', '-q', '-b', 'main')
  git(path, 'add', '-A')
  git(path, 'commit', '-q', '--allow-empty', '-m', 'init')
  return path
}

export function worktree(repo: string, path: string) {
  git(repo, 'worktree', 'add', '-q', '-b', basename(path), path)
  return path
}

export const claudeWorktree = (repo: string, name: string) => worktree(repo, join(repo, '.claude', 'worktrees', name))

export function mwsMonorepo(path: string, { readme = '# MWS Monorepo\n', origin }: { readme?: string; origin?: string } = {}) {
  const apps = ['marketplace', 'admin', 'mobile'].map((app) => [`frontend/${app}/package.json`, JSON.stringify({ name: app })])
  gitRepo(path, { 'README.md': readme, ...Object.fromEntries(apps) })
  if (origin) git(path, 'remote', 'add', 'origin', origin)
  return path
}
