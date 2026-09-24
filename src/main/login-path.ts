import { execFile } from 'node:child_process'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'

export type ShellRun = (shell: string, args: string[], timeoutMs: number) => Promise<string>

export interface PathOptions {
  shell?: string
  run?: ShellRun
  timeoutMs?: number
  current?: string
  home?: string
}

const marker = '__AGENT_OFFICE_PATH__'

const runShell: ShellRun = (shell, args, timeout) =>
  new Promise((done, fail) => execFile(shell, args, { timeout, encoding: 'utf8' }, (error, stdout) => (error ? fail(error) : done(stdout))))

export function fallbackPath(current: string, home: string): string {
  return [...new Set([...current.split(':'), '/opt/homebrew/bin', '/usr/local/bin', join(home, '.local', 'bin')].filter(Boolean))].join(':')
}

export async function loginShellPath({ shell = process.env.SHELL || userInfo().shell || '/bin/zsh', run = runShell, timeoutMs = 3000, current = process.env.PATH ?? '', home = homedir() }: PathOptions = {}): Promise<string> {
  try {
    const path = (await run(shell, ['-ilc', `printf '${marker}%s${marker}' "$PATH"`], timeoutMs)).split(marker)[1]?.trim()
    if (path) return path
  } catch {}
  return fallbackPath(current, home)
}
