import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Run } from '../../src/main/review/git'
import { createLinear } from '../../src/main/workflow/linear'
import { loadShipIt, nextSteps, noShipCommands, shipNotInstalled } from '../../src/main/workflow/next-step'
import type { ConfigCommands } from '../../src/shared/departments'
import type { CiCheck, PullRequest } from '../../src/shared/review'
import { createFakeEngine } from '../fakes/fake-engine'
import { ghMissing, openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

const mws = ['compact', 'mws-test-cases', 'mws-verify', 'mws-review', 'mws-pr', 'pr-comment-rundown', 'gh-fix-ci']
const aaron: ConfigCommands = { ship: ['/mws-test-cases', '/mws-verify', '/mws-review', '/mws-pr'], fixCi: '/gh-fix-ci', answerComments: '/pr-comment-rundown', review: '/pr-review-rundown' }
const check = (state: CiCheck['state']): CiCheck => ({ name: 'CI / unit', state })
const pr = (fields: Partial<PullRequest> = {}): PullRequest => ({ number: 42, title: 'Round bids', url: 'https://github.com/mws/monorepo/pull/42', state: 'open', draft: false, checks: [], ...fields })
const commands = (state: ReturnType<typeof nextSteps>) => state.steps.map((step) => step.command ?? step.id)

describe('next step', () => {
  it('offers test cases, verify, review and ship for changes without a PR, then waits on CI once the PR exists', () => {
    const before = nextSteps({ uncommitted: 2, unpushed: 0 }, mws, false, aaron)
    expect(before.steps.map((step) => step.label)).toEqual(['Test cases', 'Verify', 'Code review', 'Ship'])
    expect(commands(before)).toEqual(['/mws-test-cases', '/mws-verify', '/mws-review', '/mws-pr'])
    expect(commands(nextSteps({ uncommitted: 0, unpushed: 3 }, mws, false, aaron))).toHaveLength(4)

    const after = nextSteps({ uncommitted: 0, unpushed: 0, pr: pr({ checks: [check('pending'), check('pass')] }) }, mws, false, aaron)
    expect(after).toEqual({ steps: [], waiting: 'Waiting on CI' })
    expect(nextSteps({ uncommitted: 0, unpushed: 0, pr: pr({ checks: [check('pass')] }) }, mws, false, aaron)).toEqual({ steps: [], waiting: 'Waiting on review' })
  })

  it('offers Answer comments for unresolved threads and Fix CI for failing checks', () => {
    const threads = nextSteps({ uncommitted: 0, unpushed: 0, pr: pr({ unresolved: 2, checks: [check('pass')] }) }, mws, false, aaron)
    expect(threads.steps).toEqual([{ id: 'comments', label: 'Answer comments', command: '/pr-comment-rundown' }])
    expect(threads.waiting).toBeUndefined()

    const failing = nextSteps({ uncommitted: 0, unpushed: 0, pr: pr({ unresolved: 1, checks: [check('fail'), check('pass')] }) }, mws, false, aaron)
    expect(commands(failing)).toEqual(['/gh-fix-ci', '/pr-comment-rundown'])
  })

  it('offers no MWS actions to a session that lacks the skills', () => {
    const side = ['compact', 'review']
    expect(nextSteps({ uncommitted: 4, unpushed: 1 }, side, false, aaron).steps).toEqual([])
    expect(nextSteps({ uncommitted: 0, unpushed: 0, pr: pr({ unresolved: 2, checks: [check('fail')] }) }, side, false, aaron).steps).toEqual([])
    expect(nextSteps({ uncommitted: 4, unpushed: 0 }, [], false, aaron).steps).toEqual([])
  })

  it('hints at the config when no ship commands are set up, and says when none of them are installed', () => {
    expect(nextSteps({ uncommitted: 2, unpushed: 0 }, ['compact'])).toEqual({ steps: [], hint: noShipCommands })
    expect(nextSteps({ uncommitted: 2, unpushed: 0 }, ['compact'], false, aaron)).toEqual({ steps: [], hint: shipNotInstalled })
    expect(nextSteps({ uncommitted: 0, unpushed: 0 }, ['compact'])).toEqual({ steps: [] })
    expect(nextSteps({ uncommitted: 0, unpushed: 0, pr: pr({ unresolved: 2, checks: [check('fail')] }) }, mws).steps).toEqual([])
    expect(nextSteps({ uncommitted: 0, unpushed: 0, pr: pr({ state: 'merged' }) }, []).steps.map((step) => step.id)).toEqual(['cleanup'])
  })

  it('uses the configured command names, with or without a leading slash', () => {
    const own = nextSteps({ uncommitted: 1, unpushed: 0 }, ['check', 'verify-all'], false, { ship: ['check', '/verify-all'] })
    expect(own.steps).toEqual([
      { id: 'test-cases', label: 'Test cases', command: '/check' },
      { id: 'verify', label: 'Verify', command: '/verify-all' },
    ])
  })

  it('offers cleanup after a merge, and moving the ticket only when Linear knows it', () => {
    const merged = { uncommitted: 0, unpushed: 0, pr: pr({ state: 'merged' }) }
    expect(commands(nextSteps(merged, [], false, aaron))).toEqual(['cleanup'])
    expect(commands(nextSteps(merged, [], true, aaron))).toEqual(['cleanup', 'move-ticket'])
    expect(nextSteps({ uncommitted: 0, unpushed: 0, pr: pr({ state: 'closed' }) }, mws, false, aaron).steps).toEqual([])
    expect(nextSteps({ uncommitted: 0, unpushed: 0 }, mws, false, aaron).steps).toEqual([])
  })
})

describe('ship-it for a chat', () => {
  let dir: string
  let office: ReturnType<typeof openOffice>
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=office@test', '-c', 'user.name=office', ...args], { cwd: dir, stdio: 'ignore' })
  const noLinear = createLinear(() => undefined)

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-ship-')))
    office = openOffice(dir, createFakeEngine())
    writeFileSync(join(dir, 'BidFlow.vue'), 'one\n')
    git('init', '-q', '-b', 'main')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    git('checkout', '-q', '-b', 'auc-1302-bid-flow-approach')
  })

  afterEach(() => {
    office.db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads the PR’s unresolved threads through the review helpers, and the click sends /pr-comment-rundown to that chat', async () => {
    const calls: string[][] = []
    const gh: Run = async (_command, args) => {
      calls.push(args)
      if (args[0] === 'pr') return JSON.stringify({ number: 42, title: 'Round bids', url: 'https://github.com/mws/monorepo/pull/42', state: 'OPEN', statusCheckRollup: [{ __typename: 'CheckRun', name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS' }] })
      return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }, { isResolved: false }, { isResolved: true }] } } } } })
    }
    const chatId = office.start('Bid flow approach')
    office.finish(chatId)

    const ship = await loadShipIt(dir, office.engine.commands(chatId)?.map((command) => command.name) ?? [], noLinear, gh, aaron)
    expect(ship.steps.map((step) => step.label)).toEqual(['Answer comments'])
    expect(ship.ticket).toEqual({ id: 'AUC-1302' })
    expect(calls.map((args) => args.slice(0, 2).join(' '))).toEqual(['pr view', 'api graphql'])

    office.store.sendMessage(chatId, ship.steps[0]!.command)
    expect(office.engine.sent.at(-1)).toEqual({ chatId, text: '/pr-comment-rundown' })
  })

  it('shows a quiet notice when gh is unavailable and still offers the MWS steps for local changes', async () => {
    writeFileSync(join(dir, 'BidFlow.vue'), 'two\n')
    const ship = await loadShipIt(dir, mws, noLinear, ghMissing, aaron)
    expect(ship.notice).toMatch(/gh\) isn’t installed/)
    expect(ship.steps.map((step) => step.command)).toEqual(['/mws-test-cases', '/mws-verify', '/mws-review', '/mws-pr'])
  })

  it('shows the branch’s ticket with its Linear title and status, and offers moving it once the PR is merged', async () => {
    const issue = { id: 'u', identifier: 'AUC-1302', title: 'Bid flow approach', url: 'https://linear.app/mws/issue/AUC-1302', description: 'long text', state: { name: 'In Review' }, team: { states: { nodes: [] } } }
    const linear = createLinear(() => 'key', async () => new Response(JSON.stringify({ data: { issue } })))
    const merged: Run = async () => JSON.stringify({ number: 42, title: 'Round bids', url: 'https://github.com/mws/monorepo/pull/42', state: 'MERGED' })
    const ship = await loadShipIt(dir, mws, linear, merged, aaron)
    expect(ship.ticket).toEqual({ id: 'AUC-1302', title: 'Bid flow approach', status: 'In Review', url: issue.url })
    expect(ship.steps.map((step) => step.id)).toEqual(['cleanup', 'move-ticket'])
  })

  it('offers nothing outside a git repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'agent-office-plain-'))
    expect(await loadShipIt(plain, mws, noLinear, ghMissing, aaron)).toEqual({ steps: [] })
    rmSync(plain, { recursive: true, force: true })
  })
})
