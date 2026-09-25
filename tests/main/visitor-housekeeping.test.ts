import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { day, summaryText } from '../../src/shared/housekeeping'
import { wireHousekeeping } from '../../src/main/housekeeping'
import { windowHub } from '../../src/main/ipc'
import { wireOutside, type Outside } from '../../src/main/outside'
import { createDesktopMeta, instances } from '../../src/main/outside/desktop-meta'
import { createDiscovery } from '../../src/main/outside/transcripts'
import { createVisitors } from '../../src/main/outside/visitors'
import { openDb } from '../../src/main/store/db'
import { toAgents } from '../../src/renderer/state/projection'
import { handlers } from '../fakes/electron'
import { openHousekeeping, openOffice } from '../fakes/office'
import { line, writeDesktopChat, writeTranscript } from '../fakes/outside'
import { claudeWorktree, gitRepo } from '../fakes/repos'

vi.mock('electron', () => import('../fakes/electron'))

const minute = 60_000
const hour = 60 * minute

let dir: string
let repo: string
let claudeDir: string
let desktopDir: string
let office: ReturnType<typeof openOffice>

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=office@test', '-c', 'user.name=office', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-visitors-')))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  vi.stubEnv('HOME', dir)
  claudeDir = join(dir, 'claude')
  desktopDir = join(dir, 'desktop')
  const origin = join(dir, 'origin.git')
  repo = join(dir, 'repo')
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin)
  git(dir, 'clone', '-q', origin, repo)
  writeFileSync(join(repo, 'a.ts'), 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  office = openOffice(dir)
})

afterEach(() => {
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function worktree(name: string, change?: 'uncommitted' | 'unpushed' | 'pushed') {
  const path = join(repo, '.claude', 'worktrees', name)
  git(repo, 'worktree', 'add', '-q', '-b', name, path)
  if (change) writeFileSync(join(path, `${name}.ts`), 'work\n')
  if (change === 'unpushed' || change === 'pushed') {
    git(path, 'add', '.')
    git(path, 'commit', '-q', '-m', name)
  }
  if (change === 'pushed') git(path, 'push', '-q', '-u', 'origin', name)
  return path
}

function visitor(cwd: string, ago: number, lines = [line.user('Fix the bid flow'), line.text('Done.')]) {
  const id = randomUUID()
  writeTranscript(claudeDir, id, lines, { cwd, at: Date.now() - ago })
  writeDesktopChat(desktopDir, 'Claude', { cliSessionId: id, title: `Visitor ${id.slice(0, 4)}`, cwd, lastActivityAt: Date.now() - ago })
  return id
}

function openVisitors(settings: { setting(key: string): unknown; saveSetting(key: string, value: unknown): void } = office.db) {
  const discovery = createDiscovery({ projectsDir: join(claudeDir, 'projects'), desktop: createDesktopMeta(desktopDir).read })
  const visitors = createVisitors({
    patch: () => {},
    accounts: () => [{ id: 'main', label: 'main' }],
    instances: () => [],
    rooms: office.rooms,
    officeSessions: () => new Set(),
    describe: (id) => discovery.describe(id, Date.now()),
    settings,
    log: () => {},
  })
  const sync = () => visitors.sync(discovery.scan(Date.now(), new Set()))
  sync()
  return { visitors, sync }
}

describe('archiving a visitor', () => {
  it('persists in office.db across a restart, and backfill and lifecycle hooks skip it', () => {
    const cwd = join(dir, 'app')
    mkdirSync(cwd)
    const id = visitor(cwd, hour)
    const file = join(dir, 'visitors.db')
    let db = openDb(file)
    const first = openVisitors(db)
    expect(first.visitors.has(id)).toBe(true)

    expect(first.visitors.archive(id)).toBe(true)
    expect(first.visitors.has(id)).toBe(false)
    db.close()

    db = openDb(file)
    const second = openVisitors(db)
    expect(second.visitors.has(id)).toBe(false)
    second.visitors.hook({ session_id: id, hook_event_name: 'SessionStart' })
    second.visitors.hook({ session_id: id, hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })
    second.visitors.hook({ session_id: id, hook_event_name: 'SessionEnd' })
    second.sync()
    expect(second.visitors.has(id)).toBe(false)
    expect(second.visitors.archive(id)).toBe(false)
    db.close()
  })

  it('brings the chat back after a new transcript write or a hook event for real activity', () => {
    const cwd = join(dir, 'app')
    mkdirSync(cwd)
    const written = visitor(cwd, hour)
    const hooked = visitor(cwd, hour)
    const { visitors, sync } = openVisitors()
    visitors.archive(written)
    visitors.archive(hooked)

    writeTranscript(claudeDir, written, [line.user('Fix the bid flow'), line.text('Done.'), line.user('One more thing')], { cwd, at: Date.now() + 1000 })
    sync()
    expect(visitors.has(written)).toBe(true)

    visitors.hook({ session_id: hooked, hook_event_name: 'UserPromptSubmit', prompt: 'Carry on' })
    expect(visitors.view(hooked)).toMatchObject({ state: 'working' })
    sync()
    expect(visitors.has(hooked)).toBe(true)
  })
})

describe('visitors in worktrees', () => {
  it('keeps a quiet visitor for Housekeeping while its worktree exists, off the office floor, and drops quiet ones elsewhere', () => {
    const tree = worktree('quiet')
    const elsewhere = join(dir, 'app')
    mkdirSync(elsewhere)
    const kept = visitor(tree, 4 * day)
    const dropped = visitor(elsewhere, 4 * day)
    const recent = visitor(tree, hour)
    const revived = visitor(tree, 4 * day)

    const { visitors, sync } = openVisitors()

    expect(visitors.view(kept)).toMatchObject({ retained: true, state: 'idle' })
    expect(visitors.view(kept)?.parked).toBeUndefined()
    expect(visitors.has(dropped)).toBe(false)
    expect(visitors.view(recent)?.retained).toBeUndefined()
    const onFloor = () => toAgents(visitors.snapshot(), [], Date.now(), new Map()).map((agent) => agent.id).sort()
    expect(onFloor()).toEqual([recent])

    visitors.hook({ session_id: revived, hook_event_name: 'UserPromptSubmit', prompt: 'Back at it' })
    expect(visitors.view(revived)?.retained).toBe(false)
    expect(onFloor()).toEqual([recent, revived].sort())
    git(repo, 'worktree', 'remove', tree)
    sync()
    expect(visitors.has(kept)).toBe(false)
  })

  it('refuses to remove the worktree when dirty, unpushed, working, waiting or recently active', async () => {
    const trees = { dirty: worktree('dirty', 'uncommitted'), ahead: worktree('ahead', 'unpushed'), busy: worktree('busy'), asking: worktree('asking'), recent: worktree('recent') }
    const ids = { dirty: visitor(trees.dirty, hour), ahead: visitor(trees.ahead, hour), busy: visitor(trees.busy, hour), asking: visitor(trees.asking, hour), recent: visitor(trees.recent, 5 * minute) }
    const { visitors } = openVisitors()
    visitors.hook({ session_id: ids.busy, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'pnpm test' } })
    visitors.hook({ session_id: ids.asking, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission' })
    const { house } = openHousekeeping(office, {}, visitors)

    expect(await house.removeVisitorWorktree(ids.dirty)).toEqual({ error: 'Can’t remove the worktree: 1 uncommitted change.' })
    expect(await house.removeVisitorWorktree(ids.ahead)).toEqual({ error: 'Can’t remove the worktree: 1 unpushed commit, and the PR state is unknown.' })
    expect(await house.removeVisitorWorktree(ids.busy)).toEqual({ error: 'Can’t remove the worktree: the chat is working in the desktop app.' })
    expect(await house.removeVisitorWorktree(ids.asking)).toEqual({ error: 'Can’t remove the worktree: the chat is waiting for you in the desktop app.' })
    expect(await house.removeVisitorWorktree(ids.recent)).toEqual({ error: 'Can’t remove the worktree: the chat had activity in the last 10 minutes.' })
    for (const path of Object.values(trees)) expect(existsSync(path)).toBe(true)
    for (const id of Object.values(ids)) expect(visitors.has(id)).toBe(true)
  })

  it('removes a clean or fully pushed worktree without force and archives the chat', async () => {
    const clean = worktree('clean')
    const pushed = worktree('pushed', 'pushed')
    const ids = [visitor(clean, hour), visitor(pushed, 2 * hour)]
    const { visitors } = openVisitors()
    const calls: string[][] = []
    const { house } = openHousekeeping(office, { run: (command, args, cwd) => (calls.push([command, ...args]), office.engine.processes.run(command, args, cwd)) }, visitors)

    for (const id of ids) expect(await house.removeVisitorWorktree(id)).not.toHaveProperty('error')

    expect(existsSync(clean) || existsSync(pushed)).toBe(false)
    expect(ids.some((id) => visitors.has(id))).toBe(false)
    expect(calls.filter(([command, sub]) => command === 'git' && sub === 'worktree').flat()).not.toContain('--force')
    const restarted = openVisitors()
    expect(ids.some((id) => restarted.visitors.has(id))).toBe(false)
  })

  it('includes quiet visitors in clean up safe and counts them in the summary', async () => {
    const cleanTree = worktree('old-clean')
    const dirtyTree = worktree('old-dirty', 'uncommitted')
    const clean = visitor(cleanTree, 4 * day)
    const dirty = visitor(dirtyTree, 4 * day)
    const officeTree = worktree('office-clean')
    const officeChat = office.start('Office work', 'main', officeTree)
    office.finish(officeChat)
    const { visitors } = openVisitors()
    const { house, clock } = openHousekeeping(office, {}, visitors)
    clock.now += 4 * day

    const view = await house.refresh()
    expect(view.candidates).toEqual(expect.arrayContaining([clean, dirty, officeChat]))
    expect(view.safe.sort()).toEqual([clean, officeChat].sort())
    expect(view.worktrees.find((tree) => tree.path === cleanTree)?.chatIds).toEqual([clean])

    const summary = await house.cleanUp()

    expect(summary).toMatchObject({ chats: 2, visitors: 1, removed: 2, skipped: [] })
    expect(summaryText(summary)).toMatch(/removed 2 worktrees .* · 1 was a visitor$/)
    expect(existsSync(cleanTree) || existsSync(officeTree)).toBe(false)
    expect(existsSync(dirtyTree)).toBe(true)
    expect(visitors.has(clean)).toBe(false)
    expect(visitors.has(dirty)).toBe(true)
  })

  it('counts RAM only for a claude process whose arguments carry the session id', async () => {
    const cwd = join(dir, 'app')
    mkdirSync(cwd)
    const [resumed, fresh] = [visitor(cwd, hour), visitor(cwd, hour)]
    const { visitors } = openVisitors()
    const table = office.engine.processes.table
    table.set(91_000, { ppid: 1, kb: 100_000, args: `/Applications/Claude/claude --output-format stream-json --resume=${resumed}` })
    table.set(91_001, { ppid: 91_000, kb: 20_000, args: 'node mcp-server.js' })
    table.set(92_000, { ppid: 1, kb: 80_000, args: `/Applications/Claude/claude --output-format stream-json --resume=${fresh} --fork-session` })
    const { house } = openHousekeeping(office, {}, visitors)

    const view = await house.sample()

    expect(view.agents.filter((use) => use.chatId === resumed || use.chatId === fresh)).toEqual([{ chatId: resumed, bytes: 120_000 * 1024, processes: expect.any(Array) }])
  })
})

describe('visitor IPC', () => {
  it('refuses unknown ids, office chats and paths, and only archives after confirming', async () => {
    const cwd = join(dir, 'app')
    mkdirSync(cwd)
    const id = visitor(cwd, hour)
    const { visitors } = openVisitors()
    const { house } = openHousekeeping(office, {}, visitors)
    const appUrl = 'app://office/index.html'
    const win = { webContents: { send: () => {} }, isDestroyed: () => false } as unknown as BrowserWindow
    const confirm = vi.fn(async () => false)
    wireHousekeeping(windowHub(win, appUrl), house)
    wireOutside(windowHub(win, appUrl), { visitors, paths: { settings: join(dir, 'settings.json'), dir } } as Outside, { store: office.store, accounts: () => [], rooms: office.rooms, settings: () => ({ phonePush: false, phonePushAvailable: false, alertsHintSeen: false, editor: 'code', outsideChats: false }), confirm })
    const trusted = { sender: win.webContents, senderFrame: { url: appUrl } }
    const invoke = (name: string, ...args: unknown[]) => handlers.get(name)!(trusted, ...args)
    const officeChat = office.start('Office work')

    for (const bad of [randomUUID(), officeChat, cwd, undefined, 42]) {
      expect(await invoke('removeVisitorWorktree', bad)).toEqual({ error: 'That chat isn’t in the office any more.' })
      expect(await invoke('archiveVisitor', bad)).toEqual({ error: 'That chat isn’t in the office any more.' })
    }
    expect(confirm).not.toHaveBeenCalled()
    expect(() => handlers.get('archiveVisitor')!({ sender: {}, senderFrame: { url: appUrl } }, id)).toThrow(/refused/)

    expect(await invoke('archiveVisitor', id)).toBeUndefined()
    expect(visitors.has(id)).toBe(true)
    expect(confirm).toHaveBeenCalledWith('Archive this chat in the office?', 'Hidden from the office. It stays in the desktop app until you archive it there.', 'Archive')
    confirm.mockResolvedValue(true)
    expect(await invoke('archiveVisitor', id)).toEqual({})
    expect(visitors.has(id)).toBe(false)
  })

  it('moves a visitor into the office in its own room, a research visitor into the room tied to its account, and out of it on another account', async () => {
    const shop = gitRepo(join(dir, 'shop'))
    const mainId = visitor(shop, hour)
    const [researchId, overflowId] = [randomUUID(), randomUUID()]
    for (const id of [researchId, overflowId]) {
      writeTranscript(claudeDir, id, [line.user('Explore factoring')], { cwd: shop, at: Date.now() - hour })
      writeDesktopChat(desktopDir, 'Claude-Research', { cliSessionId: id, title: 'Factoring', cwd: shop, lastActivityAt: Date.now() - hour })
    }
    const accounts = () => ['main', 'research'].map((id) => ({ id, label: id, createdAt: 0, health: { status: office.loggedOut.has(id) ? ('needs-login' as const) : ('ok' as const) } }))
    const discovery = createDiscovery({ projectsDir: join(claudeDir, 'projects'), desktop: createDesktopMeta(desktopDir).read })
    const visitors = createVisitors({ patch: () => {}, accounts, instances: () => instances(desktopDir), rooms: office.rooms, officeSessions: () => new Set(), describe: () => undefined, settings: office.db, log: () => {} })
    visitors.sync(discovery.scan(Date.now(), new Set()))
    const appUrl = 'app://office/index.html'
    const win = { webContents: { send: () => {} }, isDestroyed: () => false } as unknown as BrowserWindow
    wireOutside(windowHub(win, appUrl), { visitors, paths: { settings: join(dir, 'settings.json'), dir } } as Outside, { store: office.store, accounts, rooms: office.rooms, settings: () => ({ phonePush: false, phonePushAvailable: false, alertsHintSeen: false, editor: 'code', outsideChats: false }), confirm: async () => true })
    const move = async (id: string) => office.chat(((await handlers.get('moveIntoOffice')!({ sender: win.webContents, senderFrame: { url: appUrl } }, id)) as { chatId: string }).chatId)

    const home = visitors.view(mainId)!.department!
    expect(office.rooms.nameOf(home)).toBe('shop')
    expect(visitors.view(researchId)).toMatchObject({ accountId: 'research', department: 'c-research-gym' })
    expect(await move(mainId)).toMatchObject({ accountId: 'main', department: home })
    expect(await move(researchId)).toMatchObject({ accountId: 'research', department: 'c-research-gym' })
    office.loggedOut.add('research')
    expect(await move(overflowId)).toMatchObject({ accountId: 'main', department: home })
  })
})

describe('visitor rooms', { timeout: 60_000 }, () => {
  it('builds a room for a visitor in a new repo, keeps a non-git one on the playground, and builds none for a retained one until it wakes up', () => {
    const shop = gitRepo(join(dir, 'shop'))
    const notes = join(dir, 'notes')
    mkdirSync(notes)
    const quietTree = claudeWorktree(gitRepo(join(dir, 'ledger')), 'quiet')
    const inTerminal = (cwd: string, ago: number) => {
      const id = randomUUID()
      writeTranscript(claudeDir, id, [line.user('Fix the bid flow'), line.text('Done.')], { cwd, entrypoint: 'cli', at: Date.now() - ago })
      return id
    }
    const [terminal, plain, quiet] = [inTerminal(shop, hour), inTerminal(notes, hour), inTerminal(quietTree, 4 * day)]
    const { visitors } = openVisitors()
    const names = () => office.rooms.list().map((room) => room.name)

    expect(office.rooms.byId(visitors.view(terminal)!.department!)).toMatchObject({ name: 'shop', look: 'plain', root: shop })
    expect(visitors.view(plain)?.department).toBe('side')
    expect(visitors.view(quiet)).toMatchObject({ retained: true, department: 'side' })
    expect(names()).not.toContain('ledger')

    visitors.hook({ session_id: quiet, hook_event_name: 'UserPromptSubmit', prompt: 'Back at it' })
    expect(visitors.view(quiet)?.retained).toBe(false)
    expect(office.rooms.nameOf(visitors.view(quiet)?.department)).toBe('ledger')
  })
})
