import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultRules } from '../../src/shared/departments'
import { wireHousekeeping } from '../../src/main/housekeeping'
import { finishSteps } from '../../src/main/housekeeping/finish'
import { createDesktopMeta } from '../../src/main/outside/desktop-meta'
import { createDiscovery } from '../../src/main/outside/transcripts'
import { createVisitors } from '../../src/main/outside/visitors'
import { handlers } from '../fakes/electron'
import { openHousekeeping, openOffice } from '../fakes/office'
import { line, writeDesktopChat, writeTranscript } from '../fakes/outside'

vi.mock('electron', () => import('../fakes/electron'))

const hour = 3_600_000

let dir: string
let repo: string
let office: ReturnType<typeof openOffice>

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=office@test', '-c', 'user.name=office', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-finish-')))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  vi.stubEnv('HOME', dir)
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

function worktree(name: string, dirty = false) {
  const path = join(repo, '.claude', 'worktrees', name)
  git(repo, 'worktree', 'add', '-q', '-b', name, path)
  if (dirty) writeFileSync(join(path, `${name}.ts`), 'work\n')
  return path
}

function openVisitors() {
  const claudeDir = join(dir, 'claude')
  const desktopDir = join(dir, 'desktop')
  const discovery = createDiscovery({ projectsDir: join(claudeDir, 'projects'), desktop: createDesktopMeta(desktopDir).read })
  const visitors = createVisitors({ patch: () => {}, accounts: () => [{ id: 'main', label: 'main' }], rules: defaultRules, officeSessions: () => new Set(), describe: (id) => discovery.describe(id, Date.now()), settings: office.db, log: () => {} })
  const add = (cwd: string, ago = hour) => {
    const id = randomUUID()
    writeTranscript(claudeDir, id, [line.user('Fix the bid flow'), line.text('Done.')], { cwd, at: Date.now() - ago })
    writeDesktopChat(desktopDir, 'Claude', { cliSessionId: id, title: `Visitor ${id.slice(0, 4)}`, cwd, lastActivityAt: Date.now() - ago })
    visitors.sync(discovery.scan(Date.now(), new Set()))
    return id
  }
  return { visitors, add }
}

const finished = (id: string) => office.chat(id).archived

describe('the Done decision table', () => {
  it('removes a safe worktree, asks before keeping an unsafe one, refuses busy visitors and offers to stop busy office chats', () => {
    const safe = { name: 'bid-flow' }
    const dirty = { name: 'bid-flow', blocked: '2 uncommitted changes' }
    const ahead = { name: 'bid-flow', blocked: '1 unpushed commit, and the PR state is unknown' }
    expect(finishSteps({ state: 'done' }, safe)).toEqual({ remove: true })
    expect(finishSteps({ state: 'idle' })).toEqual({})
    expect(finishSteps({ state: 'done' }, dirty)).toEqual({ keep: 'Uncommitted changes in bid-flow: archive only and keep the worktree?' })
    expect(finishSteps({ state: 'stuck' }, ahead)).toEqual({ keep: 'Can’t remove bid-flow (1 unpushed commit, and the PR state is unknown): archive only and keep the worktree?' })
    expect(finishSteps({ state: 'idle', visitor: 'desktop' }, safe)).toEqual({ remove: true })
    expect(finishSteps({ state: 'working', visitor: 'desktop' }, safe)).toEqual({ refuse: 'It’s working in the desktop app. Finish it there first.' })
    expect(finishSteps({ state: 'needs-you', visitor: 'terminal' })).toEqual({ refuse: 'It’s waiting for you in a terminal. Finish it there first.' })
    expect(finishSteps({ state: 'working' }, safe)).toEqual({ stop: true, remove: true })
    expect(finishSteps({ state: 'needs-you' }, dirty)).toEqual({ stop: true, keep: 'Uncommitted changes in bid-flow: archive only and keep the worktree?' })
  })
})

describe('finishing an office chat', () => {
  it('stops it, archives it and removes a clean worktree without asking', async () => {
    const tree = worktree('clean')
    const id = office.start('Office work', 'main', tree)
    office.finish(id)
    const { house } = openHousekeeping(office)
    const ask = vi.fn(async () => true)

    expect(await house.finish(id, ask)).toEqual({ removed: tree })
    expect(ask).not.toHaveBeenCalled()
    expect(finished(id)).toBe(true)
    expect(existsSync(tree)).toBe(false)
  })

  it('asks before archiving only when the worktree has uncommitted changes, and changes nothing on no', async () => {
    const tree = worktree('dirty', true)
    const id = office.start('Office work', 'main', tree)
    office.finish(id)
    const { house } = openHousekeeping(office)
    const ask = vi.fn(async () => false)

    expect(await house.finish(id, ask)).toBeUndefined()
    expect(ask).toHaveBeenCalledWith('Uncommitted changes in dirty: archive only and keep the worktree?', expect.any(String), 'Archive only')
    expect(finished(id)).toBe(false)

    ask.mockResolvedValue(true)
    expect(await house.finish(id, ask)).toEqual({ kept: tree })
    expect(finished(id)).toBe(true)
    expect(existsSync(tree)).toBe(true)
  })

  it('offers Stop and finish for a working chat, and stops it before archiving', async () => {
    const tree = worktree('busy')
    const id = office.start('Office work', 'main', tree)
    office.engine.init(id)
    expect(office.chat(id).state).toMatch(/starting|working/)
    const { house } = openHousekeeping(office)
    const ask = vi.fn(async () => false)

    expect(await house.finish(id, ask)).toBeUndefined()
    expect(ask).toHaveBeenCalledWith('Stop and finish this chat?', expect.any(String), 'Stop and finish')
    expect(finished(id)).toBe(false)
    expect(office.engine.running(id)).toBe(true)

    ask.mockResolvedValue(true)
    expect(await house.finish(id, ask)).toEqual({ removed: tree })
    expect(office.engine.running(id)).toBe(false)
    expect(office.chat(id)).toMatchObject({ archived: true, state: 'stuck' })
  })
})

describe('finishing a visitor', () => {
  it('archives it and removes its clean worktree', async () => {
    const tree = worktree('visiting')
    const { visitors, add } = openVisitors()
    const id = add(tree)
    const { house } = openHousekeeping(office, {}, visitors)

    expect(await house.finish(id, async () => false)).toEqual({ removed: tree })
    expect(visitors.has(id)).toBe(false)
    expect(existsSync(tree)).toBe(false)
  })

  it('refuses while it works outside, and keeps a recently active visitor’s worktree only after asking', async () => {
    const busyTree = worktree('outside-busy')
    const recentTree = worktree('outside-recent')
    const { visitors, add } = openVisitors()
    const busy = add(busyTree)
    const recent = add(recentTree, 60_000)
    visitors.hook({ session_id: busy, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'pnpm test' } })
    const { house } = openHousekeeping(office, {}, visitors)
    const ask = vi.fn(async () => true)

    expect(await house.finish(busy, ask)).toEqual({ error: 'It’s working in the desktop app. Finish it there first.' })
    expect(ask).not.toHaveBeenCalled()
    expect(visitors.has(busy)).toBe(true)

    expect(await house.finish(recent, ask)).toEqual({ kept: recentTree })
    expect(ask).toHaveBeenCalledWith('Can’t remove outside-recent (the chat had activity in the last 10 minutes): archive only and keep the worktree?', expect.any(String), 'Archive only')
    expect(visitors.has(recent)).toBe(false)
    expect(existsSync(recentTree)).toBe(true)
  })
})

describe('Clear all done', () => {
  it('previews what it will do in one confirmation, then finishes the safe and kept chats and skips busy ones', async () => {
    const clean = worktree('clear-clean')
    const dirty = worktree('clear-dirty', true)
    const ids = [office.start('Clean', 'main', clean), office.start('Dirty', 'main', dirty)]
    ids.forEach(office.finish)
    const busy = office.start('Busy')
    const { house } = openHousekeeping(office)
    const ask = vi.fn(async () => true)

    const result = await house.finishMany([...ids, busy, 'nope'], ask)

    expect(ask).toHaveBeenCalledTimes(1)
    const [message, detail] = ask.mock.calls[0]! as unknown as [string, string]
    expect(message).toBe('Clear 2 chats?')
    expect(detail.split('\n')).toEqual([
      'Archive 2 chats.',
      'Remove 1 worktree: clear-clean.',
      'Keep Uncommitted changes in clear-dirty.',
      'Skip Busy: it’s still working.',
      'Skip a chat: That chat isn’t in the office any more.',
    ])
    expect(result).toEqual({ finished: ids, skipped: [{ chatId: busy, reason: 'it’s still working' }, { chatId: 'nope', reason: 'That chat isn’t in the office any more.' }], removed: 1 })
    expect(ids.every(finished)).toBe(true)
    expect(finished(busy)).toBe(false)
    expect(existsSync(clean)).toBe(false)
    expect(existsSync(dirty)).toBe(true)
  })
})

describe('Done IPC', () => {
  it('refuses unknown ids and untrusted senders, and looks paths up itself', async () => {
    const cwd = join(dir, 'app')
    mkdirSync(cwd)
    const { house } = openHousekeeping(office)
    const appUrl = 'app://office/index.html'
    const win = { webContents: { send: () => {} }, isDestroyed: () => false } as unknown as BrowserWindow
    const confirm = vi.fn(async () => true)
    wireHousekeeping(win, appUrl, house, confirm)
    const trusted = { sender: win.webContents, senderFrame: { url: appUrl } }
    const invoke = (name: string, ...args: unknown[]) => handlers.get(name)!(trusted, ...args)

    for (const bad of [randomUUID(), cwd, repo, undefined, 42, { id: 'x' }]) expect(await invoke('finishChat', bad)).toEqual({ error: 'That chat isn’t in the office any more.' })
    expect(await invoke('finishChats', 'not-a-list')).toEqual({ finished: [], skipped: [], removed: 0 })
    expect(await invoke('finishChats', [randomUUID(), 7])).toMatchObject({ finished: [], removed: 0 })
    expect(confirm).not.toHaveBeenCalled()
    const id = office.start('Office work', 'main', cwd)
    office.finish(id)
    expect(() => handlers.get('finishChat')!({ sender: {}, senderFrame: { url: appUrl } }, id)).toThrow(/refused/)
    expect(() => handlers.get('finishChats')!({ sender: win.webContents, senderFrame: { url: 'https://evil.example' } }, [id])).toThrow(/refused/)
    expect(finished(id)).toBe(false)
    expect(await invoke('finishChat', id)).toEqual({})
    expect(finished(id)).toBe(true)
  })
})
