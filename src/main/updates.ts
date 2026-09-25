import { execFile, spawn } from 'node:child_process'
import type { AppUpdate } from '../shared/ipc'

export type Git = (args: string[]) => Promise<string>
export type InstallStep = 'build' | 'swap'
export type Launch = (repo: string, step: InstallStep, onExit: (code: number | null) => void) => void

export const installLog = '~/Library/Logs/agent-office/install-app.log'
const checkEvery = 30 * 60_000
const focusGap = 5 * 60_000
const idlePoll = 20_000
const shownSubjects = 8

export const runGit =
  (repo: string): Git =>
  (args) =>
    new Promise((done, fail) => execFile('git', ['-C', repo, ...args], { timeout: 60_000, encoding: 'utf8' }, (error, stdout) => (error ? fail(error) : done(stdout))))

export const launchInstaller =
  (path: () => Promise<string>): Launch =>
  (repo, step, onExit) =>
    void path().then((PATH) => {
      const child = spawn('/bin/sh', ['-c', 'git -C "$1" show origin/main:scripts/install-app.sh | sh -s "$1"', 'install-app', repo], { detached: true, stdio: 'ignore', env: { ...process.env, PATH, AGENT_OFFICE_STEP: step } })
      child.on('exit', onExit)
      child.on('error', () => onExit(null))
      child.unref()
    })

interface Options {
  commit: string
  repo: string
  git: Git
  launch: Launch
  busy: () => Promise<boolean>
  confirmInterrupt: () => Promise<boolean>
  changed: (update: AppUpdate) => void
  now?: () => number
}

export function createUpdater({ commit, repo, git, launch, busy, confirmInterrupt, changed, now = Date.now }: Options) {
  let state: AppUpdate = { behind: 0, subjects: [] }
  let checkedAt = 0
  let failedAt: number | undefined
  let interruptOk = false
  let timer: NodeJS.Timeout | undefined
  let idleTimer: NodeJS.Timeout | undefined
  const set = (next: Partial<AppUpdate>) => {
    state = { ...state, ...next }
    changed(state)
  }
  const failed = (step: InstallStep) => {
    failedAt = state.behind
    set({ stage: undefined, error: `The update failed while it ${step === 'build' ? 'built' : 'installed'}. See ${installLog}` })
  }

  function build() {
    set({ stage: 'building', error: undefined })
    launch(repo, 'build', (code) => {
      if (code !== 0) return failed('build')
      set({ stage: 'waiting' })
      void swapWhenIdle()
    })
  }

  async function swapWhenIdle() {
    clearTimeout(idleTimer)
    if (state.stage !== 'waiting') return
    const working = interruptOk ? false : await busy().catch(() => true)
    if (state.stage !== 'waiting') return
    if (working) {
      idleTimer = setTimeout(() => void swapWhenIdle(), idlePoll)
      idleTimer.unref?.()
      return
    }
    set({ stage: 'installing' })
    launch(repo, 'swap', (code) => {
      if (code !== 0) failed('swap')
    })
  }

  async function check() {
    if (!commit || !repo || state.stage === 'building' || state.stage === 'installing') return
    checkedAt = now()
    try {
      await git(['fetch', '--quiet', 'origin', 'main'])
      const range = `${commit}..origin/main`
      const behind = Number((await git(['rev-list', '--count', range])).trim()) || 0
      const subjects = behind ? (await git(['log', '--format=%s', `-n${shownSubjects}`, range])).split('\n').filter(Boolean) : []
      set({ behind, subjects })
    } catch {
      return
    }
    if (state.behind && !state.stage && state.behind !== failedAt) build()
  }

  return {
    state: () => state,
    check,
    focused() {
      if (now() - checkedAt >= focusGap) void check()
    },
    start() {
      void check()
      timer = setInterval(() => void check(), checkEvery)
      timer.unref()
    },
    stop() {
      clearInterval(timer)
      clearTimeout(idleTimer)
    },
    async install() {
      if (!repo || state.stage === 'building' || state.stage === 'installing') return
      if (await busy().catch(() => false)) interruptOk = await confirmInterrupt()
      if (state.stage === 'waiting') return swapWhenIdle()
      if (!state.stage) build()
    },
  }
}
