import { execFileSync } from 'node:child_process'
import { basename, dirname } from 'node:path'

export function repoRoot(cwd: string): string {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return basename(common) === '.git' ? dirname(common) : common
  } catch {
    return cwd
  }
}
