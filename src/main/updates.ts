import { execFile, spawn } from 'node:child_process'
import type { AppRestart, AppUpdate } from '../shared/ipc'
import type { Reopen } from './lifecycle'

export type Git = (args: string[]) => Promise<string>
export type InstallStep = 'build' | 'swap'
export type Launch = (repo: string, step: InstallStep, onExit: (code: number | null) => void, reopen?: Reopen) => void

export const installLog = '~/Library/Logs/agent-office/install-app.log'
const checkEvery = 30 * 60_000
const focusGap = 5 * 60_000
const idlePoll = 20_000
const headsUp = 10_000
const shownSubjects = 8

export const runGit =
  (repo: string): Git =>
  (args) =>
    new Promise((done, fail) => execFile('git', ['-C', repo, ...args], { timeout: 60_000, encoding: 'utf8' }, (error, stdout) => (error ? fail(error) : done(stdout))))

export const launchInstaller =
  (path: () => Promise<string>): Launch =>
  (repo, step, onExit, reopen = 'front') =>
    void path().then((PATH) => {
      const env = { ...process.env, PATH, AGENT_OFFICE_STEP: step, AGENT_OFFICE_REOPEN: reopen }
      const child = spawn('/bin/sh', ['-c', 'git -C "$1" show origin/main:scripts/install-app.sh | sh -s "$1"', 'install-app', repo], { detached: true, stdio: 'ignore', env })
      child.on('exit', onExit)
      child.on('error', () => onExit(null))
      child.unref()
    })

export interface AppUpdater {
  state(): AppUpdate
  check(): Promise<void>
  start(): void
  focused(): void
  install(when?: 'now' | 'whenIdle'): Promise<'busy' | undefined>
  cancel(): void
  setAuto(on: boolean): void
}

interface Options {
  commit: string
  /** The build that ran before this launch, to tell what the update brought. */
  previous?: string
  repo: string
  git: Git
  launch: Launch
  busy: () => Promise<boolean>
  auto: boolean
  reopen: () => Reopen
  changed: (update: AppUpdate) => void
  now?: () => number
}

export function createUpdater({ commit, previous, repo, git, launch, busy, auto, reopen, changed, now = Date.now }: Options) {
  let state: AppUpdate = { behind: 0, subjects: [], auto }
  let checkedAt = 0
  let failedAt: number | undefined
  let stagedBehind = 0
  let refreshed = false
  let timer: NodeJS.Timeout | undefined
  let idleTimer: NodeJS.Timeout | undefined
  let headsUpTimer: NodeJS.Timeout | undefined
  const set = (next: Partial<AppUpdate>) => {
    state = { ...state, ...next }
    changed(state)
  }
  const failed = (step: InstallStep) => {
    failedAt = state.behind
    set({ stage: undefined, restart: undefined, restartAt: undefined, error: `The update failed while it ${step === 'build' ? 'built' : 'installed'}. See ${installLog}` })
  }
  const stopWaiting = () => {
    clearTimeout(idleTimer)
    clearTimeout(headsUpTimer)
  }
  const request = (restart: AppRestart) => {
    if (state.restart === restart) return
    stopWaiting()
    refreshed = false
    set({ restart, restartAt: undefined })
  }
  const cancel = () => {
    stopWaiting()
    set({ restart: undefined, restartAt: undefined })
  }

  function build() {
    stagedBehind = state.behind
    set({ stage: 'building', error: undefined })
    launch(repo, 'build', (code) => {
      if (code !== 0) return failed('build')
      set({ stage: 'ready' })
      void proceed()
    })
  }

  // Takes a ready update towards the restart someone asked for: at once for 'now', else once no agent works, after a heads-up.
  async function proceed() {
    clearTimeout(idleTimer)
    const restart = state.restart
    const current = () => state.stage === 'ready' && state.restart === restart && state.restartAt === undefined
    if (!restart || !current()) return
    const working = restart !== 'now' && (await busy().catch(() => true))
    if (!current()) return
    if (working) {
      idleTimer = setTimeout(() => void proceed(), idlePoll)
      idleTimer.unref?.()
      return
    }
    if (!refreshed) {
      refreshed = true
      await measure().catch(() => {})
      if (!current()) return
      if (state.behind > stagedBehind) return build()
    }
    if (restart === 'now') return swap()
    set({ restartAt: now() + headsUp })
    headsUpTimer = setTimeout(() => void afterHeadsUp(), headsUp)
    headsUpTimer.unref?.()
  }

  async function afterHeadsUp() {
    if (state.restartAt === undefined) return
    const working = await busy().catch(() => true)
    if (state.restartAt === undefined) return
    if (!working) return swap()
    set({ restartAt: undefined })
    void proceed()
  }

  function swap() {
    set({ stage: 'installing', restartAt: undefined })
    launch(repo, 'swap', () => failed('swap'), reopen())
  }

  async function commits(range: string) {
    const count = Number((await git(['rev-list', '--count', range])).trim()) || 0
    const subjects = count ? (await git(['log', '--format=%s', `-n${shownSubjects}`, range])).split('\n').filter(Boolean) : []
    return { count, subjects }
  }

  async function measure() {
    await git(['fetch', '--quiet', 'origin', 'main'])
    const { count, subjects } = await commits(`${commit}..origin/main`)
    set({ behind: count, subjects })
  }

  async function noteUpdate(from: string) {
    const { count, subjects } = await commits(`${from}..${commit}`)
    if (count) set({ updated: { commit: commit.slice(0, 7), count, subjects } })
  }

  async function check() {
    if (!commit || !repo || state.stage === 'building' || state.stage === 'installing') return
    checkedAt = now()
    try {
      await measure()
    } catch {
      return
    }
    if (state.stage === 'ready' && state.auto && !state.restart && state.behind > stagedBehind) {
      request('auto')
      void proceed()
    }
    if (state.behind && !state.stage && state.behind !== failedAt) {
      if (state.auto) request('auto')
      build()
    }
  }

  return {
    state: () => state,
    check,
    focused() {
      if (now() - checkedAt >= focusGap) void check()
    },
    start() {
      if (commit && previous && previous !== commit) void noteUpdate(previous).catch(() => {})
      void check()
      timer = setInterval(() => void check(), checkEvery)
      timer.unref()
    },
    stop() {
      clearInterval(timer)
      stopWaiting()
    },
    async install(when?: 'now' | 'whenIdle'): Promise<'busy' | undefined> {
      if (!repo || state.stage === 'installing') return
      if (!when && (await busy().catch(() => false))) return 'busy'
      request(when === 'whenIdle' ? 'asked' : 'now')
      if (!state.stage) build()
      else void proceed()
    },
    cancel,
    setAuto(on: boolean) {
      set({ auto: on })
      if (!on && state.restart === 'auto') cancel()
      if (on && state.stage === 'ready' && !state.restart) {
        request('auto')
        void proceed()
      }
    },
  }
}
