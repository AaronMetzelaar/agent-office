import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Run } from '../../src/main/review/git'
import { ciLog, pullRequest } from '../../src/main/review/github'
import { loadReview } from '../../src/main/review'
import { ciState } from '../../src/shared/review'

vi.mock('electron', () => import('../fakes/electron'))

const rawPr = {
  number: 42,
  title: 'Round bids to the nearest euro',
  url: 'https://github.com/mws/monorepo/pull/42',
  state: 'OPEN',
  isDraft: false,
  reviewDecision: 'CHANGES_REQUESTED',
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'unit', workflowName: 'CI', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/mws/monorepo/actions/runs/111/job/222' },
    { __typename: 'CheckRun', name: 'lint', workflowName: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/mws/monorepo/actions/runs/111/job/223' },
    { __typename: 'StatusContext', context: 'vercel', state: 'PENDING', targetUrl: 'https://vercel.com/x' },
  ],
}
const threads = { data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }, { isResolved: false }] } } } } }

const fail = (fields: Record<string, unknown>) => async () => {
  throw Object.assign(new Error('Command failed: gh'), fields)
}

function stub(replies: Record<string, unknown>) {
  const calls: string[][] = []
  const gh: Run = async (command, args) => {
    calls.push([command, ...args])
    const reply = replies[args.slice(0, 2).join(' ')]
    if (reply instanceof Error) throw reply
    return typeof reply === 'string' ? reply : JSON.stringify(reply)
  }
  return { gh, calls }
}

describe('pull request', () => {
  it('reads the PR, its review decision, unresolved threads and checks through gh with argument arrays', async () => {
    const { gh, calls } = stub({ 'pr view': rawPr, 'api graphql': threads })
    const { pr, notice } = await pullRequest('/repo', gh)

    expect(notice).toBeUndefined()
    expect(pr).toMatchObject({ number: 42, title: 'Round bids to the nearest euro', state: 'open', draft: false, review: 'changes-requested', unresolved: 2 })
    expect(pr!.checks).toEqual([
      { name: 'CI / unit', state: 'fail', url: rawPr.statusCheckRollup[0]!.detailsUrl, job: '222' },
      { name: 'CI / lint', state: 'pass', url: rawPr.statusCheckRollup[1]!.detailsUrl, job: '223' },
      { name: 'vercel', state: 'pending', url: 'https://vercel.com/x' },
    ])
    expect(ciState(pr!.checks)).toBe('fail')
    expect(calls[0]).toEqual(['gh', 'pr', 'view', '--json', 'number,title,url,state,isDraft,reviewDecision,statusCheckRollup'])
    expect(calls[1]).toEqual(expect.arrayContaining(['-f', 'owner=mws', '-f', 'repo=monorepo', '-F', 'number=42', '--hostname', 'github.com']))
  })

  it('a merged PR skips the thread lookup, and no checks means CI not run', async () => {
    const { gh, calls } = stub({ 'pr view': { ...rawPr, state: 'MERGED', reviewDecision: '', statusCheckRollup: [] } })
    const { pr } = await pullRequest('/repo', gh)
    expect(pr).toMatchObject({ state: 'merged', checks: [] })
    expect(pr!.review).toBeUndefined()
    expect(ciState(pr!.checks)).toBe('none')
    expect(calls).toHaveLength(1)
  })

  it('no PR for the branch is not an error', async () => {
    expect(await pullRequest('/repo', fail({ stderr: 'no pull requests found for branch "tidy"' }))).toEqual({})
  })

  it('explains a missing gh, a logged-out gh and being offline', async () => {
    expect((await pullRequest('/repo', fail({ code: 'ENOENT' }))).notice).toMatch(/isn’t installed/)
    expect((await pullRequest('/repo', fail({ stderr: 'To get started with GitHub CLI, please run:  gh auth login' }))).notice).toMatch(/isn’t logged in/)
    expect((await pullRequest('/repo', fail({ stderr: 'error connecting to api.github.com' }))).notice).toMatch(/Couldn’t reach GitHub/)
    expect((await pullRequest('/repo', fail({ killed: true, signal: 'SIGTERM' }))).notice).toMatch(/Couldn’t reach GitHub/)
  })
})

describe('gh unavailable', () => {
  let dir: string

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-review-gh-')))
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=office@test', '-c', 'user.name=office', ...args], { cwd: dir, stdio: 'ignore' })
    writeFileSync(join(dir, 'a.ts'), 'one\n')
    git('init', '-q', '-b', 'main')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    git('checkout', '-q', '-b', 'feature')
    writeFileSync(join(dir, 'a.ts'), 'one\ntwo\n')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('shows a notice and a working diff when gh is missing or offline', async () => {
    for (const gh of [fail({ code: 'ENOENT' }), fail({ stderr: 'error connecting to api.github.com' })]) {
      const review = await loadReview(dir, gh)
      expect(review.notice).toBeTruthy()
      expect(review.pr).toBeUndefined()
      expect(review.files.map((file) => [file.path, file.added, file.removed])).toEqual([['a.ts', 1, 0]])
    }
  })
})

describe('CI log', () => {
  it('fetches a failed job’s log on demand and strips the job and timestamp columns', async () => {
    const { gh, calls } = stub({ 'run view': 'unit\tRun tests\t2026-09-24T10:00:00.1234567Z FAIL BidFlow.test.ts\nunit\tRun tests\t2026-09-24T10:00:01.0000000Z Expected 10, got 9\n' })
    expect(await ciLog('/repo', '222', gh)).toEqual({ log: 'FAIL BidFlow.test.ts\nExpected 10, got 9' })
    expect(calls).toEqual([['gh', 'run', 'view', '--job', '222', '--log-failed']])
  })

  it('refuses a check id that isn’t a job number, without running gh', async () => {
    const { gh, calls } = stub({})
    expect(await ciLog('/repo', '--web', gh)).toHaveProperty('error')
    expect(calls).toEqual([])
  })
})
