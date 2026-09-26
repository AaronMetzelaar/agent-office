import type { AppUpdate } from '../shared/ipc'

export const latestRelease = 'https://api.github.com/repos/AaronMetzelaar/agent-office/releases/latest'
const checkEvery = 6 * 60 * 60_000
const focusGap = 30 * 60_000

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

const parts = (version: string) => version.replace(/^v/, '').split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0)

export function newer(candidate: string, current: string): boolean {
  const [a, b] = [parts(candidate), parts(current)]
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

export function createReleaseCheck({ version, changed, open, fetch = globalThis.fetch, now = Date.now }: { version: string; changed: (update: AppUpdate) => void; open: (url: string) => void; fetch?: Fetch; now?: () => number }) {
  let state: AppUpdate = { behind: 0, subjects: [] }
  let checkedAt = 0
  let timer: NodeJS.Timeout | undefined

  async function check() {
    checkedAt = now()
    try {
      const response = await fetch(latestRelease, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000) })
      if (!response.ok) return
      const release = (await response.json()) as { tag_name?: string; name?: string; html_url?: string }
      if (!release.tag_name || !release.html_url || !newer(release.tag_name, version)) return
      state = { behind: 1, subjects: [release.name || `Agent Office ${release.tag_name.replace(/^v/, '')}`], download: release.html_url }
      changed(state)
    } catch {}
  }

  return {
    state: () => state,
    check,
    start() {
      void check()
      timer = setInterval(() => void check(), checkEvery)
      timer.unref?.()
    },
    focused() {
      if (now() - checkedAt > focusGap) void check()
    },
    install() {
      if (state.download) open(state.download)
    },
  }
}
