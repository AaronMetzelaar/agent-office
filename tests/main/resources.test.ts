import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commandLabel, isClaude, parsePs, parseWorktrees, processTree } from '../../src/main/housekeeping/resources'
import type { Run } from '../../src/main/review/git'
import { day, gb } from '../../src/shared/housekeeping'
import { openHousekeeping, openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let office: ReturnType<typeof openOffice>

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-resources-')))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  office = openOffice(dir)
})

afterEach(() => {
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=office@test', '-c', 'user.name=office', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const desktop = [
  ' 5160 36727    720 /Applications/Claude.app/Contents/Helpers/disclaimer --pgroup -- /Users/a/Library/Application Support/Claude/claude-code/2.1.280/claude.app/Contents/MacOS/claude --output-format stream-json',
  ' 5161  5160 253216 /Users/a/Library/Application Support/Claude/claude-code/2.1.280/claude.app/Contents/MacOS/claude --output-format stream-json --verbose',
  ' 5173  5161   3984 node /Users/a/.claude/mcp-servers/indesign/src/index.js',
  ' 6001  6000 180000 claude',
  '36727     1 534224 /Applications/Claude.app/Contents/MacOS/Claude',
]

describe('process table', () => {
  it('parses ps rows in bytes and walks a process tree', () => {
    const rows = parsePs(desktop.join('\n'))
    expect(rows[1]).toEqual({ pid: 5161, ppid: 5160, bytes: 253216 * 1024, args: expect.stringMatching(/MacOS\/claude --output-format/) })
    expect(processTree(rows, 5160).map((row) => row.pid)).toEqual([5160, 5161, 5173])
    expect(processTree(rows, 1)).toEqual([])
  })

  it('recognises claude sessions, not the wrapper or the desktop app', () => {
    const rows = parsePs(desktop.join('\n'))
    expect(rows.filter((row) => isClaude(row.args)).map((row) => row.pid)).toEqual([5161, 6001])
    expect(commandLabel('node /repo/node_modules/.bin/vite --port 5173')).toBe('node vite --port 5173')
  })

  it('attributes a dev server and its children to the agent that started it', async () => {
    const { house } = openHousekeeping(office)
    const id = office.start('Run the dev server')
    office.finish(id)
    const other = office.start('Something else')
    office.finish(other)
    const session = office.engine.pid(id)!
    office.engine.processes.table.set(session + 2, { ppid: session + 1, kb: 100_000, args: '/repo/node_modules/@esbuild/darwin-arm64/bin/esbuild --service' })
    office.engine.processes.table.set(99_999, { ppid: 1, kb: 900_000, args: 'node unrelated.js' })

    const view = await house.sample()

    const agent = view.agents.find((use) => use.chatId === id)!
    expect(agent.processes.map((proc) => [proc.pid, proc.command])).toEqual([
      [session, 'claude session'],
      [session + 1, 'node vite --port 5173'],
      [session + 2, 'esbuild --service'],
    ])
    expect(agent.bytes).toBe((250_000 + 300_000 + 100_000) * 1024)
    expect(view.bytes).toBe(agent.bytes + (250_000 + 300_000) * 1024)
  })

  it('matches claude processes outside the office to their folder with one batched lsof', async () => {
    const calls: string[][] = []
    const run: Run = async (command, args) => {
      calls.push([command, ...args])
      if (command === 'ps') return desktop.join('\n')
      if (command === 'lsof') return 'p5161\nfcwd\nn/Users/a/Documents/GitHub/monorepo\np6001\nfcwd\nn/Users/a/Documents/GitHub/monorepo\n'
      return ''
    }
    const { house } = openHousekeeping(office, { run })

    const view = await house.sample()
    await house.sample()

    expect(view.outside).toEqual([{ cwd: '/Users/a/Documents/GitHub/monorepo', bytes: (253216 + 3984 + 180000) * 1024, pids: [5161, 6001] }])
    expect(calls.filter(([command]) => command === 'lsof')).toEqual([['lsof', '-a', '-d', 'cwd', '-Fn', '-p', '5161,6001']])
  })

  it('turns the RAM indicator amber when agents use a large share of memory', async () => {
    office.finish(office.start('Big'))
    expect((await openHousekeeping(office, { totalMemory: 8 * 2 ** 30 }).house.sample()).hot).toBe(false)
    expect((await openHousekeeping(office, { totalMemory: 2 ** 30 }).house.sample()).hot).toBe(true)
  })
})

describe('worktrees', () => {
  it('parses git worktree list without the main worktree, bare or missing ones', () => {
    const out = ['worktree /r', 'HEAD a', 'branch refs/heads/main', '', 'worktree /r/.claude/worktrees/one', 'HEAD b', 'branch refs/heads/one', 'locked', '', 'worktree /r/.claude/worktrees/two', 'HEAD c', 'detached', '', 'worktree /r/gone', 'HEAD d', 'prunable gitdir file points to non-existent location', ''].join('\n')
    expect(parseWorktrees(out)).toEqual([
      { path: '/r/.claude/worktrees/one', branch: 'one', locked: true },
      { path: '/r/.claude/worktrees/two', locked: false },
    ])
  })

  it('lists a chat from four days ago as a cleanup candidate, with its RAM once parking stopped its dev server, and its worktree size', async () => {
    const repo = join(dir, 'repo')
    mkdirSync(repo)
    git(repo, 'init', '-q', '-b', 'main')
    writeFileSync(join(repo, 'a.ts'), 'x\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'init')
    const tree = join(repo, '.claude', 'worktrees', 'bid-flow')
    git(repo, 'worktree', 'add', '-q', '-b', 'bid-flow', tree)
    writeFileSync(join(tree, 'big.bin'), Buffer.alloc(2 * 2 ** 20))
    const { house, clock } = openHousekeeping(office)
    const id = office.start('Bid flow', 'main', tree)
    office.finish(id)
    clock.now += 4 * day

    await house.refresh()
    await house.measure()
    const view = house.view()

    expect(view.candidates).toEqual([id])
    expect(view.agents.find((use) => use.chatId === id)).toMatchObject({ bytes: 250_000 * 1024, processes: [{ command: 'claude session' }] })
    expect(office.engine.processes.signals).toEqual([{ pid: office.engine.pid(id)! + 1, signal: 'SIGTERM' }])
    expect(view.worktrees).toMatchObject([{ path: tree, repo, branch: 'bid-flow', chatIds: [id], locked: false }])
    expect(view.worktrees[0]!.bytes).toBeGreaterThanOrEqual(2 * 2 ** 20)
    expect(gb(view.agents[0]!.bytes)).toBe('0.2 GB')
  })
})
