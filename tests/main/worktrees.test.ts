import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withTicket } from '../../src/main/workflow/linear'
import { branchFor, createWorktree, planWorktree } from '../../src/main/worktrees/create'
import { doingNow } from '../../src/shared/chat'
import { openOffice } from '../fakes/office'

vi.mock('electron', async () => await import('../fakes/electron'))

let dir: string
let repo: string
let office: ReturnType<typeof openOffice>

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
const branches = () => git('branch', '--format=%(refname:short)').trim().split('\n')
const worktrees = () => git('worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree ')).length
const failCheckout = () => {
  const hook = join(repo, '.git/hooks/post-checkout')
  writeFileSync(hook, '#!/bin/sh\necho "post-checkout hook failed" >&2\nexit 1\n')
  chmodSync(hook, 0o755)
  return () => rmSync(hook)
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-worktrees-')))
  repo = join(dir, 'monorepo')
  mkdirSync(join(repo, 'frontend/mobile'), { recursive: true })
  mkdirSync(join(repo, 'frontend/marketplace'))
  writeFileSync(join(repo, 'README.md'), '# MWS Monorepo\n')
  writeFileSync(join(repo, 'frontend/mobile/App.tsx'), 'export {}\n')
  git('init', '-q', '-b', 'main')
  git('-c', 'user.email=office@test', '-c', 'user.name=office', 'add', '.')
  git('-c', 'user.email=office@test', '-c', 'user.name=office', 'commit', '-q', '-m', 'init')
  office = openOffice(dir)
})

afterEach(() => {
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('branch names', () => {
  it('takes a type/short-summary suggestion, keeping the ticket id up front', () => {
    expect(branchFor('I feel like the branch naming can be improved', 'feature/improve-branch-naming')).toBe('feature/improve-branch-naming')
    expect(branchFor('AUC-1302: rework the bid flow', 'Fix/bid-flow-rework')).toBe('fix/auc-1302-bid-flow-rework')
    expect(branchFor('AUC-1302: rework the bid flow', 'fix/auc-1302-bid-flow')).toBe('fix/auc-1302-bid-flow')
  })

  it('falls back to the first words of the prompt when the suggestion is missing or malformed', () => {
    expect(branchFor('AUC-1302: rework the bid flow approach, please')).toBe('feature/auc-1302-rework-the-bid-flow')
    expect(branchFor('Fix the Czechia auction visibility bug today', 'chore/whatever')).toBe('fix/fix-the-czechia-auction-visibility')
    expect(branchFor('Update the README setup steps', 'Sure! Here is a branch: docs/x')).toBe('docs/update-the-readme-setup-steps')
    expect(branchFor('🚀 !!')).toBe('feature/agent')
  })
})

describe('fresh worktrees', () => {
  it('creates <repo>/.claude/worktrees/<slug> on a new branch, keeping the chosen subfolder', async () => {
    const plan = planWorktree(join(repo, 'frontend/mobile'), 'feature/bid-alerts')
    expect(plan).toEqual({ repo, branch: 'feature/bid-alerts', path: join(repo, '.claude/worktrees/bid-alerts'), cwd: join(repo, '.claude/worktrees/bid-alerts/frontend/mobile') })
    await createWorktree(plan)
    expect(existsSync(join(plan.cwd, 'App.tsx'))).toBe(true)
    expect(branches()).toContain('feature/bid-alerts')
    expect(planWorktree(repo, 'feature/bid-alerts')).toMatchObject({ branch: 'feature/bid-alerts-2', path: join(repo, '.claude/worktrees/bid-alerts-2') })
  })

  it('refuses a folder outside git with a clear message', () => {
    mkdirSync(join(dir, 'loose'))
    expect(() => planWorktree(join(dir, 'loose'), 'x')).toThrow('isn’t in a git repository')
  })

  it('leaves no half-created worktree or branch behind when git fails', async () => {
    failCheckout()
    const plan = planWorktree(repo, 'broken')
    await expect(createWorktree(plan)).rejects.toThrow('post-checkout hook failed')
    expect(existsSync(plan.path)).toBe(false)
    expect(branches()).toEqual(['main'])
    expect(worktrees()).toBe(1)
  })
})

describe('starting a chat in a fresh worktree', () => {
  it('shows setting up on the desk, then runs the first prompt inside the worktree', async () => {
    const result = office.store.start('main', join(repo, 'frontend/mobile'), 'Bid alerts widget', undefined, undefined, { worktree: true })
    if ('error' in result) throw new Error(result.error)
    const id = result.chatId
    expect(office.chat(id)).toMatchObject({ state: 'starting', setup: 'worktree', department: 'mob', worktree: join(repo, '.claude/worktrees/bid-alerts-widget') })
    expect(doingNow(office.chat(id), Date.now())).toBe('Setting up worktree…')
    await vi.waitFor(() => expect(office.engine.sent).toEqual([{ chatId: id, text: 'Bid alerts widget' }]), { timeout: 10_000 })
    expect(branches()).toContain('feature/bid-alerts-widget')
  })

  it('names the branch and worktree after the model’s type/short-summary suggestion', async () => {
    office.engine.answers.push('feature/bid-alerts\nextra')
    const result = office.store.start('main', join(repo, 'frontend/mobile'), 'I want a widget that alerts me about bids', undefined, undefined, { worktree: true })
    if ('error' in result) throw new Error(result.error)
    const id = result.chatId
    expect(doingNow(office.chat(id), Date.now())).toBe('Setting up worktree…')
    await vi.waitFor(() => expect(office.engine.sent).toEqual([{ chatId: id, text: 'I want a widget that alerts me about bids' }]), { timeout: 10_000 })
    expect(branches()).toContain('feature/bid-alerts')
    expect(office.chat(id).worktree).toBe(join(repo, '.claude/worktrees/bid-alerts'))
    expect(office.engine.starts[0]?.options.cwd).toBe(join(repo, '.claude/worktrees/bid-alerts/frontend/mobile'))
    expect(office.chat(id).setup).toBeUndefined()
    expect(office.chat(id).rows.filter((row) => row.kind === 'user')).toHaveLength(1)
    expect(office.store.recentFolders()).toEqual([join(repo, 'frontend/mobile')])
  })

  it('shows a failure on the desk and in the chat with Retry, leaves nothing behind, and Retry sets it up', async () => {
    const fixed = failCheckout()
    const result = office.store.start('main', repo, 'Refund webhook retries', undefined, undefined, { worktree: true })
    if ('error' in result) throw new Error(result.error)
    const id = result.chatId
    await vi.waitFor(() => expect(office.chat(id).state).toBe('stuck'), { timeout: 10_000 })
    expect(office.chat(id)).toMatchObject({ setup: 'worktree-failed', stuck: { reason: 'error', detail: expect.stringContaining('post-checkout hook failed') } })
    expect(doingNow(office.chat(id), Date.now())).toBe('Stuck · worktree failed')
    expect(existsSync(join(repo, '.claude/worktrees/refund-webhook-retries'))).toBe(false)
    expect(branches()).toEqual(['main'])
    expect(office.engine.starts).toEqual([])

    fixed()
    office.store.resumeChat(id)
    expect(office.chat(id)).toMatchObject({ state: 'starting', setup: 'worktree' })
    await vi.waitFor(() => expect(office.engine.sent).toEqual([{ chatId: id, text: 'Refund webhook retries' }]), { timeout: 10_000 })
    expect(branches()).toContain('feature/refund-webhook-retries')
  })

  it('refuses a fresh worktree outside git before creating a chat', () => {
    mkdirSync(join(dir, 'loose'))
    expect(office.store.start('main', join(dir, 'loose'), 'Anything', undefined, undefined, { worktree: true })).toEqual({ error: expect.stringContaining('isn’t in a git repository') })
    expect(office.store.snapshot()).toEqual([])
  })

  it('names the worktree and the chat after a Linear ticket given as the whole prompt', async () => {
    const linear = { ticket: async (id: string) => ({ ticket: { id, title: 'Deep links for push', status: 'Todo', url: `https://linear.app/mws/issue/${id}/deep-links` } }) }
    const seeded = await withTicket(linear, 'mob-88', { worktree: true })
    const result = office.store.start('main', join(repo, 'frontend/mobile'), seeded.prompt, undefined, undefined, seeded.options)
    if (!('chatId' in result)) throw new Error(result.error)
    await vi.waitFor(() => expect(office.engine.sent).toHaveLength(1), { timeout: 10_000 })
    expect(office.chat(result.chatId)).toMatchObject({ title: 'MOB-88 Deep links for push', worktree: join(repo, '.claude/worktrees/mob-88-deep-links-for-push') })
    expect(branches()).toContain('feature/mob-88-deep-links-for-push')
    expect(office.engine.sent[0]!.text).toBe('Work on Linear ticket MOB-88: Deep links for push\n\nStatus: Todo\n\nhttps://linear.app/mws/issue/MOB-88/deep-links')
  })
})
