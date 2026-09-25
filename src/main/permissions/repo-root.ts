import { execFileSync } from 'node:child_process'
import { basename, dirname } from 'node:path'

export function repoRoot(cwd: string, timeout = 30_000): string | undefined {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return basename(common) === '.git' ? dirname(common) : common
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? undefined : cwd
  }
}
