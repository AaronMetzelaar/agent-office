import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gitSafety, isAlive, stopProcesses } from '../../src/main/housekeeping/cleanup'
import { run as realRun, type Run } from '../../src/main/review/git'
import { day, summaryText } from '../../src/shared/housekeeping'
import { ghMissing, openHousekeeping, openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let repo: string
let office: ReturnType<typeof openOffice>

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=office@test', '-c', 'user.name=office', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-cleanup-')))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
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

function staleChat(title: string, cwd: string) {
  const id = office.start(title, 'main', cwd)
  office.finish(id)
  return id
}

function recording(): { run: Run; calls: string[][] } {
  const calls: string[][] = []
  const fake = office.engine.processes.run
  return {
    calls,
    run: (command, args, cwd) => {
      calls.push([command, ...args])
      return fake(command, args, cwd)
    },
  }
}

describe('clean up safe', () => {
  it('stops processes, archives the chats, removes three clean worktrees and reports what was freed', async () => {
    const { run, calls } = recording()
    const { house, clock } = openHousekeeping(office, { run })
    const clean = ['bid-flow', 'vat-rounding', 'deep-links'].map((name) => ({ path: worktree(name, name === 'deep-links' ? 'pushed' : undefined), id: '' }))
    for (const tree of clean) tree.id = staleChat(tree.path, tree.path)
    const dirty = staleChat('Dirty', worktree('dirty', 'uncommitted'))
    const ahead = staleChat('Ahead', worktree('ahead', 'unpushed'))
    const sessions = clean.map((tree) => office.engine.pid(tree.id)!)
    clock.now += 4 * day

    const view = await house.refresh()
    await vi.waitFor(() => expect(sessions.every((pid) => !office.engine.processes.alive(pid + 1))).toBe(true))
    for (const pid of sessions) office.engine.processes.table.set(pid + 2, { ppid: pid, kb: 200_000, args: 'docker compose up' })
    expect(view.candidates).toHaveLength(5)
    expect(view.safe.sort()).toEqual(clean.map((tree) => tree.id).sort())
    const blocked = Object.fromEntries(view.worktrees.map((tree) => [tree.path.split('/').pop(), tree.git?.blocked]))
    expect(blocked).toMatchObject({ dirty: '1 uncommitted change', ahead: '1 unpushed commit, and the PR state is unknown' })

    const summary = await house.cleanUp()

    expect(summary).toMatchObject({ chats: 3, removed: 3, skipped: [], stubborn: [] })
    expect(summary.freedBytes).toBe(3 * (250_000 + 200_000) * 1024)
    expect(summaryText(summary)).toMatch(/^Freed 1\.3 GB · removed 3 worktrees/)
    for (const tree of clean) {
      expect(existsSync(tree.path)).toBe(false)
      expect(office.chat(tree.id)).toMatchObject({ archived: true })
      expect(office.engine.running(tree.id)).toBe(false)
    }
    const signalled = (offset: number) => office.engine.processes.signals.filter((sent) => sessions.includes(sent.pid - offset))
    expect(signalled(1)).toEqual(sessions.map((pid) => ({ pid: pid + 1, signal: 'SIGTERM' })))
    expect(signalled(2)).toEqual(sessions.map((pid) => ({ pid: pid + 2, signal: 'SIGTERM' })))
    expect(office.engine.processes.signals.some((sent) => sent.signal === 'SIGKILL')).toBe(false)
    expect(office.chat(dirty).archived).toBe(false)
    expect(office.chat(ahead).archived).toBe(false)
    expect(git(repo, 'branch', '--list', 'bid-flow')).toContain('bid-flow')
    const removals = calls.filter(([command, sub]) => command === 'git' && sub === 'worktree')
    expect(removals.filter((call) => call.includes('remove'))).toHaveLength(3)
    expect(removals.flat().some((arg) => arg === '--force' || arg === '-f')).toBe(false)
    expect(house.view().worktrees.map((tree) => tree.path.split('/').pop()).sort()).toEqual(['ahead', 'dirty'])
  })

  it('blocks uncommitted or unpushed work with the reason, and skips it even when asked directly', async () => {
    const { house, clock } = openHousekeeping(office)
    const dirtyTree = worktree('dirty', 'uncommitted')
    const aheadTree = worktree('ahead', 'unpushed')
    const dirty = staleChat('Dirty', dirtyTree)
    const ahead = staleChat('Ahead', aheadTree)
    clock.now += 4 * day
    await house.refresh()
    const parkedSignals = office.engine.processes.signals.length

    const summary = await house.cleanUp([dirty, ahead])

    expect(summary).toMatchObject({ chats: 0, removed: 0 })
    expect(summary.skipped).toEqual([
      { chatId: dirty, reason: '1 uncommitted change' },
      { chatId: ahead, reason: '1 unpushed commit, and the PR state is unknown' },
    ])
    expect(existsSync(dirtyTree) && existsSync(aheadTree)).toBe(true)
    expect(office.chat(dirty).archived || office.chat(ahead).archived).toBe(false)
    expect(office.engine.processes.signals).toHaveLength(parkedSignals)
    expect(await house.removeWorktree(dirtyTree)).toEqual({ error: 'A chat still works in it. Clean up the chat instead.' })
  })

  it('keeps the worktree and reports a process that won’t exit, without force-killing it', async () => {
    const { house, clock } = openHousekeeping(office)
    const path = worktree('stubborn')
    const id = staleChat('Stubborn', path)
    const vite = office.engine.pid(id)! + 1
    office.engine.processes.ignoresTerm.add(vite)
    clock.now += 4 * day
    await house.refresh()
    await vi.waitFor(() => expect(house.view().stubborn[id]).toHaveLength(1))

    const summary = await house.cleanUp()

    expect(summary).toMatchObject({ chats: 1, removed: 0, stubborn: [{ pid: vite, command: 'node vite --port 5173' }] })
    expect(summary.skipped).toEqual([{ chatId: id, reason: 'a process didn’t exit, so the worktree was kept' }])
    expect(summaryText(summary)).toContain('1 process didn’t stop')
    expect(existsSync(path)).toBe(true)
    expect(office.engine.processes.alive(vite)).toBe(true)
    expect(office.engine.processes.signals.filter((sent) => sent.pid === vite)).toEqual([
      { pid: vite, signal: 'SIGTERM' },
      { pid: vite, signal: 'SIGTERM' },
    ])
    expect(house.view().stubborn[id]).toEqual([{ pid: vite, command: 'node vite --port 5173', bytes: 300_000 * 1024 }])
  })

  it('removes a worktree left behind by an archived chat once it is safe', async () => {
    const { house } = openHousekeeping(office)
    const path = worktree('left-behind')
    const id = staleChat('Left behind', path)
    await house.archive(id)
    await house.refresh()
    expect(await house.removeWorktree(path)).not.toHaveProperty('error')
    expect(existsSync(path)).toBe(false)
    expect(await house.removeWorktree(join(dir, 'elsewhere'))).toEqual({ error: 'That worktree isn’t in the list any more.' })
  })
})

describe('git safety', () => {
  it('counts a clean, fully pushed worktree as safe without asking GitHub', async () => {
    const gh = vi.fn(ghMissing)
    expect(await gitSafety(worktree('pushed', 'pushed'), gh)).toEqual({ label: 'Clean', safe: true })
    expect(gh).not.toHaveBeenCalled()
  })

  it('treats unpushed commits as unsafe when gh is unavailable, and safe once the PR is merged', async () => {
    const path = worktree('squashed', 'unpushed')
    expect(await gitSafety(path, ghMissing)).toEqual({ label: '1 unpushed', safe: false, blocked: '1 unpushed commit, and the PR state is unknown' })
    const noPr: Run = async () => {
      throw Object.assign(new Error('gh failed'), { stderr: 'no pull requests found for branch "squashed"' })
    }
    expect(await gitSafety(path, noPr)).toEqual({ label: '1 unpushed', safe: false, blocked: '1 unpushed commit' })
    const merged: Run = async () => JSON.stringify({ number: 7, title: 'Squash', url: 'https://github.com/a/b/pull/7', state: 'MERGED', statusCheckRollup: [] })
    expect(await gitSafety(path, merged)).toEqual({ label: 'PR merged', safe: true })
  })

  it('counts an unreadable git state as unsafe', async () => {
    expect(await gitSafety(join(dir, 'missing'), realRun)).toMatchObject({ safe: false, blocked: 'its git state couldn’t be read' })
  })
})

describe('stopping processes', () => {
  it('sends SIGTERM, waits the grace period, and reports a process that ignores it instead of killing it', async () => {
    const child = spawn('/bin/sh', ['-c', 'trap "" TERM; echo ready; while :; do sleep 0.05; done'], { stdio: ['ignore', 'pipe', 'ignore'] })
    await new Promise((ready) => child.stdout.once('data', ready))
    const kill = vi.fn((pid: number, signal: NodeJS.Signals) => void process.kill(pid, signal))
    try {
      const target = { pid: child.pid!, command: 'sh', bytes: 1 }
      const result = await stopProcesses([target], { kill, alive: isAlive, sleep: (ms) => new Promise((done) => setTimeout(done, ms)), graceMs: 300 })
      expect(result).toEqual({ stopped: [], stubborn: [target] })
      expect(kill.mock.calls).toEqual([[child.pid, 'SIGTERM']])
      expect(isAlive(child.pid!)).toBe(true)
    } finally {
      child.kill('SIGKILL')
    }
  })

  it('never signals the office itself', async () => {
    const kill = vi.fn()
    await stopProcesses([{ pid: process.pid, command: 'office', bytes: 1 }, { pid: 1, command: 'launchd', bytes: 1 }], { kill, alive: () => false, sleep: async () => {}, graceMs: 10 })
    expect(kill).not.toHaveBeenCalled()
  })
})
