import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openVault } from '../../src/main/accounts/tokens'
import { chatTicketId, createLinear, ticketId, withTicket, type Post } from '../../src/main/workflow/linear'
import { leadingTicket } from '../../src/shared/workflow'

vi.mock('electron', () => import('../fakes/electron'))

const issue = {
  id: 'uuid-1302',
  identifier: 'AUC-1302',
  title: 'Bid flow approach',
  url: 'https://linear.app/mws/issue/AUC-1302/bid-flow-approach',
  description: 'Bids round down.',
  state: { name: 'In Review' },
  team: {
    states: {
      nodes: [
        { id: 's-review', name: 'In Review', type: 'started', position: 3 },
        { id: 's-cancel', name: 'Canceled', type: 'canceled', position: 6 },
        { id: 's-done', name: 'Done', type: 'completed', position: 4 },
        { id: 's-shipped', name: 'Shipped', type: 'completed', position: 5 },
      ],
    },
  },
}

function linearApi(reply: (body: { query: string; variables: Record<string, string> }) => unknown = () => ({ data: { issue } })) {
  const calls: { headers: Record<string, string>; body: { query: string; variables: Record<string, string> } }[] = []
  const post: Post = async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, string> }
    calls.push({ headers: init.headers as Record<string, string>, body })
    return new Response(JSON.stringify(reply(body)), { status: 200 })
  }
  return { post, calls }
}

describe('ticket ids', () => {
  it('reads the ticket id from a branch, a worktree name or a Linear link', () => {
    expect(ticketId('auc-1302-bid-flow-approach')).toBe('AUC-1302')
    expect(ticketId('aaron/auc-1302-bid-flow')).toBe('AUC-1302')
    expect(ticketId('AUC-1302')).toBe('AUC-1302')
    expect(ticketId('https://linear.app/mws/issue/AUC-1302/bid-flow-approach')).toBe('AUC-1302')
    expect(ticketId('main')).toBeUndefined()
    expect(ticketId('fix-the-bid-flow')).toBeUndefined()
    expect(ticketId('auc1302-bid')).toBeUndefined()
    expect(ticketId(undefined)).toBeUndefined()
  })

  it('falls back from the branch to the worktree folder', () => {
    expect(chatTicketId('auc-1302-bid-flow', '/repo')).toBe('AUC-1302')
    expect(chatTicketId(undefined, '/repo/.claude/worktrees/mob-88-deep-links/frontend')).toBe('MOB-88')
    expect(chatTicketId('main', '/repo/frontend')).toBeUndefined()
  })
})

describe('Linear', () => {
  it('shows the bare id without an API key and never calls Linear', async () => {
    const { post, calls } = linearApi()
    expect(await createLinear(() => undefined, post).ticket('AUC-1302')).toEqual({ ticket: { id: 'AUC-1302' } })
    expect(calls).toEqual([])
  })

  it('fetches the title and status with the key from the vault, and caches it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-office-linear-'))
    const vault = openVault(dir)
    vault.setLinearKey('lin_api_secret')
    const { post, calls } = linearApi()
    const linear = createLinear(() => vault.linearKey(), post)

    const { ticket, notice } = await linear.ticket('AUC-1302')
    expect(notice).toBeUndefined()
    expect(ticket).toEqual({ id: 'AUC-1302', title: 'Bid flow approach', status: 'In Review', url: issue.url, description: 'Bids round down.' })
    expect(calls[0]!.headers.authorization).toBe('lin_api_secret')
    expect(calls[0]!.body.variables).toEqual({ id: 'AUC-1302' })

    await linear.ticket('AUC-1302')
    expect(calls).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it('shows a quiet notice when Linear is unreachable or refuses the key', async () => {
    const down: Post = async () => {
      throw new TypeError('fetch failed')
    }
    expect(await createLinear(() => 'key', down).ticket('AUC-1302')).toEqual({ ticket: { id: 'AUC-1302' }, notice: 'Couldn’t read AUC-1302 from Linear, so only its id shows.' })
    const refused: Post = async () => new Response(JSON.stringify({ errors: [{ message: 'Authentication required' }] }), { status: 400 })
    expect((await createLinear(() => 'key', refused).ticket('AUC-1302')).notice).toMatch(/Couldn’t read/)
  })

  it('asks before moving a ticket, and moves nothing when the answer is no', async () => {
    const { post, calls } = linearApi((body) => (body.query.startsWith('mutation') ? { data: { issueUpdate: { success: true } } } : { data: { issue } }))
    const linear = createLinear(() => 'key', post)
    const confirm = vi.fn(async () => false)

    expect(await linear.moveToDone('AUC-1302', confirm)).toEqual({})
    expect(confirm).toHaveBeenCalledWith('In Review', 'Done')
    expect(calls.some((call) => call.body.query.startsWith('mutation'))).toBe(false)

    confirm.mockResolvedValue(true)
    expect(await linear.moveToDone('AUC-1302', confirm)).toEqual({ status: 'Done' })
    expect(calls.at(-1)!.body).toMatchObject({ query: expect.stringMatching(/^mutation/), variables: { id: 'uuid-1302', stateId: 's-done' } })
  })

  it('reports a failed move instead of throwing', async () => {
    const { post } = linearApi((body) => (body.query.startsWith('mutation') ? { errors: [{ message: 'Forbidden' }] } : { data: { issue } }))
    expect(await createLinear(() => 'key', post).moveToDone('AUC-1302', async () => true)).toEqual({ error: 'Couldn’t move AUC-1302: Forbidden' })
  })
})

describe('a ticket as the whole prompt', () => {
  it('finds a leading ticket id in any case, or a Linear issue link, and keeps the rest', () => {
    expect(leadingTicket('AUC-1302')).toEqual({ id: 'AUC-1302', rest: '' })
    expect(leadingTicket('  auc-1302 keep the old API\nand add tests')).toEqual({ id: 'AUC-1302', rest: 'keep the old API\nand add tests' })
    expect(leadingTicket(issue.url)).toEqual({ id: 'AUC-1302', rest: '' })
    expect(leadingTicket('https://linear.app/mws/issue/auc-1302\n\nskip mobile')).toEqual({ id: 'AUC-1302', rest: 'skip mobile' })
    expect(leadingTicket('Fix AUC-1302 later')).toBeUndefined()
    expect(leadingTicket('auc1302 bid')).toBeUndefined()
    expect(leadingTicket('AUC-1302x')).toBeUndefined()
    expect(leadingTicket('https://github.com/mws/monorepo/pull/7')).toBeUndefined()
  })

  it('with a key, puts the ticket’s title, status, description and link before the extra text, and titles the chat after it', async () => {
    const { post, calls } = linearApi()
    const linear = createLinear(() => 'key', post)
    const seeded = await withTicket(linear, 'auc-1302 keep the old API', { dept: 'mkt', worktree: true })
    expect(seeded).toEqual({
      prompt: `Work on Linear ticket AUC-1302: Bid flow approach\n\nStatus: In Review\n\nBids round down.\n\n${issue.url}\n\nkeep the old API`,
      options: { dept: 'mkt', worktree: true, title: 'AUC-1302 Bid flow approach' },
    })
    expect((await withTicket(linear, issue.url, undefined)).prompt).toBe(`Work on Linear ticket AUC-1302: Bid flow approach\n\nStatus: In Review\n\nBids round down.\n\n${issue.url}`)
    expect(calls.every((call) => call.body.query.startsWith('query'))).toBe(true)
  })

  it('without a key, or when Linear fails, sends the prompt as typed', async () => {
    const { post, calls } = linearApi()
    expect(await withTicket(createLinear(() => undefined, post), 'AUC-1302', { worktree: true })).toEqual({ prompt: 'AUC-1302', options: { worktree: true, title: 'AUC-1302' } })
    expect(calls).toEqual([])
    const down: Post = async () => {
      throw new TypeError('fetch failed')
    }
    expect((await withTicket(createLinear(() => 'key', down), `${issue.url} and the tests`, {})).prompt).toBe(`${issue.url} and the tests`)
  })

  it('leaves a prompt that doesn’t start with a ticket alone, and never asks Linear', async () => {
    const { post, calls } = linearApi()
    const options = { worktree: true }
    expect(await withTicket(createLinear(() => 'key', post), 'Fix the bid flow for AUC-1302', options)).toEqual({ prompt: 'Fix the bid flow for AUC-1302', options })
    expect(calls).toEqual([])
  })
})
