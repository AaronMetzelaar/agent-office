import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commandList, wireCommands } from '../../src/main/commands'
import { frontmatter, scanCommands } from '../../src/main/commands/scan'
import type { Hub } from '../../src/main/ipc'
import { openDb } from '../../src/main/store/db'
import type { CommandList, CommandTarget } from '../../src/shared/commands'
import { createFakeEngine } from '../fakes/fake-engine'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
const write = (path: string, text: string) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), text)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-commands-'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('frontmatter', () => {
  it('reads plain, quoted, folded and literal values', () => {
    const meta = frontmatter(['---', 'name: unslop', 'description: "Cut AI tells: always."', 'argument-hint: <file>', 'long: >', '  one', '  two', 'kept: |', '  a', '  b', '---', 'body: no'].join('\n'))
    expect(meta).toEqual({ name: 'unslop', description: 'Cut AI tells: always.', 'argument-hint': '<file>', long: 'one two', kept: 'a\nb' })
  })

  it('returns nothing without a frontmatter block', () => {
    expect(frontmatter('# Title\nname: nope')).toEqual({})
  })
})

describe('local scan', () => {
  it('finds user and project skills, nested commands and enabled plugins, project first', () => {
    const home = join(dir, 'home')
    const repo = join(dir, 'repo')
    write('home/skills/unslop/SKILL.md', '---\nname: unslop\ndescription: Cut AI tells\n---\n')
    write('home/skills/broken/README.md', 'no skill here')
    write('home/skills/shared/SKILL.md', '---\nname: shared\ndescription: user copy\n---\n')
    write('home/commands/gsd/add-phase.md', '---\ndescription: Add a phase\nargument-hint: <name>\n---\n')
    write('home/commands/mws-gate.md', '# Run the gate\n\nbody')
    write('repo/.claude/skills/shared/SKILL.md', '---\nname: shared\ndescription: project copy\n---\n')
    write('repo/.claude/commands/deploy.md', '---\ndescription: Ship it\n---\n')
    write('plugins/ponytail/skills/ponytail/SKILL.md', '---\nname: ponytail\ndescription: Lazy mode\n---\n')
    write('plugins/ponytail/commands/audit.md', '---\ndescription: Audit\n---\n')
    write('plugins/off/skills/hidden/SKILL.md', '---\nname: hidden\n---\n')
    write('home/plugins/installed_plugins.json', JSON.stringify({ plugins: { 'ponytail@ponytail': [{ installPath: join(dir, 'plugins/ponytail') }], 'off@market': [{ installPath: join(dir, 'plugins/off') }] } }))
    write('home/settings.json', JSON.stringify({ enabledPlugins: { 'ponytail@ponytail': true, 'off@market': false } }))

    const found = scanCommands(home, [repo, repo])
    expect(found.map((entry) => `${entry.kind}:${entry.name}`).sort()).toEqual(
      ['command:deploy', 'command:gsd:add-phase', 'command:mws-gate', 'plugin:ponytail:audit', 'plugin:ponytail:ponytail', 'skill:shared', 'skill:unslop'].sort(),
    )
    expect(found.find((entry) => entry.name === 'shared')?.description).toBe('project copy')
    expect(found.find((entry) => entry.name === 'gsd:add-phase')).toMatchObject({ description: 'Add a phase', argumentHint: '<name>' })
    expect(found.find((entry) => entry.name === 'mws-gate')?.description).toBe('Run the gate')
  })

  it('finds nothing in missing folders', () => {
    expect(scanCommands(join(dir, 'nope'), [join(dir, 'nothing')])).toEqual([])
  })
})

describe('command list', () => {
  const scanned = [
    { name: 'unslop', description: 'Cut AI tells', argumentHint: '', kind: 'skill' as const },
    { name: 'deploy', description: 'Ship it', argumentHint: '', kind: 'command' as const },
  ]
  const live = [
    { name: 'compact', description: 'Compact the chat', argumentHint: '<instructions>', builtin: true },
    { name: 'deploy', description: 'Ship it', argumentHint: '' },
    { name: 'codex:rescue', description: 'Hand to Codex', argumentHint: '' },
    { name: 'mws-pr', description: 'Open a PR', argumentHint: '' },
  ]

  it('prefers the live list, then the last session, then the scan', () => {
    const saved = [{ name: 'mws-verify', description: 'Verify', argumentHint: '' }]
    expect(commandList({ live, running: true, saved }, scanned).source).toBe('live')
    expect(commandList({ live, running: false, saved }, scanned).source).toBe('last-session')
    expect(commandList({ running: false, saved }, scanned)).toEqual({ source: 'last-session', entries: [{ name: 'mws-verify', description: 'Verify', argumentHint: '', kind: 'skill' }] })
    expect(commandList({ running: false }, scanned)).toEqual({ source: 'scan', entries: scanned })
  })

  it('sorts live entries into built-in, custom commands, plugin skills and skills', () => {
    const kinds = commandList({ live, running: true }, scanned).entries.map((entry) => `${entry.kind}:${entry.name}`)
    expect(kinds).toEqual(['builtin:compact', 'command:deploy', 'plugin:codex:rescue', 'skill:mws-pr'])
  })

  it('keeps one row per name, and the built-in one when a name is shared', () => {
    const shared = [
      { name: 'review', description: 'user', argumentHint: '' },
      { name: 'review', description: 'builtin', argumentHint: '', builtin: true },
      { name: 'review', description: 'another', argumentHint: '' },
    ]
    expect(commandList({ live: shared, running: true }, []).entries).toEqual([{ name: 'review', description: 'builtin', argumentHint: '', kind: 'builtin' }])
  })
})

describe('getCommands', () => {
  function wire(engine = createFakeEngine(), db = openDb(join(dir, 'office.db'))) {
    const handlers = new Map<string, (target: CommandTarget) => CommandList>()
    const hub = { handle: (name: string, command: never) => void handlers.set(name, command), send: vi.fn() } as unknown as Hub
    const repo = join(dir, 'repo')
    mkdirSync(repo, { recursive: true })
    const wired = wireCommands(hub, { engine, store: { view: (chatId) => (chatId === 'c1' ? ({ cwd: repo } as never) : undefined) }, db, claudeDir: join(dir, 'home') })
    return { engine, db, repo, wired, get: (target: CommandTarget) => handlers.get('getCommands')!(target) }
  }

  it('saves the live list per repository and shows it after a relaunch, before the next live list', () => {
    write('home/skills/unslop/SKILL.md', '---\nname: unslop\ndescription: Cut AI tells\n---\n')
    const first = wire()
    expect(first.get({ chatId: 'c1' }).source).toBe('scan')
    expect(first.get({ chatId: 'c1' }).entries.map((entry) => entry.name)).toEqual(['unslop'])

    first.engine.start('c1', { accountId: 'main', cwd: first.repo })
    first.engine.supports(['compact', 'mws-pr'])
    first.engine.init('c1')
    expect(first.get({ chatId: 'c1' })).toMatchObject({ source: 'live', entries: [{ name: 'compact' }, { name: 'mws-pr' }] })
    expect(first.wired.names('c1')).toEqual(['compact', 'mws-pr'])
    first.db.close()

    const relaunched = wire()
    expect(relaunched.get({ chatId: 'c1' })).toMatchObject({ source: 'last-session', entries: [{ name: 'compact' }, { name: 'mws-pr' }] })
    expect(relaunched.get({ cwd: relaunched.repo })).toMatchObject({ source: 'last-session', entries: [{ name: 'compact' }, { name: 'mws-pr' }] })
    relaunched.db.close()
  })

  it('refuses unknown chats and relative folders', () => {
    const { get, db } = wire()
    expect(() => get({ chatId: 'nope' })).toThrow('no chat')
    expect(() => get({ cwd: 'relative/path' })).toThrow('absolute')
    expect(() => get(undefined as never)).toThrow('absolute')
    db.close()
  })
})
