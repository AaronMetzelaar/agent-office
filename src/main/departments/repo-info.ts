import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { remoteSlug } from '../workflow/review-requests'

const mws = /(?<![a-z\d])mws(?![a-z\d])|matchwornshirt/i

export const memo = <T>(fn: (key: string) => T) => {
  const cache = new Map<string, T>()
  return (key: string): T => (cache.has(key) ? (cache.get(key) as T) : cache.set(key, fn(key)).get(key)!)
}

const git = (cwd: string, ...args: string[]) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

const read = (path: string) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

const packageName = (dir: string) => {
  try {
    return String(JSON.parse(read(join(dir, 'package.json'))).name ?? '')
  } catch {
    return ''
  }
}

const heading = (root: string) => /^#+\s*(.*)$/m.exec(read(join(root, 'README.md')))?.[1] ?? ''

const names = (root: string) => [basename(root), heading(root), packageName(root), ...readdirSync(join(root, 'frontend')).map((app) => packageName(join(root, 'frontend', app)))]

export const repoInfo = memo((cwd): { root: string; top: string } | undefined => {
  const [common, top] = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel').split('\n')
  if (!common || !top) return undefined
  const root = basename(common) === '.git' ? dirname(common) : common
  return root === homedir() ? undefined : { root, top }
})

export const isMwsMonorepo = memo(
  (root) =>
    existsSync(join(root, 'frontend', 'marketplace')) &&
    (names(root).some((name) => mws.test(name)) || !!remoteSlug(git(root, 'remote', 'get-url', 'origin'))?.startsWith('matchwornshirt/')),
)
