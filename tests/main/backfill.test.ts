import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatPatch } from '../../src/shared/chat'
import { createRooms } from '../../src/main/departments/rooms'
import { createDesktopMeta, instances } from '../../src/main/outside/desktop-meta'
import { createDiscovery, inferState, workingWindowMs } from '../../src/main/outside/transcripts'
import { createVisitors, type VisitorOptions } from '../../src/main/outside/visitors'
import { configOf, researchGym } from '../fakes/office'
import { line, writeDesktopChat, writeTranscript } from '../fakes/outside'
import { mwsMonorepo } from '../fakes/repos'

const hour = 60 * 60_000
let accounts = [
  { id: 'acc-main', label: 'main' },
  { id: 'acc-research', label: 'research' },
]

let root: string
let claudeDir: string
let desktopDir: string
let repo: (path: string) => string

function wiring(settings = new Map<string, unknown>()): Pick<VisitorOptions, 'accounts' | 'instances' | 'rooms' | 'settings'> {
  const store = { setting: (key: string) => settings.get(key), saveSetting: (key: string, value: unknown) => void settings.set(key, value) }
  return { accounts: () => accounts, instances: () => instances(desktopDir), rooms: createRooms(store, configOf({ rooms: [researchGym] }), () => []), settings: store }
}

function open(skip = new Set<string>(), now = Date.now) {
  const patches: ChatPatch[] = []
  const discovery = createDiscovery({ projectsDir: join(claudeDir, 'projects'), desktop: createDesktopMeta(desktopDir).read })
  const visitors = createVisitors({
    ...wiring(),
    patch: (patch) => patches.push(patch),
    officeSessions: () => skip,
    describe: (id) => discovery.describe(id, Date.now()),
    now,
  })
  const scan = () => discovery.scan(Date.now(), skip)
  return { discovery, visitors, patches, scan, sync: () => visitors.sync(scan()) }
}

beforeEach(() => {
  accounts = [
    { id: 'acc-main', label: 'main' },
    { id: 'acc-research', label: 'research' },
  ]
  root = mkdtempSync(join(tmpdir(), 'agent-office-backfill-'))
  claudeDir = join(root, 'claude')
  desktopDir = join(root, 'desktop')
  repo = (path) => {
    const dir = join(root, path)
    mkdirSync(dir, { recursive: true })
    return dir
  }
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('backfill', { timeout: 60_000 }, () => {
  it('shows chats active in the last day from both desktop instances and the terminal, and nothing else', () => {
    const now = Date.now()
    const ids = Object.fromEntries(['main', 'research', 'archived', 'old', 'terminal', 'office', 'sdk', 'prior', 'spike'].map((name) => [name, randomUUID()]))
    const marketplace = join(mwsMonorepo(join(root, 'code', 'mws')), 'frontend/marketplace')
    const rsa = repo('side/rsa')
    const tray = repo('agent-office')
    writeTranscript(claudeDir, ids.main!, [line.user('Fix the bid rounding in BidFlow'), line.text('Fixed.')], { cwd: marketplace, at: now - hour })
    writeDesktopChat(desktopDir, 'Claude', { cliSessionId: ids.main, title: 'Fix the bid rounding', cwd: marketplace, lastActivityAt: now - hour, lastFocusedAt: now, priorCliSessionIds: [ids.prior] })
    writeTranscript(claudeDir, ids.research!, [line.user('Explore factoring')], { cwd: rsa, at: now - 2 * hour })
    writeDesktopChat(desktopDir, 'Claude-Research', { cliSessionId: ids.research, title: 'Explore RSA factoring', cwd: rsa, lastActivityAt: now - 2 * hour })
    writeTranscript(claudeDir, ids.archived!, [line.user('Old spike')], { cwd: tray })
    writeDesktopChat(desktopDir, 'Claude', { cliSessionId: ids.archived, title: 'Old spike', cwd: tray, isArchived: true })
    writeTranscript(claudeDir, ids.old!, [line.user('Last week')], { cwd: tray, at: now - 30 * hour })
    writeTranscript(claudeDir, ids.terminal!, [line.user('<command-name>/clear</command-name>'), line.user('<system-reminder>ctx</system-reminder>\nRefactor the tray strip\nand its tests'), line.text('Done.')], { cwd: tray, entrypoint: 'cli', at: now - hour })
    writeTranscript(claudeDir, ids.office!, [line.user('Office chat')], { cwd: tray, entrypoint: 'cli' })
    writeTranscript(claudeDir, ids.sdk!, [line.user('Validate token')], { cwd: tray, entrypoint: 'sdk-ts' })
    writeTranscript(claudeDir, ids.prior!, [line.user('Before a resume')], { cwd: marketplace, entrypoint: 'cli' })
    writeTranscript(claudeDir, ids.spike!, [line.user('Reply with exactly: ok')], { cwd: tray, entrypoint: 'claude-desktop' })
    writeFileSync(join(claudeDir, 'projects', 'not-a-session.jsonl'), '')

    const { visitors, sync } = open(new Set([ids.office!]))
    sync()

    expect(visitors.views().map((view) => view.id).sort()).toEqual([ids.main, ids.research, ids.terminal].sort())
    expect(visitors.view(ids.main!)).toMatchObject({ visitor: 'desktop', accountId: 'acc-main', department: 'mkt', title: 'Fix the bid rounding', state: 'idle', unread: false })
    expect(visitors.view(ids.research!)).toMatchObject({ visitor: 'desktop', accountId: 'acc-research', department: 'c-research-gym', title: 'Explore RSA factoring' })
    expect(visitors.view(ids.terminal!)).toMatchObject({ visitor: 'terminal', accountId: 'unknown', department: 'side', title: 'Refactor the tray strip', cwd: tray })
  })

  it('infers a first state from the transcript tail and when it was last written', () => {
    const now = Date.now()
    const cwd = repo('app')
    const chat = (lines: Record<string, unknown>[], at: number, focusedAt?: number) => {
      const id = randomUUID()
      writeTranscript(claudeDir, id, lines, { cwd, at, entrypoint: focusedAt === undefined ? 'cli' : 'claude-desktop' })
      if (focusedAt !== undefined) writeDesktopChat(desktopDir, 'Claude', { cliSessionId: id, title: 'Chat', cwd, lastActivityAt: at, lastFocusedAt: focusedAt })
      return id
    }
    const read = line.tool('Read', { file_path: join(cwd, 'a.ts') }, 'toolu_1')
    const working = chat([line.user('Go'), read], now - 5_000)
    const thinking = chat([line.user('Go'), read, line.result('toolu_1')], now - 60_000)
    const quiet = chat([line.user('Go'), read], now - 2 * workingWindowMs)
    const unseen = chat([line.user('Go'), line.text('All done.')], now - hour, now - 2 * hour)
    const seen = chat([line.user('Go'), line.text('All done.')], now - hour, now)
    const stopped = chat([line.user('Go'), read, line.user('[Request interrupted by user]')], now - 5_000)

    const { visitors, sync } = open()
    sync()
    expect(visitors.view(working)?.state).toBe('working')
    expect(visitors.view(thinking)?.state).toBe('working')
    expect(visitors.view(quiet)?.state).toBe('idle')
    expect(visitors.view(unseen)).toMatchObject({ state: 'done', unread: true })
    expect(visitors.view(seen)).toMatchObject({ state: 'idle', unread: false })
    expect(visitors.view(stopped)?.state).toBe('idle')
    expect(inferState({}, now - 1000, now)).toBe('working')
  })

  it('places a chat by the files its recent tool calls touched, but keeps research chats in the gym', () => {
    const monorepo = mwsMonorepo(join(root, 'mws'))
    const admin = join(monorepo, 'frontend/admin/src/Users.vue')
    const edits = [line.tool('Edit', { file_path: admin }), line.tool('Edit', { file_path: admin }), line.tool('Read', { file_path: admin })]
    const [mainId, researchId] = [randomUUID(), randomUUID()]
    writeTranscript(claudeDir, mainId, [line.user('Fix the users table'), ...edits], { cwd: monorepo })
    writeDesktopChat(desktopDir, 'Claude', { cliSessionId: mainId, cwd: monorepo, lastActivityAt: Date.now() })
    writeTranscript(claudeDir, researchId, [line.user('Overflow work'), ...edits], { cwd: monorepo })
    writeDesktopChat(desktopDir, 'Claude-Research', { cliSessionId: researchId, cwd: monorepo, lastActivityAt: Date.now() })

    const { visitors, sync } = open()
    sync()
    expect(visitors.view(mainId)).toMatchObject({ department: 'adm', title: 'Fix the users table' })
    expect(visitors.view(researchId)?.department).toBe('c-research-gym')
  })

  it('lets hook events take over the state, while rescans still update the title', () => {
    const cwd = repo('app')
    const id = randomUUID()
    writeTranscript(claudeDir, id, [line.user('Go'), line.text('Done.')], { cwd, at: Date.now() - hour })
    const meta = writeDesktopChat(desktopDir, 'Claude', { cliSessionId: id, title: 'First title', cwd, lastActivityAt: Date.now() - hour, lastFocusedAt: Date.now() })

    const { visitors, sync } = open()
    sync()
    expect(visitors.view(id)?.state).toBe('idle')
    visitors.hook({ session_id: id, hook_event_name: 'UserPromptSubmit', prompt: 'Now add a test' })
    writeFileSync(meta, JSON.stringify({ cliSessionId: id, title: 'Better title', cwd, lastActivityAt: Date.now() - hour, lastFocusedAt: Date.now() }))
    sync()
    expect(visitors.view(id)).toMatchObject({ state: 'working', title: 'Better title' })
  })

  it('trusts hook state until a working chat has been quiet for half an hour', () => {
    const cwd = repo('app')
    const id = randomUUID()
    writeTranscript(claudeDir, id, [line.user('Go'), line.text('Done.')], { cwd, entrypoint: 'cli', at: Date.now() - hour })
    let clock = Date.now()
    const { visitors, sync } = open(new Set(), () => clock)
    sync()
    visitors.hook({ session_id: id, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'pnpm test' } })
    sync()
    expect(visitors.view(id)?.state).toBe('working')

    clock += 31 * 60_000
    sync()
    expect(visitors.view(id)?.state).toBe('idle')
  })

  it('keeps an old chat that a hook event says is live again', () => {
    const cwd = repo('app')
    const id = randomUUID()
    writeTranscript(claudeDir, id, [line.user('Old work'), line.text('Done.')], { cwd, entrypoint: 'cli', at: Date.now() - 3 * 24 * hour })
    const { visitors, sync } = open()
    sync()
    expect(visitors.has(id)).toBe(false)
    visitors.hook({ session_id: id, hook_event_name: 'SessionStart' })
    sync()
    expect(visitors.view(id)).toMatchObject({ title: 'Old work', state: 'idle' })
  })

  it('removes a chat once the desktop app archives it', () => {
    const cwd = repo('app')
    const id = randomUUID()
    writeTranscript(claudeDir, id, [line.user('Go')], { cwd })
    const meta = writeDesktopChat(desktopDir, 'Claude', { cliSessionId: id, title: 'Soon archived', cwd, lastActivityAt: Date.now() })
    const { visitors, patches, sync } = open()
    sync()
    expect(visitors.has(id)).toBe(true)

    writeFileSync(meta, JSON.stringify({ cliSessionId: id, title: 'Soon archived', cwd, lastActivityAt: Date.now(), isArchived: true }))
    sync()
    expect(visitors.has(id)).toBe(false)
    expect(patches.at(-1)).toEqual({ id, fields: { archived: true } })
  })

  it('keeps a chat read in the office read across rescans and restarts, until a new turn finishes', () => {
    const cwd = repo('app')
    const id = randomUUID()
    const now = Date.now()
    writeTranscript(claudeDir, id, [line.user('Go'), line.text('All done.')], { cwd, at: now - hour })
    writeDesktopChat(desktopDir, 'Claude', { cliSessionId: id, title: 'Chat', cwd, lastActivityAt: now - hour, lastFocusedAt: now - 2 * hour })
    const settings = new Map<string, unknown>()
    const make = () =>
      createVisitors({
        ...wiring(settings),
        patch: () => {},
        officeSessions: () => new Set(),
        describe: () => undefined,
      })
    const scan = () => createDiscovery({ projectsDir: join(claudeDir, 'projects'), desktop: createDesktopMeta(desktopDir).read }).scan(Date.now(), new Set())
    const first = make()
    first.sync(scan())
    expect(first.view(id)).toMatchObject({ state: 'done', unread: true })
    first.markRead(id)
    first.sync(scan())
    expect(first.view(id)).toMatchObject({ state: 'idle', unread: false })

    const second = make()
    second.sync(scan())
    expect(second.view(id)).toMatchObject({ state: 'idle', unread: false })

    writeTranscript(claudeDir, id, [line.user('Go'), line.text('All done.'), line.user('More'), line.text('Done again.')], { cwd, at: Date.now() + 60_000 })
    const third = make()
    third.sync(scan())
    expect(third.view(id)).toMatchObject({ state: 'done', unread: true })
  })

  it('remembers a moved chat across restarts and shows it as Moved', () => {
    const cwd = repo('app')
    const id = randomUUID()
    writeTranscript(claudeDir, id, [line.user('Go')], { cwd, entrypoint: 'cli' })
    const settings = new Map<string, unknown>()
    const make = () =>
      createVisitors({
        ...wiring(settings),
        patch: () => {},
        officeSessions: () => new Set(),
        describe: () => undefined,
      })
    const scan = () => createDiscovery({ projectsDir: join(claudeDir, 'projects'), desktop: () => new Map() }).scan(Date.now(), new Set())
    const first = make()
    first.sync(scan())
    first.markMoved(id)
    expect(first.view(id)).toMatchObject({ moved: true, parked: true })

    const second = make()
    second.sync(scan())
    expect(second.view(id)).toMatchObject({ moved: true, parked: true })
  })

  it('maps each desktop instance to the account whose label it names, and the rest to the first account no other instance names', () => {
    const cwd = repo('app')
    const chatIn = (instance: string) => {
      const id = randomUUID()
      writeTranscript(claudeDir, id, [line.user('Go')], { cwd })
      writeDesktopChat(desktopDir, instance, { cliSessionId: id, cwd, lastActivityAt: Date.now() })
      return id
    }
    const [research, plain, thirdParty] = ['Claude-Research', 'Claude', 'Claude-3p'].map(chatIn)
    const { visitors, sync } = open()
    sync()
    expect([research, plain, thirdParty].map((id) => visitors.view(id!)?.accountId)).toEqual(['acc-research', 'acc-main', 'acc-main'])

    accounts = [
      { id: 'acc-main', label: 'main' },
      { id: 'acc-domain', label: 'domain' },
    ]
    const domain = chatIn('Claude-Domain')
    const second = open()
    second.sync()
    expect(second.visitors.view(domain)?.accountId).toBe('acc-domain')
    expect(second.visitors.view(plain!)?.accountId).toBe('acc-main')

    accounts = []
    const none = open()
    none.sync()
    expect(none.visitors.view(domain)?.accountId).toBe('unknown')
  })
})
