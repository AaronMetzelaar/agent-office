import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { remoteSlug } from '../workflow/review-requests'

const mws = /(?<![a-z\d])mws(?![a-z\d])|matchwornshirt/i

export const memo = <T>(fn: (key: string) => T) => {
  const cache = new Map<string, T>()
  return (key: string): T => (cache.has(key) ? (cache.get(key) as T) : cache.set(key, fn(key)).get(key)!)
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

const real = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

function gitDirOf(dir: string): string | undefined {
  const dotGit = join(dir, '.git')
  try {
    if (statSync(dotGit).isDirectory()) return dotGit
  } catch {
    return undefined
  }
  const pointer = /^gitdir:\s*(.+)$/m.exec(read(dotGit))?.[1]?.trim()
  return pointer ? resolve(dir, pointer) : undefined
}

const commonDirOf = (gitDir: string) => {
  const relative = read(join(gitDir, 'commondir')).trim()
  return real(relative ? resolve(gitDir, relative) : gitDir)
}

const originOf = (root: string) => /\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/.exec(read(join(root, '.git', 'config')) || read(join(root, 'config')))?.[1] ?? ''

const heading = (root: string) => /^#+\s*(.*)$/m.exec(read(join(root, 'README.md')))?.[1] ?? ''

const names = (root: string) => [basename(root), heading(root), packageName(root), ...readdirSync(join(root, 'frontend')).map((app) => packageName(join(root, 'frontend', app)))]

export const repoInfo = memo((cwd): { root: string; top: string } | undefined => {
  for (let top = real(cwd); top; top = dirname(top) === top ? undefined : dirname(top)) {
    const gitDir = gitDirOf(top)
    if (!gitDir) continue
    const common = commonDirOf(gitDir)
    if (!common) return undefined
    const root = basename(common) === '.git' ? dirname(common) : common
    return root === homedir() ? undefined : { root, top }
  }
  return undefined
})

export const isMwsMonorepo = memo(
  (root) =>
    existsSync(join(root, 'frontend', 'marketplace')) &&
    (names(root).some((name) => mws.test(name)) || !!remoteSlug(originOf(root))?.startsWith('matchwornshirt/')),
)
