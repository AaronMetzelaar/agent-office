import { EventEmitter } from 'node:events'
import { totalmem } from 'node:os'
import type { BrowserWindow } from 'electron'
import type { ChatState } from '../../shared/chat'
import { hotShare, visitorHold, type AgentMemory, type CleanupSummary, type GitSafety, type HousekeepingView, type OutsideMemory, type Proc, type StopReport } from '../../shared/housekeeping'
import { handle, send } from '../ipc'
import type { Visitors } from '../outside/visitors'
import { repoRoot } from '../permissions/repo-root'
import { run as runCommand, type Run } from '../review/git'
import type { Engine } from '../sessions/manager'
import type { ChatStore } from '../store/chats'
import { gitSafety, isAlive, removeWorktree, stopProcesses, type Signals } from './cleanup'
import { diskBytes, inside, isClaude, listWorktrees, processTable, processTree, toProc, workingDirs, type ProcessRow, type Worktree } from './resources'
import { cleanupCandidates, cleanupNotice, parkStale, readThresholds, toThresholds, type CleanupNotice } from './stale'

export interface System extends Signals {
  run: Run
  gh: Run
  totalMemory: number
  now(): number
}

export interface Settings {
  setting(key: string): unknown
  saveSetting(key: string, value: unknown): void
}

export type Housekeeping = ReturnType<typeof createHousekeeping>

export type VisitorList = Pick<Visitors, 'views' | 'view' | 'archive'>

type Listed = Worktree & { repo: string }

export const realSystem = (): System => ({
  run: runCommand,
  gh: runCommand,
  kill: (pid, signal) => process.kill(pid, signal),
  alive: isAlive,
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  graceMs: 5000,
  totalMemory: totalmem(),
  now: Date.now,
})

const sampleMs = 10_000
const staleMs = 60_000
const sizeTtlMs = 60 * 60_000
const settled = new Set<ChatState>(['idle', 'done', 'stuck'])
const total = (items: readonly { bytes: number }[]) => items.reduce((sum, item) => sum + item.bytes, 0)
const noStop: StopReport = { freedBytes: 0, stopped: 0, stubborn: [] }
const noVisitors: VisitorList = { views: () => [], view: () => undefined, archive: () => false }

export function createHousekeeping(store: Pick<ChatStore, 'views' | 'view' | 'park' | 'archive'>, engine: Pick<Engine, 'pid' | 'stop'>, settings: Settings, system: System, notifyCleanup: (count: number) => void = () => {}, visitors: VisitorList = noVisitors) {
  const events = new EventEmitter<{ view: [HousekeepingView] }>()
  const repos = new Map<string, string>()
  const sizes = new Map<string, { bytes: number; at: number }>()
  const git = new Map<string, GitSafety>()
  const stubborn = new Map<string, Proc[]>()
  const cwds = new Map<number, string>()
  let thresholds = readThresholds(settings.setting('thresholds'))
  let worktrees: Listed[] = []
  let agents: AgentMemory[] = []
  let outside: OutsideMemory[] = []
  let visiting: AgentMemory[] = []
  let claudeDirs: string[] = []
  let sampling: Promise<HousekeepingView> | undefined
  let measuring: Promise<void> | undefined
  let timers: ReturnType<typeof setInterval>[] = []

  const live = () => store.views().filter((chat) => !chat.archived)
  const quiet = () => [...store.views(), ...visitors.views().filter((chat) => !chat.moved)]
  const worktreeOf = (cwd: string) => worktrees.find((tree) => inside(cwd, tree.path))
  const usedOutside = (path: string) => claudeDirs.some((cwd) => inside(cwd, path))
  const heldBy = (path: string) => visitors.views().flatMap((chat) => (inside(chat.cwd, path) ? [visitorHold(chat, system.now())] : [])).find(Boolean)
  const table = () => processTable(system.run).catch((): ProcessRow[] => [])

  function view(): HousekeepingView {
    const now = system.now()
    const candidates = cleanupCandidates(quiet(), thresholds, now)
    const safe = candidates.filter((id) => {
      const tree = worktreeOf((store.view(id) ?? visitors.view(id))?.cwd ?? '')
      return !tree || (git.get(tree.path)?.safe === true && !tree.locked && !usedOutside(tree.path) && !heldBy(tree.path))
    })
    const bytes = total(agents) + total(visiting) + total(outside)
    const chats = [...live(), ...visitors.views()]
    return {
      at: now,
      totalMemory: system.totalMemory,
      bytes,
      hot: bytes >= system.totalMemory * hotShare,
      agents: [...agents, ...visiting],
      outside,
      worktrees: worktrees.map((tree) => ({ ...tree, bytes: sizes.get(tree.path)?.bytes, chatIds: chats.filter((chat) => inside(chat.cwd, tree.path)).map((chat) => chat.id), git: git.get(tree.path) })),
      thresholds,
      candidates,
      safe,
      stubborn: Object.fromEntries(stubborn),
    }
  }

  const publish = () => {
    const current = view()
    events.emit('view', current)
    return current
  }

  async function listAll(): Promise<Listed[]> {
    for (const chat of [...store.views(), ...visitors.views()]) if (chat.cwd && !repos.has(chat.cwd)) repos.set(chat.cwd, repoRoot(chat.cwd))
    const lists = await Promise.all([...new Set(repos.values())].map((repo) => listWorktrees(system.run, repo).then((list) => list.map((tree) => ({ ...tree, repo })), (): Listed[] => [])))
    return lists.flat()
  }

  async function measureOutside(rows: ProcessRow[], office: Set<number>): Promise<void> {
    const claudes = rows.filter((row) => isClaude(row.args) && !office.has(row.pid))
    const pids = new Set(claudes.map((row) => row.pid))
    const tops = claudes.filter((row) => !pids.has(row.ppid))
    const dirs = await workingDirs(system.run, tops.map((row) => row.pid), cwds)
    const ids = visitors.views().map((chat) => chat.id)
    const byCwd = new Map<string, OutsideMemory>()
    visiting = []
    for (const claude of tops) {
      const chatId = claude.args.includes('--fork-session') ? undefined : ids.find((id) => claude.args.includes(id))
      if (chatId) {
        const tree = processTree(rows, claude.pid)
        visiting.push({ chatId, bytes: total(tree), processes: tree.map((row) => toProc(row, row.pid === claude.pid ? 'claude session' : undefined)) })
        continue
      }
      const cwd = dirs.get(claude.pid)
      if (!cwd) continue
      const use = byCwd.get(cwd) ?? { cwd, bytes: 0, pids: [] }
      use.bytes += total(processTree(rows, claude.pid))
      use.pids.push(claude.pid)
      byCwd.set(cwd, use)
    }
    outside = [...byCwd.values()]
    claudeDirs = [...dirs.values()].filter(Boolean)
  }

  async function takeSample(): Promise<HousekeepingView> {
    const rows = await table()
    const office = new Set<number>()
    agents = live().flatMap((chat) => {
      const pid = engine.pid(chat.id)
      const tree = pid ? processTree(rows, pid) : []
      tree.forEach((row) => office.add(row.pid))
      return tree.length ? [{ chatId: chat.id, bytes: total(tree), processes: tree.map((row) => toProc(row, row.pid === pid ? 'claude session' : undefined)) }] : []
    })
    await measureOutside(rows, office)
    const running = new Set(rows.map((row) => row.pid))
    for (const [chatId, procs] of stubborn) {
      const left = procs.filter((proc) => running.has(proc.pid))
      if (left.length) stubborn.set(chatId, left)
      else stubborn.delete(chatId)
    }
    worktrees = await listAll()
    return publish()
  }

  const sample = () => (sampling ??= takeSample().finally(() => (sampling = undefined)))

  async function stopTree(chatId: string, withSession: boolean): Promise<StopReport> {
    const pid = engine.pid(chatId)
    const [session, ...children] = pid ? processTree(await table(), pid) : []
    const stopping = stopProcesses(children.map((row) => toProc(row)), system)
    if (withSession) engine.stop(chatId)
    const { stopped, stubborn: left } = await stopping
    if (left.length) {
      stubborn.set(chatId, left)
      console.warn(`[housekeeping] ${left.length} process(es) kept running after SIGTERM: ${left.map((proc) => `${proc.command} (${proc.pid})`).join(', ')}`)
    } else stubborn.delete(chatId)
    const sessionBytes = withSession && session ? session.bytes : 0
    return { freedBytes: sessionBytes + total(stopped), stopped: stopped.length + (sessionBytes ? 1 : 0), stubborn: left }
  }

  async function tick(): Promise<void> {
    const now = system.now()
    const parked = parkStale(store.views(), thresholds, now, store.park)
    const notice = cleanupNotice(cleanupCandidates(quiet(), thresholds, now), settings.setting('cleanupNotice') as CleanupNotice | undefined, now)
    if (notice) {
      settings.saveSetting('cleanupNotice', notice)
      notifyCleanup(notice.ids.length)
    }
    await Promise.all(parked.map((chatId) => stopTree(chatId, false)))
  }

  async function blockedReason(tree: Listed): Promise<string | undefined> {
    if (tree.locked) return 'the worktree is locked'
    if (usedOutside(tree.path)) return 'a claude process outside the office is using it'
    const held = heldBy(tree.path)
    if (held) return held
    const safety = await gitSafety(tree.path, system.gh)
    git.set(tree.path, safety)
    return safety.safe ? undefined : safety.blocked
  }

  async function remove(tree: Listed): Promise<string | undefined> {
    const error = await removeWorktree(system.run, tree.repo, tree.path)
    if (error) return error
    git.delete(tree.path)
    for (const chat of visitors.views()) if (inside(chat.cwd, tree.path)) visitors.archive(chat.id)
    return undefined
  }

  async function removeListed(tree: Listed): Promise<{ error?: string; bytes?: number }> {
    const blocked = await blockedReason(tree)
    if (blocked) return { error: `Can’t remove the worktree: ${blocked}.` }
    const error = await remove(tree)
    if (error) return { error }
    const bytes = sizes.get(tree.path)?.bytes
    sizes.delete(tree.path)
    await sample()
    return bytes === undefined ? {} : { bytes }
  }

  function measure(): Promise<void> {
    return (measuring ??= (async () => {
      for (const tree of worktrees) {
        const known = sizes.get(tree.path)
        if (known && system.now() - known.at < sizeTtlMs) continue
        const bytes = await diskBytes(system.run, tree.path)
        if (bytes === undefined) continue
        sizes.set(tree.path, { bytes, at: system.now() })
        publish()
      }
    })().finally(() => (measuring = undefined)))
  }

  return {
    events,
    view,
    sample,
    tick,
    measure,

    async refresh(): Promise<HousekeepingView> {
      await tick()
      await sample()
      await Promise.all(worktrees.map(async (tree) => git.set(tree.path, await gitSafety(tree.path, system.gh))))
      void measure()
      return publish()
    },

    async stopChat(chatId: unknown): Promise<StopReport> {
      const chat = typeof chatId === 'string' ? store.view(chatId) : undefined
      if (!chat || !settled.has(chat.state)) return noStop
      const report = await stopTree(chat.id, true)
      void sample()
      return report
    },

    async archive(chatId: unknown): Promise<StopReport> {
      const chat = typeof chatId === 'string' ? store.view(chatId) : undefined
      if (!chat || chat.archived || !settled.has(chat.state)) return noStop
      const report = await stopTree(chat.id, true)
      store.archive(chat.id)
      void sample()
      return report
    },

    async cleanUp(chatIds?: unknown): Promise<CleanupSummary> {
      await sample()
      const chosen = Array.isArray(chatIds) ? chatIds.filter((id): id is string => typeof id === 'string') : view().safe
      const summary: CleanupSummary = { chats: 0, visitors: 0, freedBytes: 0, diskBytes: 0, removed: 0, skipped: [], stubborn: [] }
      const skip = (chatId: string, reason: string) => summary.skipped.push({ chatId, reason })
      for (const chatId of chosen) {
        const visitor = visitors.view(chatId)
        const chat = store.view(chatId) ?? visitor
        if (!chat || chat.archived || !settled.has(chat.state)) {
          skip(chatId, 'the chat is busy or already archived')
          continue
        }
        const tree = worktreeOf(chat.cwd)
        const blocked = tree && (await blockedReason(tree))
        if (blocked) {
          skip(chatId, blocked)
          continue
        }
        const report = visitor ? noStop : await stopTree(chatId, true)
        if (visitor) {
          visitors.archive(chatId)
          summary.visitors++
        } else store.archive(chatId)
        summary.chats++
        summary.freedBytes += report.freedBytes
        summary.stubborn.push(...report.stubborn)
        if (!tree) continue
        if (report.stubborn.length) skip(chatId, 'a process didn’t exit, so the worktree was kept')
        else if (live().some((other) => inside(other.cwd, tree.path))) skip(chatId, 'another chat still works in the worktree, so it was kept')
        else {
          const error = await remove(tree)
          if (error) skip(chatId, error)
          else {
            summary.removed++
            summary.diskBytes += sizes.get(tree.path)?.bytes ?? 0
            sizes.delete(tree.path)
          }
        }
      }
      await sample()
      return summary
    },

    async removeWorktree(path: unknown): Promise<{ error?: string; bytes?: number }> {
      await sample()
      const tree = worktrees.find((listed) => listed.path === path)
      if (!tree) return { error: 'That worktree isn’t in the list any more.' }
      if (live().some((chat) => inside(chat.cwd, tree.path))) return { error: 'A chat still works in it. Clean up the chat instead.' }
      return removeListed(tree)
    },

    async removeVisitorWorktree(chatId: unknown): Promise<{ error?: string; bytes?: number }> {
      const visitor = typeof chatId === 'string' ? visitors.view(chatId) : undefined
      if (!visitor) return { error: 'That chat isn’t in the office any more.' }
      await sample()
      const tree = worktreeOf(visitor.cwd)
      if (!tree) return { error: 'This chat doesn’t work in a git worktree.' }
      if (live().some((chat) => inside(chat.cwd, tree.path))) return { error: 'An office chat still works in it. Clean up that chat instead.' }
      return removeListed(tree)
    },

    setThresholds(value: unknown): HousekeepingView {
      const next = toThresholds(value)
      if (next) {
        thresholds = next
        settings.saveSetting('thresholds', next)
        void tick()
      }
      return publish()
    },

    start(): void {
      void tick().then(sample)
      timers = [setInterval(() => void sample(), sampleMs), setInterval(() => void tick(), staleMs)]
    },

    stop(): void {
      timers.forEach(clearInterval)
    },
  }
}

export function wireHousekeeping(win: BrowserWindow, appUrl: string, house: Housekeeping): void {
  handle('getHousekeeping', win, appUrl, async (fresh) => (fresh === true ? house.refresh() : house.view()))
  handle('stopProcesses', win, appUrl, house.stopChat)
  handle('archiveChat', win, appUrl, house.archive)
  handle('cleanUp', win, appUrl, house.cleanUp)
  handle('removeWorktree', win, appUrl, house.removeWorktree)
  handle('removeVisitorWorktree', win, appUrl, house.removeVisitorWorktree)
  handle('setThresholds', win, appUrl, house.setThresholds)
  house.events.on('view', (view) => send(win, 'housekeeping', view))
}
