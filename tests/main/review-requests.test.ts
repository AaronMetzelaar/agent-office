import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Run } from '../../src/main/review/git'
import { createReviewQueue, localClone, reviewDept, searchArgs } from '../../src/main/workflow/review-requests'
import { defaultRules } from '../../src/shared/departments'
import { overdue, workingMs } from '../../src/shared/workflow'
import { createFakeEngine } from '../fakes/fake-engine'
import { ghMissing, openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

const hour = 3_600_000
const search = [
  { id: 'PR_7', number: 7, title: 'Round bids to the nearest euro', url: 'https://github.com/mws/monorepo/pull/7', isDraft: false, createdAt: '2026-09-01T09:00:00Z', repository: { name: 'monorepo', nameWithOwner: 'mws/monorepo' }, author: { login: 'jan' } },
  { id: 'PR_9', number: 9, title: 'Deep links for push', url: 'https://github.com/mws/mobile/pull/9', isDraft: true, createdAt: '2026-09-20T09:00:00Z', repository: { name: 'mobile', nameWithOwner: 'mws/mobile' }, author: { login: 'eva' } },
]
const nodes = [
  {
    id: 'PR_7',
    additions: 120,
    deletions: 14,
    files: { nodes: [{ path: 'frontend/marketplace/pages/bid.vue' }, { path: 'frontend/marketplace/utils/round.ts' }, { path: 'backend/bids.ts' }] },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
    timelineItems: {
      nodes: [
        { createdAt: '2026-09-02T10:00:00Z', requestedReviewer: { login: 'aaron' } },
        { createdAt: '2026-09-03T10:00:00Z', requestedReviewer: { login: 'someone' } },
        { createdAt: '2026-09-22T08:00:00Z', requestedReviewer: { login: 'aaron' } },
      ],
    },
  },
  { id: 'PR_9', additions: 3, deletions: 0, files: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] }, timelineItems: { nodes: [{ createdAt: '2026-09-21T08:00:00Z', requestedReviewer: {} }] } },
]

function fakeGh() {
  const state = { search: search as unknown[], nodes: nodes as unknown[], details: true, calls: [] as string[][] }
  const gh: Run = async (command, args) => {
    state.calls.push([command, ...args])
    if (args[0] === 'search') return JSON.stringify(state.search)
    if (!state.details) throw new Error('graphql failed')
    return JSON.stringify({ data: { viewer: { login: 'aaron' }, nodes: state.nodes } })
  }
  return { gh, state }
}

describe('review requests', () => {
  it('lists repo, title, author, request time, size and CI through gh with argument arrays', async () => {
    const { gh, state } = fakeGh()
    const changes: number[] = []
    const queue = createReviewQueue(gh, (view) => changes.push(view.requests.length))
    await queue.poll()

    expect(queue.view()).toEqual({
      requests: [
        { url: search[0]!.url, repo: 'mws/monorepo', number: 7, title: 'Round bids to the nearest euro', author: 'jan', requestedAt: Date.parse('2026-09-22T08:00:00Z'), draft: false, additions: 120, deletions: 14, ci: 'fail' },
        { url: search[1]!.url, repo: 'mws/mobile', number: 9, title: 'Deep links for push', author: 'eva', requestedAt: Date.parse('2026-09-21T08:00:00Z'), draft: true, additions: 3, deletions: 0, ci: 'none' },
      ],
    })
    expect(changes).toEqual([2])
    expect(state.calls[0]).toEqual(['gh', ...searchArgs])
    expect(searchArgs).toEqual(expect.arrayContaining(['--review-requested=@me', '--state=open']))
    expect(state.calls[1]!.slice(0, 3)).toEqual(['gh', 'api', 'graphql'])
    expect(state.calls[1]).toEqual(expect.arrayContaining(['-f', 'ids[]=PR_7', '-f', 'ids[]=PR_9']))
    expect(queue.find(search[0]!.url)?.files).toHaveLength(3)
  })

  it('drops a request once gh stops listing it', async () => {
    const { gh, state } = fakeGh()
    const queue = createReviewQueue(gh)
    await queue.poll()
    state.search = [search[1]!]
    await queue.poll()
    expect(queue.view().requests.map((request) => request.number)).toEqual([9])
    expect(queue.find(search[0]!.url)).toBeUndefined()
  })

  it('keeps the list without size and CI when the detail query fails, and uses the PR’s age', async () => {
    const { gh, state } = fakeGh()
    state.details = false
    const queue = createReviewQueue(gh)
    await queue.poll()
    expect(queue.view().requests[0]).toEqual({ url: search[0]!.url, repo: 'mws/monorepo', number: 7, title: 'Round bids to the nearest euro', author: 'jan', requestedAt: Date.parse(search[0]!.createdAt), draft: false })
  })

  it('shows a quiet notice when gh is unavailable and keeps the last list', async () => {
    const missing = createReviewQueue(ghMissing)
    await missing.poll()
    expect(missing.view()).toEqual({ requests: [], notice: 'The GitHub CLI (gh) isn’t installed, so review requests are hidden.' })

    const { gh } = fakeGh()
    let offline = false
    const flaky: Run = (command, args, cwd) => (offline ? Promise.reject(Object.assign(new Error('Command failed'), { stderr: 'error connecting to api.github.com' })) : gh(command, args, cwd))
    const queue = createReviewQueue(flaky)
    await queue.poll()
    offline = true
    await queue.poll()
    expect(queue.view().requests).toHaveLength(2)
    expect(queue.view().notice).toBe('Couldn’t reach GitHub, so review requests may be out of date.')
  })

  it('polls again on focus only when the last poll is a minute old', async () => {
    const { gh, state } = fakeGh()
    let now = 0
    const queue = createReviewQueue(gh, () => {}, () => now)
    await queue.poll()
    now = 30_000
    queue.focus()
    await queue.poll()
    const polls = () => state.calls.filter((call) => call[1] === 'search').length
    expect(polls()).toBe(2)
    now = 200_000
    queue.focus()
    await vi.waitFor(() => expect(polls()).toBe(3))
  })

  it('turns a request amber after 2 working days, not counting the weekend', () => {
    const friday = new Date(2026, 8, 18, 10).getTime()
    const monday = new Date(2026, 8, 21, 11).getTime()
    expect(workingMs(friday, monday)).toBe(25 * hour)
    expect(overdue({ requestedAt: friday }, monday)).toBe(false)
    expect(overdue({ requestedAt: friday }, monday + 24 * hour)).toBe(true)
    expect(overdue({ requestedAt: monday }, monday + 47 * hour)).toBe(false)
  })

  it('puts the review in the department most of its files belong to', () => {
    const repo = '/Users/aaron/Documents/GitHub/monorepo'
    expect(reviewDept(repo, ['frontend/marketplace/a.vue', 'frontend/marketplace/b.ts', 'backend/c.ts'], defaultRules)).toBe('mkt')
    expect(reviewDept(repo, ['backend/c.ts'], defaultRules)).toBe('plat')
    expect(reviewDept('/Users/aaron/code/agent-office', ['src/main/index.ts'], defaultRules)).toBe('side')
    expect(reviewDept(repo, [], defaultRules)).toBe('plat')
  })
})

describe('starting a review', () => {
  let dir: string
  let office: ReturnType<typeof openOffice>
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=office@test', '-c', 'user.name=office', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-review-queue-')))
    office = openOffice(dir, createFakeEngine({ auto: true }))
  })

  afterEach(() => {
    office.db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('finds the local clone by its origin, starts the agent on the PR head in a new worktree, and a withdrawn request leaves it running', async () => {
    const origin = join(dir, 'mws', 'monorepo.git')
    mkdirSync(origin, { recursive: true })
    git(origin, 'init', '-q', '--bare', '-b', 'main')
    const repo = join(dir, 'monorepo')
    git(dir, 'clone', '-q', origin, repo)
    writeFileSync(join(repo, 'bid.ts'), 'one\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'init')
    git(repo, 'push', '-q', 'origin', 'main')
    git(repo, 'checkout', '-q', '-b', 'jan-round')
    writeFileSync(join(repo, 'bid.ts'), 'two\n')
    git(repo, 'commit', '-q', '-am', 'round')
    git(repo, 'push', '-q', 'origin', 'HEAD:refs/pull/7/head')
    const head = git(repo, 'rev-parse', 'HEAD').trim()
    git(repo, 'checkout', '-q', 'main')

    const other = join(dir, 'other')
    mkdirSync(other)
    expect(await localClone('MWS/Monorepo', [other, repo])).toBe(repo)
    expect(await localClone('mws/mobile', [other, repo])).toBeUndefined()

    const { gh, state } = fakeGh()
    const queue = createReviewQueue(gh)
    await queue.poll()
    const request = queue.find(search[0]!.url)!
    const started = office.store.start('main', repo, `/pr-review-rundown ${request.url}`, undefined, undefined, { dept: 'mkt', worktree: true, title: `Review #7 ${request.title}` })
    if (!('chatId' in started)) throw new Error(started.error)
    await vi.waitFor(() => expect(office.chat(started.chatId).state).toBe('done'))

    const chat = office.chat(started.chatId)
    const tree = join(repo, '.claude', 'worktrees', 'review-7')
    expect(chat).toMatchObject({ title: 'Review #7 Round bids to the nearest euro', department: 'mkt', worktree: tree, cwd: tree })
    expect(git(tree, 'rev-parse', 'HEAD').trim()).toBe(head)
    expect(office.engine.sent[0]).toEqual({ chatId: started.chatId, text: '/pr-review-rundown https://github.com/mws/monorepo/pull/7' })

    state.search = []
    await queue.poll()
    expect(queue.view().requests).toEqual([])
    expect(office.chat(started.chatId)).toMatchObject({ archived: false, state: 'done' })
    expect(existsSync(tree)).toBe(true)
  })
})
