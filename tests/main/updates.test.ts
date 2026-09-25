import { describe, expect, it } from 'vitest'
import type { AppUpdate } from '../../src/shared/ipc'
import { createUpdater, type Git, type Launch } from '../../src/main/updates'

function setup({ commit = 'abc1234', repo = '/repo', log = ['Fix the inbox', 'Add a meter'], behind = 2 } = {}) {
  const calls: string[][] = []
  const seen: AppUpdate[] = []
  let exit: (code: number | null) => void = () => {}
  let launched = 0
  let clock = 0
  const git: Git = async (args) => {
    calls.push(args)
    if (args[0] === 'rev-list') return `${behind}\n`
    if (args[0] === 'log') return `${log.join('\n')}\n`
    return ''
  }
  const launch: Launch = (_repo, onExit) => {
    launched++
    exit = onExit
  }
  const updater = createUpdater({ commit, repo, git, launch, changed: (update) => seen.push(update), now: () => clock })
  return { updater, calls, seen, exit: (code: number | null) => exit(code), launched: () => launched, tick: (ms: number) => (clock += ms) }
}

describe('app updates', () => {
  it('counts the commits on origin/main since the installed build and lists their titles', async () => {
    const { updater, calls } = setup()
    await updater.check()
    expect(calls[0]).toEqual(['fetch', '--quiet', 'origin', 'main'])
    expect(calls[1]).toEqual(['rev-list', '--count', 'abc1234..origin/main'])
    expect(updater.state()).toEqual({ behind: 2, subjects: ['Fix the inbox', 'Add a meter'], installing: false })
  })

  it('does nothing for a dev build that has no commit baked in', async () => {
    const { updater, calls } = setup({ commit: '' })
    await updater.check()
    expect(calls).toEqual([])
    expect(updater.state().behind).toBe(0)
  })

  it('rechecks on focus at most every five minutes', async () => {
    const { updater, calls, tick } = setup()
    tick(10 * 60_000)
    await updater.check()
    const fetches = () => calls.filter((args) => args[0] === 'fetch').length
    updater.focused()
    tick(4 * 60_000)
    updater.focused()
    expect(fetches()).toBe(1)
    tick(60_000)
    updater.focused()
    await Promise.resolve()
    expect(fetches()).toBe(2)
  })

  it('launches the installer once, and reports where to look when it fails', async () => {
    const { updater, launched, exit, seen } = setup()
    updater.install()
    updater.install()
    expect(launched()).toBe(1)
    expect(updater.state().installing).toBe(true)
    exit(1)
    expect(updater.state()).toMatchObject({ installing: false, error: expect.stringContaining('install-app.log') })
    expect(seen.at(-1)).toEqual(updater.state())
    updater.install()
    expect(launched()).toBe(2)
  })
})
