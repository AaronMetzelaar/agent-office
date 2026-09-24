import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import type { CommandEntry, CommandKind } from '../../shared/commands'

export function frontmatter(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  if (!block) return fields
  const lines = block.split(/\r?\n/)
  for (let at = 0; at < lines.length; at++) {
    const field = /^([\w-]+):\s*(.*)$/.exec(lines[at]!)
    if (!field) continue
    const head = field[2]!.trim()
    const more: string[] = []
    while (at + 1 < lines.length && /^\s+\S/.test(lines[at + 1]!)) more.push(lines[++at]!.trim())
    const literal = /^\|[+-]?$/.test(head)
    const value = /^>[+-]?$/.test(head) || literal ? more.join(literal ? '\n' : ' ') : [head, ...more].join(' ')
    fields[field[1]!] = /^(['"]).*\1$/s.test(value) ? value.slice(1, -1) : value
  }
  return fields
}

const read = (file: string) => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

const list = (dir: string, recursive = false): string[] => {
  try {
    return readdirSync(dir, { recursive, encoding: 'utf8' })
  } catch {
    return []
  }
}

const firstLine = (text: string) =>
  text
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean) ?? ''

function skills(dir: string, kind: CommandKind, prefix = ''): CommandEntry[] {
  return list(dir).flatMap((folder) => {
    const text = read(join(dir, folder, 'SKILL.md'))
    if (text === undefined) return []
    const meta = frontmatter(text)
    return [{ name: prefix + (meta.name || folder), description: meta.description ?? '', argumentHint: meta['argument-hint'] ?? '', kind }]
  })
}

function commands(dir: string, kind: CommandKind, prefix = ''): CommandEntry[] {
  return list(dir, true)
    .filter((path) => path.endsWith('.md'))
    .flatMap((path) => {
      const text = read(join(dir, path))
      if (text === undefined) return []
      const meta = frontmatter(text)
      return [{ name: prefix + path.slice(0, -3).split(sep).join(':'), description: meta.description || firstLine(text), argumentHint: meta['argument-hint'] ?? '', kind }]
    })
}

function json(file: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(read(file) ?? '')
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function plugins(claudeDir: string): CommandEntry[] {
  const installed = json(join(claudeDir, 'plugins', 'installed_plugins.json'))?.plugins
  if (!installed || typeof installed !== 'object') return []
  const enabled = json(join(claudeDir, 'settings.json'))?.enabledPlugins as Record<string, unknown> | undefined
  return Object.entries(installed as Record<string, { installPath?: unknown }[]>).flatMap(([key, installs]) => {
    const path = Array.isArray(installs) ? installs[0]?.installPath : undefined
    if (typeof path !== 'string' || (enabled && enabled[key] !== true)) return []
    const prefix = `${key.split('@')[0]}:`
    return [...skills(join(path, 'skills'), 'plugin', prefix), ...commands(join(path, 'commands'), 'plugin', prefix)]
  })
}

export function scanCommands(claudeDir: string, folders: string[]): CommandEntry[] {
  const found = [
    ...[...new Set(folders)].flatMap((folder) => [...skills(join(folder, '.claude', 'skills'), 'skill'), ...commands(join(folder, '.claude', 'commands'), 'command')]),
    ...skills(join(claudeDir, 'skills'), 'skill'),
    ...commands(join(claudeDir, 'commands'), 'command'),
    ...plugins(claudeDir),
  ]
  const seen = new Set<string>()
  return found.filter((entry) => !seen.has(entry.name) && seen.add(entry.name))
}
