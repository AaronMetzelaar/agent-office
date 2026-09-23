import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorktree, planWorktree, slugFor } from '../../src/main/worktrees/create'
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

describe('slugs', () => {
  it('names the branch after a Linear-style id when the prompt has one, else after the first words', () => {
    expect(slugFor('AUC-1302: rework the bid flow approach, please')).toBe('auc-1302-rework-the-bid-flow')
    expect(slugFor('Fix the Czechia auction visibility bug today')).toBe('fix-the-czechia-auction-visibility')
    expect(slugFor('🚀 !!')).toBe('agent')
  })
})

describe('fresh worktrees', () => {
  it('creates <repo>/.claude/worktrees/<slug> on a new branch, keeping the chosen subfolder', async () => {
    const plan = planWorktree(join(repo, 'frontend/mobile'), 'bid-alerts')
    expect(plan).toEqual({ repo, slug: 'bid-alerts', path: join(repo, '.claude/worktrees/bid-alerts'), cwd: join(repo, '.claude/worktrees/bid-alerts/frontend/mobile') })
    await createWorktree(plan)
    expect(existsSync(join(plan.cwd, 'App.tsx'))).toBe(true)
    expect(branches()).toContain('bid-alerts')
    expect(planWorktree(repo, 'bid-alerts').slug).toBe('bid-alerts-2')
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
    await vi.waitFor(() => expect(office.engine.sent).toEqual([{ chatId: id, text: 'Bid alerts widget' }]))
    expect(office.engine.starts[0]?.options.cwd).toBe(join(repo, '.claude/worktrees/bid-alerts-widget/frontend/mobile'))
    expect(office.chat(id).setup).toBeUndefined()
    expect(office.chat(id).rows.filter((row) => row.kind === 'user')).toHaveLength(1)
    expect(office.store.recentFolders()).toEqual([join(repo, 'frontend/mobile')])
  })

  it('shows a failure on the desk and in the chat with Retry, leaves nothing behind, and Retry sets it up', async () => {
    const fixed = failCheckout()
    const result = office.store.start('main', repo, 'Refund webhook retries', undefined, undefined, { worktree: true })
    if ('error' in result) throw new Error(result.error)
    const id = result.chatId
    await vi.waitFor(() => expect(office.chat(id).state).toBe('stuck'))
    expect(office.chat(id)).toMatchObject({ setup: 'worktree-failed', stuck: { reason: 'error', detail: expect.stringContaining('post-checkout hook failed') } })
    expect(doingNow(office.chat(id), Date.now())).toBe('Stuck · worktree failed')
    expect(existsSync(join(repo, '.claude/worktrees/refund-webhook-retries'))).toBe(false)
    expect(branches()).toEqual(['main'])
    expect(office.engine.starts).toEqual([])

    fixed()
    office.store.resumeChat(id)
    expect(office.chat(id)).toMatchObject({ state: 'starting', setup: 'worktree' })
    await vi.waitFor(() => expect(office.engine.sent).toEqual([{ chatId: id, text: 'Refund webhook retries' }]))
    expect(branches()).toContain('refund-webhook-retries')
  })

  it('refuses a fresh worktree outside git before creating a chat', () => {
    mkdirSync(join(dir, 'loose'))
    expect(office.store.start('main', join(dir, 'loose'), 'Anything', undefined, undefined, { worktree: true })).toEqual({ error: expect.stringContaining('isn’t in a git repository') })
    expect(office.store.snapshot()).toEqual([])
  })
})
