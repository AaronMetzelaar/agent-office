import { execFile, spawn } from 'node:child_process'
import type { AppUpdate } from '../shared/ipc'

export type Git = (args: string[]) => Promise<string>
export type Launch = (repo: string, onExit: (code: number | null) => void) => void

export const installLog = '~/Library/Logs/agent-office/install-app.log'
const checkEvery = 30 * 60_000
const focusGap = 5 * 60_000
const shownSubjects = 8

export const runGit =
  (repo: string): Git =>
  (args) =>
    new Promise((done, fail) => execFile('git', ['-C', repo, ...args], { timeout: 60_000, encoding: 'utf8' }, (error, stdout) => (error ? fail(error) : done(stdout))))

export const launchInstaller =
  (path: () => Promise<string>): Launch =>
  (repo, onExit) =>
    void path().then((PATH) => {
      const child = spawn('/bin/sh', ['-c', 'git -C "$1" show origin/main:scripts/install-app.sh | sh -s "$1"', 'install-app', repo], { detached: true, stdio: 'ignore', env: { ...process.env, PATH } })
      child.on('exit', onExit)
      child.on('error', () => onExit(null))
      child.unref()
    })

export function createUpdater({ commit, repo, git, launch, changed, now = Date.now }: { commit: string; repo: string; git: Git; launch: Launch; changed: (update: AppUpdate) => void; now?: () => number }) {
  let state: AppUpdate = { behind: 0, subjects: [], installing: false }
  let checkedAt = 0
  let timer: NodeJS.Timeout | undefined
  const set = (next: Partial<AppUpdate>) => {
    state = { ...state, ...next }
    changed(state)
  }

  async function check() {
    if (!commit || !repo || state.installing) return
    checkedAt = now()
    try {
      await git(['fetch', '--quiet', 'origin', 'main'])
      const range = `${commit}..origin/main`
      const behind = Number((await git(['rev-list', '--count', range])).trim()) || 0
      const subjects = behind ? (await git(['log', '--format=%s', `-n${shownSubjects}`, range])).split('\n').filter(Boolean) : []
      set({ behind, subjects, error: undefined })
    } catch {}
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
    stop: () => clearInterval(timer),
    install() {
      if (!repo || state.installing) return
      set({ installing: true, error: undefined })
      launch(repo, (code) => {
        if (code !== 0) set({ installing: false, error: `The update failed. See ${installLog}` })
      })
    },
  }
}
