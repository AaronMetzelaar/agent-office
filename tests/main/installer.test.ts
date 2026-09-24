import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addHook, backupSettings, endpointName, endpointSecret, hookCommand, install, isInstalled, marker, scriptPath, uninstall, writeEndpoint, type HookPaths } from '../../src/main/outside/installer'
import { hookNames } from '../../src/main/outside/listener'

const crash = vi.hoisted(() => ({ writes: false }))

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  const writeFileSync: typeof fs.writeFileSync = (file, data, options) => {
    if (!crash.writes) return fs.writeFileSync(file, data, options)
    fs.writeFileSync(file, String(data).slice(0, 20), options)
    throw new Error('killed mid-write')
  }
  return { ...fs, writeFileSync }
})

const existing = {
  env: { FOO: '1' },
  hooks: {
    PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'prettier --write' }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: 'echo hello' }] }],
  },
  theme: 'light',
}
const pretty = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
const read = (path: string) => readFileSync(path, 'utf8')
const marked = (settings: { hooks: Record<string, { hooks: { command: string }[] }[]> }, name: string) => settings.hooks[name]!.flatMap((group) => group.hooks).filter((hook) => hook.command.includes(marker))

let root: string
let paths: HookPaths
let original: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-office-installer-'))
  paths = { settings: join(root, 'claude', 'settings.json'), dir: join(root, 'config') }
  mkdirSync(dirname(paths.settings))
  original = pretty(existing)
  writeFileSync(paths.settings, original, { mode: 0o600 })
})

afterEach(() => {
  crash.writes = false
  rmSync(root, { recursive: true, force: true })
})

describe('hook installer', () => {
  it('backs up, then adds one marked hook entry per event that runs the user-only hook script', () => {
    const { backup } = install(paths)
    const settings = JSON.parse(read(paths.settings))

    for (const name of hookNames) expect(marked(settings, name)).toEqual([{ type: 'command', command: hookCommand(paths.dir), timeout: 5 }])
    expect(settings.hooks.PostToolUse[0]).toEqual(existing.hooks.PostToolUse[0])
    expect(settings.hooks.SessionStart[0]).toEqual(existing.hooks.SessionStart[0])
    expect(settings).toMatchObject({ env: existing.env, theme: 'light' })
    expect(read(backup!)).toBe(original)
    expect(statSync(paths.settings).mode & 0o777).toBe(0o600)
    expect(statSync(scriptPath(paths.dir)).mode & 0o777).toBe(0o700)
    expect(read(scriptPath(paths.dir))).toContain('hook.curlrc')
    expect(isInstalled(paths.settings)).toBe(true)

    install(paths)
    for (const name of hookNames) expect(marked(JSON.parse(read(paths.settings)), name)).toHaveLength(1)
  })

  it('install then uninstall leaves settings.json byte-identical to the backup', () => {
    const { backup } = install(paths)
    uninstall(paths)
    expect(read(paths.settings)).toBe(read(backup!))
    expect(isInstalled(paths.settings)).toBe(false)
  })

  it('keeps unrelated changes made between install and uninstall', () => {
    install(paths)
    const edited = JSON.parse(read(paths.settings))
    edited.theme = 'dark'
    writeFileSync(paths.settings, pretty(edited))
    uninstall(paths)
    expect(read(paths.settings)).toBe(pretty({ ...existing, theme: 'dark' }))
  })

  it('re-reads the file before patching, so a key changed after the backup survives', () => {
    const backup = backupSettings(paths.settings)
    writeFileSync(paths.settings, pretty({ ...existing, model: 'opus' }))
    addHook(paths)
    expect(JSON.parse(read(paths.settings)).model).toBe('opus')
    expect(read(backup!)).toBe(original)
  })

  it('a write killed halfway leaves the original file, never invalid JSON', () => {
    crash.writes = true
    expect(() => addHook(paths)).toThrow('killed mid-write')
    crash.writes = false
    expect(read(paths.settings)).toBe(original)
    expect(readdirSync(dirname(paths.settings))).toEqual(['settings.json'])
  })

  it('leaves a settings.json it can’t parse alone', () => {
    writeFileSync(paths.settings, '{ "theme": ')
    expect(() => install(paths)).toThrow(/isn’t valid JSON/)
    expect(read(paths.settings)).toBe('{ "theme": ')
    expect(readdirSync(dirname(paths.settings))).toEqual(['settings.json'])
  })

  it('writes through a symlinked settings.json and keeps the link', () => {
    const real = join(root, 'dotfiles.json')
    writeFileSync(real, original)
    rmSync(paths.settings)
    symlinkSync(real, paths.settings)
    install(paths)
    expect(marked(JSON.parse(read(real)), 'Stop')).toHaveLength(1)
    uninstall(paths)
    expect(read(real)).toBe(original)
    expect(lstatSync(paths.settings).isSymbolicLink()).toBe(true)
  })
})

describe('hook endpoint', () => {
  it('is a user-only file holding the port and a secret that survives restarts', () => {
    const secret = endpointSecret(paths.dir)
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    writeEndpoint(paths.dir, 4321, secret)
    const file = join(paths.dir, endpointName)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(read(file)).toContain('http://127.0.0.1:4321/hook')
    expect(endpointSecret(paths.dir)).toBe(secret)
    writeEndpoint(paths.dir, 5678, endpointSecret(paths.dir))
    expect(read(file)).toContain(`127.0.0.1:5678`)
    expect(read(file)).toContain(secret)
  })
})
