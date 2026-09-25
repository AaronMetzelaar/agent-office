import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ChatView } from '../../src/shared/chat'

const root = resolve(__dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'agent-office-cleanup-'))
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-cleanup-repo-')))
const repo = join(dir, 'repo')
const env = { ...process.env, AGENT_OFFICE_USER_DATA: userData, AGENT_OFFICE_FAKE_VALIDATOR: '1', AGENT_OFFICE_FAKE_ENGINE: '1' }
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=office@test', '-c', 'user.name=office', ...args], { cwd, stdio: 'ignore' })

type Globals = { store: { view(id: string): ChatView | undefined }; fakeEngine: { processes: { signals: { pid: number; signal: string }[] } } }

test.afterAll(() => {
  rmSync(userData, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
})

test('Housekeeping previews the safe cleanup, runs it, and reports what was freed', async () => {
  test.setTimeout(60_000)
  git(dir, 'init', '-q', '--bare', '-b', 'main', join(dir, 'origin.git'))
  git(dir, 'clone', '-q', join(dir, 'origin.git'), repo)
  writeFileSync(join(repo, 'a.ts'), 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  const trees = ['bid-flow', 'vat-rounding', 'deep-links', 'half-done'].map((name) => {
    const path = join(repo, '.claude', 'worktrees', name)
    git(repo, 'worktree', 'add', '-q', '-b', name, path)
    return path
  })
  writeFileSync(join(trees[3]!, 'draft.ts'), 'wip\n')

  const app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  const page = await app.firstWindow()
  const view = (id: string) => app.evaluate((_electron, chatId) => (globalThis as unknown as Globals).store.view(chatId), id)
  const ids = await page.evaluate(async (cwds) => {
    const added = await window.office.addAccount('main', 'sk-ant-oat01-fake-ok')
    if (!('account' in added)) throw new Error(added.error)
    const titles = ['Bid flow approach', 'Checkout VAT rounding', 'Push notification deep links', 'Half-done refactor']
    return Promise.all(
      cwds.map(async (cwd, index) => {
        const started = await window.office.startChat(added.account.id, cwd, titles[index]!)
        if (!('chatId' in started)) throw new Error(started.error)
        return started.chatId
      }),
    )
  }, trees)
  for (const id of ids) await expect.poll(async () => (await view(id))?.state).toBe('done')
  await app.evaluate((_electron, chatIds) => {
    for (const id of chatIds) Object.assign((globalThis as unknown as Globals).store.view(id)!, { lastActivityAt: Date.now() - 4 * 86_400_000 })
  }, ids)

  await page.getByRole('button', { name: /^Housekeeping\. RAM/ }).click()
  const drawer = page.getByRole('complementary', { name: 'Inbox' })
  await expect(drawer.getByRole('heading', { name: 'Housekeeping' })).toBeVisible()
  const candidates = drawer.getByRole('region', { name: 'Cleanup candidates · 4' })
  await expect(candidates.locator('.hrow')).toHaveCount(4)
  const halfDone = candidates.locator('.hrow', { hasText: 'Half-done refactor' })
  await expect(halfDone.locator('.gc')).toHaveText('1 uncommitted')
  await expect(halfDone).toContainText('Can’t remove the worktree: 1 uncommitted change.')
  await expect(halfDone.getByRole('button', { name: 'Open chat' })).toBeVisible()
  const bidFlow = candidates.locator('.hrow', { hasText: 'Bid flow approach' })
  await expect(bidFlow.locator('.gc')).toHaveText('Clean')
  await expect(bidFlow.locator('.hr3')).toHaveText('claude session · 244 MB')
  await expect(bidFlow.locator('.hr2')).toContainText(/worktree \d+ MB/)
  for (const id of ids) expect((await view(id))?.parked).toBe(true)

  await drawer.getByRole('button', { name: 'Clean up 3 safe · frees 0.7 GB' }).click()
  const confirm = drawer.getByRole('group', { name: 'Confirm cleanup' })
  await expect(confirm).toContainText('Remove 3 worktrees')
  await expect(confirm).toContainText('Archive: ')
  await confirm.getByRole('button', { name: 'Clean up 3' }).click()

  await expect(drawer.getByRole('status')).toHaveText(/^Freed 0\.7 GB · removed 3 worktrees/)
  expect(trees.map((tree) => existsSync(tree))).toEqual([false, false, false, true])
  expect(await Promise.all(ids.map(async (id) => (await view(id))?.archived))).toEqual([true, true, true, false])
  const left = drawer.getByRole('region', { name: 'Cleanup candidates · 1' })
  await expect(left.locator('.hrow')).toHaveText([/Half-done refactor/])
  await expect(page.getByRole('button', { name: /^Housekeeping\. RAM .* 1 worktree\.$/ })).toBeVisible()
  const signals = await app.evaluate(() => (globalThis as unknown as Globals).fakeEngine.processes.signals)
  expect(signals.length).toBeGreaterThanOrEqual(4)
  expect(signals.every((sent) => sent.signal === 'SIGTERM')).toBe(true)

  await left.getByRole('button', { name: 'Open chat' }).click()
  await expect(drawer.getByRole('tab', { name: 'Chat' })).toBeVisible()
  await drawer.getByLabel('Message').fill('Commit what you have')
  await drawer.getByLabel('Message').press('Enter')
  await expect.poll(async () => (await view(ids[3]!))?.parked).toBe(false)

  await app.evaluate(({ dialog }) => Object.assign(dialog, { showMessageBox: async () => ({ response: 0, checkboxChecked: false }) }))
  await app.close()
})
