import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppUpdate } from '../../src/shared/ipc'
import type { Reopen } from '../../src/main/lifecycle'
import { createUpdater, type Git, type InstallStep, type Launch } from '../../src/main/updates'

function setup({ commit = 'abc1234', previous = undefined as string | undefined, behind = 2, working = false, auto = false } = {}) {
  const calls: string[][] = []
  const steps: InstallStep[] = []
  const reopens: (Reopen | undefined)[] = []
  const exits: ((code: number | null) => void)[] = []
  const seen: AppUpdate[] = []
  const agents = { working }
  const main = { behind }
  let clock = 0
  const git: Git = async (args) => {
    calls.push(args)
    if (args[0] === 'rev-list') return `${main.behind}\n`
    if (args[0] === 'log') return 'Fix the inbox\nAdd a meter\n'
    return ''
  }
  const launch: Launch = (_repo, step, onExit, reopen) => {
    steps.push(step)
    reopens.push(reopen)
    exits.push(onExit)
  }
  const updater = createUpdater({ commit, previous, repo: '/repo', git, launch, busy: async () => agents.working, auto, reopen: () => 'background', changed: (update) => seen.push(update), now: () => clock })
  const finish = async (code = 0) => {
    exits.at(-1)!(code)
    await vi.waitFor(() => Promise.resolve())
  }
  const ready = async () => {
    await updater.check()
    await finish()
    await vi.waitFor(() => expect(updater.state().stage).toBe('ready'))
  }
  return { updater, calls, steps, reopens, seen, agents, main, finish, ready, tick: (ms: number) => (clock += ms) }
}

afterEach(() => vi.useRealTimers())

describe('app updates', () => {
  it('counts the commits on origin/main since the installed build and lists their titles', async () => {
    const { updater, calls } = setup()
    await updater.check()
    expect(calls.slice(0, 2)).toEqual([
      ['fetch', '--quiet', 'origin', 'main'],
      ['rev-list', '--count', 'abc1234..origin/main'],
    ])
    expect(updater.state()).toMatchObject({ behind: 2, subjects: ['Fix the inbox', 'Add a meter'] })
  })

  it('does nothing for a dev build that has no commit baked in', async () => {
    const { updater, calls, steps } = setup({ commit: '' })
    await updater.check()
    expect(calls).toEqual([])
    expect(steps).toEqual([])
  })

  it('builds on its own, then waits for a click before it restarts', async () => {
    vi.useFakeTimers()
    const { updater, steps, ready } = setup()
    await ready()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(steps).toEqual(['build'])
    expect(updater.state()).toMatchObject({ stage: 'ready', auto: false })
    expect(updater.state().restart).toBeUndefined()
  })

  it('restarts at once on a click when no agent is working, reopening the way the window was', async () => {
    const { updater, steps, reopens, ready } = setup()
    await ready()
    await updater.install()
    await vi.waitFor(() => expect(steps).toEqual(['build', 'swap']))
    expect(reopens.at(-1)).toBe('background')
    expect(updater.state().stage).toBe('installing')
  })

  it('reports busy agents on a click instead of interrupting them, then does what the second click says', async () => {
    vi.useFakeTimers()
    const later = setup({ working: true })
    await later.ready()
    expect(await later.updater.install()).toBe('busy')
    expect(later.steps).toEqual(['build'])
    await later.updater.install('whenIdle')
    expect(later.updater.state().restart).toBe('asked')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(later.steps).toEqual(['build'])

    const now = setup({ working: true })
    await now.ready()
    await now.updater.install('now')
    await vi.waitFor(() => expect(now.steps).toEqual(['build', 'swap']))
  })

  it('with Update automatically on, restarts ten seconds after the last agent finishes', async () => {
    vi.useFakeTimers()
    const { updater, steps, agents, ready } = setup({ working: true, auto: true })
    await ready()
    expect(updater.state().restart).toBe('auto')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(steps).toEqual(['build'])
    agents.working = false
    await vi.advanceTimersByTimeAsync(20_000)
    expect(updater.state().restartAt).toBeDefined()
    expect(steps).toEqual(['build'])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(steps).toEqual(['build', 'swap'])
  })

  it('goes back to waiting when an agent starts during the heads-up', async () => {
    vi.useFakeTimers()
    const { updater, steps, agents, ready } = setup({ auto: true })
    await ready()
    await vi.waitFor(() => expect(updater.state().restartAt).toBeDefined())
    agents.working = true
    await vi.advanceTimersByTimeAsync(10_000)
    expect(updater.state()).toMatchObject({ stage: 'ready', restart: 'auto', restartAt: undefined })
    agents.working = false
    await vi.advanceTimersByTimeAsync(30_000)
    expect(steps).toEqual(['build', 'swap'])
  })

  it('stops an automatic restart on Not now, and tries again once main moves on', async () => {
    vi.useFakeTimers()
    const { updater, steps, main, ready } = setup({ auto: true })
    await ready()
    await vi.waitFor(() => expect(updater.state().restartAt).toBeDefined())
    updater.cancel()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(steps).toEqual(['build'])
    expect(updater.state()).toMatchObject({ stage: 'ready', restart: undefined, restartAt: undefined })
    await updater.check()
    expect(updater.state().restart).toBeUndefined()
    main.behind = 3
    await updater.check()
    expect(updater.state().restart).toBe('auto')
  })

  it('follows the setting when it changes while an update waits', async () => {
    vi.useFakeTimers()
    const { updater, ready } = setup({ working: true })
    await ready()
    updater.setAuto(true)
    expect(updater.state()).toMatchObject({ auto: true, restart: 'auto' })
    updater.setAuto(false)
    expect(updater.state()).toMatchObject({ auto: false, restart: undefined })
  })

  it('rebuilds once before restarting when main moved since the build, so the new app is current', async () => {
    const { updater, steps, main, finish, ready } = setup()
    await ready()
    main.behind = 3
    await updater.install()
    await vi.waitFor(() => expect(steps).toEqual(['build', 'build']))
    expect(updater.state().restart).toBe('now')
    main.behind = 4
    await finish()
    await vi.waitFor(() => expect(steps).toEqual(['build', 'build', 'swap']))
  })

  it('reports a failed build, and only retries on its own once main moves again', async () => {
    const { updater, steps, finish } = setup()
    await updater.check()
    await finish(1)
    expect(updater.state()).toMatchObject({ stage: undefined, error: expect.stringContaining('install-app.log') })
    await updater.check()
    expect(steps).toEqual(['build'])
    await updater.install()
    expect(steps).toEqual(['build', 'build'])
  })

  it('clears Installing when the swap ends and this window is still open', async () => {
    const { updater, finish, ready } = setup()
    await ready()
    await updater.install()
    await vi.waitFor(() => expect(updater.state().stage).toBe('installing'))
    await finish()
    expect(updater.state()).toMatchObject({ stage: undefined, restart: undefined, error: expect.stringContaining('install-app.log') })
  })

  it('tells what the update brought when this launch runs a newer build than the last one', async () => {
    const { updater, calls } = setup({ previous: 'fff0000' })
    updater.start()
    await vi.waitFor(() => expect(updater.state().updated).toEqual({ commit: 'abc1234', count: 2, subjects: ['Fix the inbox', 'Add a meter'] }))
    expect(calls).toContainEqual(['rev-list', '--count', 'fff0000..abc1234'])
    updater.stop()
  })

  it('rechecks on focus at most every five minutes', async () => {
    const { updater, calls, tick } = setup({ behind: 0 })
    tick(10 * 60_000)
    await updater.check()
    const fetches = () => calls.filter((args) => args[0] === 'fetch').length
    updater.focused()
    tick(4 * 60_000)
    updater.focused()
    expect(fetches()).toBe(1)
    tick(60_000)
    updater.focused()
    await vi.waitFor(() => expect(fetches()).toBe(2))
  })
})
