import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { looks, type ConfigCommands, type ConfigRoom, type DeptConfig, type Look } from '../../shared/departments'

export interface LoadedConfig {
  config: DeptConfig
  skipped: string[]
  unreadable?: string
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value)
const isLook = (value: unknown): value is Look => looks.includes(value as Look)
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(text)
const expand = (path: string) => (path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path)
const empty = (): DeptConfig => ({ rooms: [], playground: [], commands: {} })

function fail(message: string): never {
  throw new Error(message)
}

export function roomId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `c-${slug || createHash('sha256').update(name).digest('hex').slice(0, 8)}`
}

function roomOf(entry: unknown, index: number, kept: readonly ConfigRoom[]): ConfigRoom | string {
  if (!isObject(entry) || !text(entry.name)) return `Skipped room ${index + 1}: it has no name`
  const { folders, account, accent, look } = entry
  const name = entry.name
  const id = roomId(name)
  const skip = (reason: string) => `Skipped room "${name}": ${reason}`
  if ((folders === undefined) === (account === undefined)) return skip('it needs either folders or an account, not both')
  if (folders !== undefined && (!texts(folders) || !folders.length)) return skip('folders isn’t a list of folders')
  if (account !== undefined && !text(account)) return skip('account isn’t part of an account label')
  if (accent !== undefined && !(typeof accent === 'string' && /^#[0-9a-f]{6}$/i.test(accent))) return skip('accent isn’t a colour like #3b7bff')
  if (look !== undefined && !isLook(look)) return skip(`look isn’t one of ${looks.join(', ')}`)
  if (kept.some((room) => room.id === id)) return skip('another room already uses this name')
  return { id, name, ...(folders ? { folders: folders.map(expand) } : { account }), ...(accent ? { accent: accent.toLowerCase() } : {}), ...(look ? { look } : {}) }
}

function commandsOf(value: unknown): ConfigCommands {
  if (value === undefined) return {}
  if (!isObject(value)) fail('commands isn’t an object')
  const { ship } = value
  if (ship !== undefined && !texts(ship)) fail('commands.ship isn’t a list of commands')
  const command = (key: keyof ConfigCommands) => {
    const found = value[key]
    return found === undefined || text(found) ? found : fail(`commands.${key} isn’t a command`)
  }
  return { ship, fixCi: command('fixCi'), answerComments: command('answerComments'), review: command('review') }
}

function parse(raw: unknown): LoadedConfig {
  if (Array.isArray(raw)) fail('it uses the old list format; see the README for the new format')
  if (!isObject(raw)) fail('it isn’t a JSON object')
  const { rooms = [], playground = [] } = raw
  if (!Array.isArray(rooms)) fail('rooms isn’t a list')
  if (!texts(playground)) fail('playground isn’t a list of folders')
  const config: DeptConfig = { rooms: [], playground: playground.map(expand), commands: commandsOf(raw.commands) }
  const skipped: string[] = []
  rooms.forEach((entry, index) => {
    const room = roomOf(entry, index, config.rooms)
    if (typeof room === 'string') skipped.push(room)
    else config.rooms.push(room)
  })
  return { config, skipped }
}

export function loadConfig(dir: string): LoadedConfig {
  const path = join(dir, 'departments.json')
  if (!existsSync(path)) return { config: empty(), skipped: [] }
  try {
    return parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    return { config: empty(), skipped: [], unreadable: error instanceof Error ? error.message : String(error) }
  }
}
