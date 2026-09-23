import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Run } from '../../src/main/review/git'
import { loadReview } from '../../src/main/review'
import { createRefresher, endedTurn } from '../../src/renderer/panels/review/refresh'
import type { ChatState } from '../../src/shared/chat'
import type { Review } from '../../src/shared/review'
import { sdk } from '../fakes/fake-engine'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

describe('refresh triggers', () => {
  afterEach(() => vi.useRealTimers())

  it('a turn ending is a Stop; starting or moving between mid-turn states is not', () => {
    expect(endedTurn('working', 'done')).toBe(true)
    expect(endedTurn('needs-you', 'stuck')).toBe(true)
    expect(endedTurn('done', 'idle')).toBe(false)
    expect(endedTurn('working', 'needs-you')).toBe(false)
    expect(endedTurn('idle', 'working')).toBe(false)
    expect(endedTurn(undefined, 'done')).toBe(false)
  })

  it('debounces bursts into one load, and a poke during a load queues exactly one more', async () => {
    vi.useFakeTimers()
    let release = () => {}
    const load = vi.fn(() => new Promise<void>((done) => (release = done)))
    const refresher = createRefresher(load, 300)

    refresher.poke()
    refresher.poke()
    await vi.advanceTimersByTimeAsync(299)
    refresher.poke()
    await vi.advanceTimersByTimeAsync(300)
    expect(load).toHaveBeenCalledTimes(1)

    refresher.poke()
    await vi.advanceTimersByTimeAsync(300)
    refresher.poke()
    await vi.advanceTimersByTimeAsync(300)
    expect(load).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(300)
    expect(load).toHaveBeenCalledTimes(2)
    release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('Stop refreshes the review', () => {
  let dir: string
  let repo: string
  let office: ReturnType<typeof openOffice>

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-review-stop-')))
    repo = join(dir, 'repo')
    mkdirSync(repo)
    vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=office@test', '-c', 'user.name=office', ...args], { cwd: repo, stdio: 'ignore' })
    writeFileSync(join(repo, 'BidFlow.vue'), '<template />\n')
    git('init', '-q', '-b', 'main')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    git('checkout', '-q', '-b', 'bid-rounding')
    office = openOffice(dir)
  })

  afterEach(() => {
    office.db.close()
    rmSync(dir, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('a Stop event reloads the diff and the PR state', async () => {
    let hasPr = false
    const gh: Run = async () => {
      if (!hasPr) throw Object.assign(new Error('gh'), { stderr: 'no pull requests found for branch "bid-rounding"' })
      return JSON.stringify({ number: 7, title: 'Round bids', url: 'https://github.com/mws/monorepo/pull/7', state: 'MERGED', statusCheckRollup: [] })
    }
    let review: Review | undefined
    let loaded!: () => void
    const refresher = createRefresher(async () => {
      review = await loadReview(repo, gh)
      loaded()
    }, 10)
    const nextLoad = () => new Promise<void>((done) => (loaded = done))

    const id = office.start('Round bids to the nearest euro', 'main', repo)
    office.engine.init(id)
    let state: ChatState = office.chat(id).state
    office.store.events.on('patch', (patch) => {
      const next = patch.id === id ? patch.fields?.state : undefined
      if (!next) return
      if (endedTurn(state, next)) refresher.poke()
      state = next
    })

    let wait = nextLoad()
    refresher.poke()
    await wait
    expect(review).toMatchObject({ branch: 'bid-rounding', files: [] })
    expect(review!.pr).toBeUndefined()

    writeFileSync(join(repo, 'BidFlow.vue'), '<template />\n<script setup lang="ts" />\n')
    hasPr = true
    wait = nextLoad()
    office.engine.emit(id, sdk.text('Rounded.'))
    office.engine.emit(id, sdk.result())
    expect(office.chat(id).state).toBe('done')
    await wait

    expect(review!.files.map((file) => [file.path, file.added, file.removed])).toEqual([['BidFlow.vue', 1, 0]])
    expect(review!.pr).toMatchObject({ number: 7, state: 'merged' })
  })
})
