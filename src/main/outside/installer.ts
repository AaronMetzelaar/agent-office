import { randomBytes, randomUUID } from 'node:crypto'
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import script from '../../../resources/hook/agent-office-hook?raw'
import { hookNames, secretHeader } from './listener'

export interface HookPaths {
  settings: string
  dir: string
}

type Json = Record<string, unknown>

export const marker = 'agent-office-hook'
export const endpointName = 'hook.curlrc'
export const hookTimeoutSeconds = 5

const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value)
const ours = (hook: unknown) => isObject(hook) && typeof hook.command === 'string' && hook.command.includes(marker)

export function writeAtomic(path: string, text: string, mode = 0o600): void {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temp, text, { mode, flag: 'wx' })
    renameSync(temp, path)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

function load(path: string): { target: string; text?: string; settings: Json; mode: number } {
  const target = existsSync(path) ? realpathSync(path) : path
  const text = existsSync(target) ? readFileSync(target, 'utf8') : undefined
  let settings: unknown = {}
  try {
    if (text?.trim()) settings = JSON.parse(text)
  } catch {
    throw new Error(`${path} isn’t valid JSON, so Agent Office left it alone.`)
  }
  if (!isObject(settings)) throw new Error(`${path} isn’t a JSON object, so Agent Office left it alone.`)
  if (settings.hooks !== undefined && !isObject(settings.hooks)) throw new Error(`The hooks in ${path} aren’t an object, so Agent Office left them alone.`)
  return { target, text, settings, mode: text === undefined ? 0o600 : statSync(target).mode & 0o777 }
}

function format(settings: Json, original?: string): string {
  const indent = /^([ \t]+)"/m.exec(original ?? '')?.[1] ?? '  '
  return JSON.stringify(settings, null, indent) + (original === undefined || original.endsWith('\n') ? '\n' : '')
}

function patch(path: string, change: (settings: Json) => Json): void {
  const { target, text, settings, mode } = load(path)
  const next = change(settings)
  if (next === settings) return
  mkdirSync(dirname(target), { recursive: true })
  writeAtomic(target, format(next, text), mode)
}

export function withoutHook(settings: Json): Json {
  if (!isObject(settings.hooks)) return settings
  let changed = false
  const hooks: Json = {}
  for (const [name, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[name] = groups
      continue
    }
    const kept = groups.flatMap((group) => {
      if (!isObject(group) || !Array.isArray(group.hooks) || !group.hooks.some(ours)) return [group]
      changed = true
      const rest = group.hooks.filter((hook) => !ours(hook))
      return rest.length ? [{ ...group, hooks: rest }] : []
    })
    if (kept.length || !groups.length) hooks[name] = kept
  }
  if (!changed) return settings
  if (Object.keys(hooks).length) return { ...settings, hooks }
  const { hooks: _hooks, ...rest } = settings
  return rest
}

export function withHook(settings: Json, command: string): Json {
  const base = withoutHook(settings)
  const hooks: Json = { ...(isObject(base.hooks) ? base.hooks : {}) }
  for (const name of hookNames) {
    const groups = hooks[name]
    hooks[name] = [...(Array.isArray(groups) ? groups : []), { hooks: [{ type: 'command', command, timeout: hookTimeoutSeconds }] }]
  }
  return { ...base, hooks }
}

export const scriptPath = (dir: string) => join(dir, marker)
export const hookCommand = (dir: string) => `'${scriptPath(dir).replaceAll("'", `'\\''`)}'`

export function isInstalled(settings: string): boolean {
  try {
    const current = load(settings).settings
    return withoutHook(current) !== current
  } catch {
    return false
  }
}

export function backupSettings(settings: string): string | undefined {
  if (!existsSync(settings)) return undefined
  const backup = `${settings}.agent-office-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`
  copyFileSync(realpathSync(settings), backup, constants.COPYFILE_EXCL)
  return backup
}

export const addHook = ({ settings, dir }: HookPaths) => patch(settings, (current) => withHook(current, hookCommand(dir)))

export function install(paths: HookPaths): { backup?: string } {
  load(paths.settings)
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 })
  writeAtomic(scriptPath(paths.dir), script, 0o700)
  const backup = backupSettings(paths.settings)
  addHook(paths)
  return backup ? { backup } : {}
}

export const uninstall = ({ settings }: HookPaths) => patch(settings, withoutHook)

export function endpointSecret(dir: string): string {
  let saved: string | undefined
  try {
    saved = new RegExp(`${secretHeader}: ([0-9a-f]{64})`).exec(readFileSync(join(dir, endpointName), 'utf8'))?.[1]
  } catch {
    saved = undefined
  }
  return saved ?? randomBytes(32).toString('hex')
}

export function writeEndpoint(dir: string, port: number, secret: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeAtomic(join(dir, endpointName), `url = "http://127.0.0.1:${port}/hook"\nheader = "Content-Type: application/json"\nheader = "${secretHeader}: ${secret}"\n`)
}
