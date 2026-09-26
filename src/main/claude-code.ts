import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeCode } from '../shared/ipc'

export type Probe = (command: string, args: string[], path: string) => Promise<boolean>

const probe: Probe = (command, args, path) => new Promise((done) => execFile(command, args, { timeout: 5000, env: { ...process.env, PATH: path } }, (error) => done(!error)))

export async function claudeCode(path: () => Promise<string>, run: Probe = probe, home = homedir()): Promise<ClaudeCode> {
  const PATH = await path()
  const [onPath, inKeychain] = await Promise.all([run('/usr/bin/which', ['claude'], PATH), run('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials'], PATH)])
  return {
    installed: onPath || existsSync(join(home, '.claude', 'local', 'claude')),
    signedIn: inKeychain || existsSync(join(home, '.claude', '.credentials.json')),
  }
}
