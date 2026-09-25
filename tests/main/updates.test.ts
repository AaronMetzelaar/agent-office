import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppUpdate } from '../../src/shared/ipc'
import { createUpdater, type Git, type InstallStep, type Launch } from '../../src/main/updates'

function setup({ commit = 'abc1234', behind = 2, working = false, interrupt = false } = {}) {
  const calls: string[][] = []
  const steps: InstallStep[] = []
  const exits: ((code: number | null) => void)[] = []
  const seen: AppUpdate[] = []
  const agents = { working }
  let clock = 0
  const git: Git = async (args) => {
    calls.push(args)
    if (args[0] === 'rev-list') return `${behind}\n`
    if (args[0] === 'log') return 'Fix the inbox\nAdd a meter\n'
    return ''
  }
  const launch: Launch = (_repo, step, onExit) => {
    steps.push(step)
    exits.push(onExit)
  }
  const confirmInterrupt = vi.fn(async () => interrupt)
  const updater = createUpdater({ commit, repo: '/repo', git, launch, busy: async () => agents.working, confirmInterrupt, changed: (update) => seen.push(update), now: () => clock })
  const finish = async (code = 0) => {
    exits.at(-1)!(code)
    await vi.waitFor(() => Promise.resolve())
  }
  return { updater, calls, steps, seen, agents, confirmInterrupt, finish, tick: (ms: number) => (clock += ms) }
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

  it('builds on its own and installs straight away when no agent is working', async () => {
    const { updater, steps, finish } = setup()
    await updater.check()
    expect(updater.state().stage).toBe('building')
    await finish()
    await vi.waitFor(() => expect(steps).toEqual(['build', 'swap']))
    expect(updater.state().stage).toBe('installing')
  })

  it('holds a built update while agents work, and installs once they stop', async () => {
    vi.useFakeTimers()
    const { updater, steps, agents, finish } = setup({ working: true })
    await updater.check()
    await finish()
    expect(updater.state().stage).toBe('waiting')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(steps).toEqual(['build'])
    agents.working = false
    await vi.advanceTimersByTimeAsync(20_000)
    expect(steps).toEqual(['build', 'swap'])
  })

  it('asks before Install now interrupts working agents, and keeps waiting if told to', async () => {
    vi.useFakeTimers()
    const waits = setup({ working: true, interrupt: false })
    await waits.updater.check()
    await waits.finish()
    await waits.updater.install()
    expect(waits.confirmInterrupt).toHaveBeenCalledOnce()
    expect(waits.steps).toEqual(['build'])

    const now = setup({ working: true, interrupt: true })
    await now.updater.check()
    await now.finish()
    await now.updater.install()
    expect(now.steps).toEqual(['build', 'swap'])
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
