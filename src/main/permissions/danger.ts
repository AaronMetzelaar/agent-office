import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

const start = String.raw`(?:^|[\s/'"=~])`
const end = String.raw`(?=$|[\s/'";|&)])`
const sensitive = (pattern: string) => new RegExp(`${start}${pattern}${end}`)

const shellPatterns: [RegExp, string][] = [
  [/\b(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/, 'Pipes a download straight into a shell'],
  [/\bsudo\b/, 'Runs a command as root (sudo)'],
  [/\bgit\b[^;&|]*\bpush\b[^;&|]*\s(?:--force|-f)\b/, 'Force-pushes and can overwrite remote history (git push --force)'],
  [/\bgit\b[^;&|]*\breset\b[^;&|]*\s--hard\b/, 'Throws away uncommitted work (git reset --hard)'],
]

const sensitivePaths: [RegExp, string][] = [
  [sensitive(String.raw`\.env(?:\.[\w.-]+)?`), 'a .env file'],
  [sensitive(String.raw`\.ssh`), '~/.ssh'],
  [sensitive(String.raw`\.aws`), '~/.aws'],
  [sensitive(String.raw`\.gnupg`), '~/.gnupg'],
  [sensitive(String.raw`(?:Keychains|[\w.-]+\.keychain(?:-db)?)`), 'the keychain'],
  [sensitive(String.raw`\.(?:netrc|npmrc|git-credentials)`), 'a credentials file'],
  [sensitive(String.raw`\.config/gh`), 'the GitHub CLI login'],
  [sensitive(String.raw`\.claude/settings(?:\.local)?\.json`), 'Claude Code settings'],
  [sensitive(String.raw`\.(?:zshrc|zprofile|bashrc|bash_profile|profile)`), 'a shell startup file'],
]

function recursiveForceDelete(command: string): boolean {
  for (const [, flags = ''] of command.matchAll(/(?:^|[\s;&|(])rm\s+((?:-\S+\s*)+)/g)) {
    if (/(?:^|\s)(?:-\w*[rR]|--recursive)/.test(flags) && /(?:^|\s)(?:-\w*f|--force)/.test(flags)) return true
  }
  return false
}

function sensitiveTarget(text: string): string | undefined {
  return sensitivePaths.find(([pattern]) => pattern.test(text))?.[1]
}

function absolute(path: string, cwd: string): string {
  if (path === '~' || path.startsWith('~/')) return join(homedir(), path.slice(1))
  return resolve(cwd, path)
}

function outside(path: string, cwd: string): boolean {
  const rel = relative(cwd, absolute(path, cwd))
  return rel.startsWith('..') || isAbsolute(rel)
}

export function dangerReason(toolName: string, input: Record<string, unknown>, cwd: string, flags: { defaultToNo?: boolean; blockedPath?: string } = {}): string | undefined {
  if (toolName === 'Bash' && typeof input.command === 'string') {
    const command = input.command
    if (recursiveForceDelete(command)) return 'Deletes files recursively without asking (rm -rf)'
    const shell = shellPatterns.find(([pattern]) => pattern.test(command))
    if (shell) return shell[1]
    const target = sensitiveTarget(command)
    if (target) return `Touches ${target}`
  }
  const path = [input.file_path, input.notebook_path, input.path].find((value) => typeof value === 'string')
  if (typeof path === 'string') {
    const target = sensitiveTarget(absolute(path, cwd))
    if (target) return `Touches ${target}`
    if (outside(path, cwd)) return `Outside this chat’s folder: ${path}`
  }
  if (flags.blockedPath && outside(flags.blockedPath, cwd)) return `Outside this chat’s folder: ${flags.blockedPath}`
  if (flags.defaultToNo) return 'Claude Code marked this as needing a deliberate click'
  return undefined
}
