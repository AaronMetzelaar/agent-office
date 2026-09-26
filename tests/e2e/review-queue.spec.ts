import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import type { ChatView } from '../../src/shared/chat'

const root = resolve(__dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'agent-office-review-queue-'))
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-review-queue-repo-')))
const origin = join(dir, 'mws', 'monorepo.git')
const repo = join(dir, 'monorepo')
const env = { ...process.env, AGENT_OFFICE_USER_DATA: userData, AGENT_OFFICE_FAKE_VALIDATOR: '1', AGENT_OFFICE_FAKE_ENGINE: '1' }
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=office@test', '-c', 'user.name=office', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

type Github = { search: unknown[]; nodes: unknown[]; missing: boolean }
type Globals = { store: { views(): ChatView[] }; fakeEngine: { sent: { chatId: string; text: string }[] }; fakeGithub: Github; reviews: { poll(): Promise<void> } }

const requests = [
  { id: 'PR_7', number: 7, title: 'Round bids to the nearest euro', url: 'https://github.com/mws/monorepo/pull/7', isDraft: false, createdAt: daysAgo(12), repository: { name: 'monorepo', nameWithOwner: 'mws/monorepo' }, author: { login: 'jan' } },
  { id: 'PR_9', number: 9, title: 'Deep links for push', url: 'https://github.com/mws/monorepo/pull/9', isDraft: false, createdAt: daysAgo(0.1), repository: { name: 'monorepo', nameWithOwner: 'mws/monorepo' }, author: { login: 'eva' } },
]
const nodes = [
  { id: 'PR_7', additions: 120, deletions: 14, files: { nodes: [{ path: 'frontend/marketplace/pages/bid.vue' }] }, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, timelineItems: { nodes: [{ createdAt: daysAgo(10), requestedReviewer: { login: 'aaron' } }] } },
  { id: 'PR_9', additions: 8, deletions: 2, files: { nodes: [{ path: 'frontend/mobile/app/links.ts' }] }, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] }, timelineItems: { nodes: [] } },
]

async function github(app: ElectronApplication, change: Partial<Github>) {
  await app.evaluate(async (_electron, fields) => {
    const globals = globalThis as unknown as Globals
    Object.assign(globals.fakeGithub, fields)
    await globals.reviews.poll()
  }, change)
}

async function launch() {
  const app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  const page = await app.firstWindow()
  const accountId = await page.evaluate(async () => {
    const added = await window.office.addAccount('main', 'sk-ant-oat01-fake-ok')
    if ('account' in added) return added.account.id
    return (await window.office.listAccounts())[0]!.id
  })
  const views = () => app.evaluate(() => (globalThis as unknown as Globals).store.views())
  return { app, page, accountId, views }
}

async function quit(app: ElectronApplication) {
  await app.evaluate(({ dialog }) => Object.assign(dialog, { showMessageBox: async () => ({ response: 0, checkboxChecked: false }) }))
  await app.close()
}

test.beforeAll(() => {
  mkdirSync(origin, { recursive: true })
  git(origin, 'init', '-q', '--bare', '-b', 'main')
  git(dir, 'clone', '-q', origin, repo)
  mkdirSync(join(repo, 'frontend', 'marketplace', 'pages'), { recursive: true })
  writeFileSync(join(repo, 'frontend', 'marketplace', 'pages', 'bid.vue'), '<p>{{ bid }}</p>\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'push', '-q', 'origin', 'main')
})

test.afterAll(() => {
  rmSync(userData, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
})

test('review requests fill the tray and the drawer, Review starts an agent in PR reviews without a worktree, and a withdrawn request leaves quietly', async () => {
  test.setTimeout(60_000)
  const { app, page, accountId, views } = await launch()
  const known = await page.evaluate(({ accountId, repo }) => window.office.startChat(accountId, repo, 'Bid flow approach'), { accountId, repo })
  if (!('chatId' in known)) throw new Error(known.error)
  await expect.poll(async () => (await views()).find((view) => view.id === known.chatId)?.state).toBe('done')

  await github(app, { search: requests, nodes })
  const drawer = page.getByRole('complementary', { name: 'Inbox' })
  const queue = drawer.getByRole('region', { name: 'Review requests · 2' })
  await expect(queue.locator('.rqi')).toHaveCount(2)
  const old = queue.locator('.rqi', { hasText: 'Round bids to the nearest euro' })
  await expect(old).toHaveClass(/late/)
  await expect(old).toContainText('monorepo #7')
  await expect(old).toContainText('jan')
  await expect(old).toContainText('+120 −14')
  await expect(old).toContainText('CI passing')
  await expect(queue.locator('.rqi', { hasText: 'Deep links for push' })).not.toHaveClass(/late/)
  const tray = page.locator('.intray')
  await expect(tray).toHaveText('✉ 2 reviews')
  await expect(tray).toHaveClass(/late/)
  await expect(tray).toHaveAttribute('aria-label', '2 review requests in your in-tray, 1 older than 2 working days')

  await old.getByRole('button', { name: 'Review' }).click()
  await expect(drawer.getByRole('heading', { name: 'Review #7 Round bids to the nearest euro' })).toBeVisible()
  await expect.poll(async () => (await views()).find((view) => view.title.startsWith('Review #7'))?.state).toMatch(/^(done|idle)$/)
  const review = (await views()).find((view) => view.title.startsWith('Review #7'))!
  expect(review).toMatchObject({ department: 'rev', review: true, cwd: repo, accountId, effort: 'medium' })
  expect(review.worktree).toBeUndefined()
  expect(existsSync(join(repo, '.claude', 'worktrees'))).toBe(false)
  await expect(page.locator('.sign', { hasText: 'PR reviews' })).toBeVisible()
  const sent = await app.evaluate(() => (globalThis as unknown as Globals).fakeEngine.sent)
  expect(sent).toContainEqual({ chatId: review.id, text: 'Review this pull request: https://github.com/mws/monorepo/pull/7' })

  await drawer.getByRole('button', { name: 'Back to inbox' }).click()
  await github(app, { search: [requests[1]], nodes: [nodes[1]] })
  const left = drawer.getByRole('region', { name: 'Review requests · 1' })
  await expect(left.locator('.rqi')).toHaveText([/Deep links for push/])
  await expect(tray).toHaveText('✉ 1 review')
  await expect(tray).not.toHaveClass(/late/)
  await drawer.locator('.standby summary', { hasText: 'Standby' }).click({ position: { x: 12, y: 12 } })
  await expect(drawer.locator('.standby .brow', { hasText: 'Review #7' })).toContainText('PR reviews')
  expect((await views()).find((view) => view.id === review.id)).toMatchObject({ archived: false, state: 'idle' })

  await github(app, { missing: true })
  await expect(left.getByRole('status')).toHaveText('The GitHub CLI (gh) isn’t installed, so review requests are hidden.')
  await expect(left.locator('.rqi')).toHaveCount(1)
  await expect(drawer.locator('.brow', { hasText: 'Bid flow approach' })).toBeVisible()

  await quit(app)
})

test('a ticket id in the prompt is enough: it names the chat and the worktree after it, without a Linear key', async () => {
  const { app, page, views } = await launch()
  const drawer = page.getByRole('complementary', { name: 'Inbox' })
  await drawer.getByRole('button', { name: 'New agent' }).click()
  await drawer.getByLabel('Folder').selectOption(repo)
  await drawer.getByLabel('Fresh worktree').uncheck()
  await drawer.getByLabel('Prompt').fill('auc-1302')
  await expect(drawer.getByLabel('Fresh worktree')).toBeChecked()
  await expect(drawer.getByRole('status')).toContainText('The agent sees only AUC-1302, not the ticket.')

  await drawer.getByLabel('Prompt').press('End')
  await drawer.getByLabel('Prompt').pressSequentially(' bid flow approach')
  await drawer.getByRole('button', { name: 'Start agent' }).click()
  const tree = join(repo, '.claude', 'worktrees', 'auc-1302-bid-flow-approach')
  await expect.poll(async () => (await views()).find((view) => view.title === 'AUC-1302 bid flow approach')?.state).toMatch(/^(done|idle)$/)
  expect(git(tree, 'branch', '--show-current').trim()).toBe('feature/auc-1302-bid-flow-approach')
  await expect(drawer.getByRole('region', { name: 'Next steps' })).toContainText('AUC-1302')

  await drawer.getByRole('button', { name: 'Back to inbox' }).click()
  await drawer.getByRole('button', { name: 'New agent' }).click()
  await drawer.getByLabel('Folder').selectOption(repo)
  await drawer.getByLabel('Prompt').fill('mob-88')
  await expect(drawer.getByRole('status')).toContainText('The agent sees only MOB-88')
  await expect(drawer.getByRole('button', { name: 'Start agent' })).toBeEnabled()
  await drawer.getByRole('button', { name: 'Start agent' }).click()
  await expect.poll(async () => (await views()).find((view) => view.title === 'MOB-88')?.state).toMatch(/^(done|idle)$/)
  const sent = await app.evaluate(() => (globalThis as unknown as Globals).fakeEngine.sent)
  expect(sent.at(-1)?.text).toBe('mob-88')

  await quit(app)
})
