import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { gitRepo, mwsMonorepo } from '../fakes/repos'

const root = resolve(__dirname, '../..')
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-rooms-')))
const opened: ElectronApplication[] = []

async function launch(config?: string) {
  const userData = mkdtempSync(join(tmpdir(), 'ao-rooms-'))
  const configDir = mkdtempSync(join(scratch, 'config-'))
  if (config !== undefined) writeFileSync(join(configDir, 'departments.json'), config)
  const app = await electron.launch({
    args: ['--use-mock-keychain', root],
    env: { ...process.env, AGENT_OFFICE_USER_DATA: userData, AGENT_OFFICE_CONFIG_DIR: configDir, AGENT_OFFICE_FAKE_VALIDATOR: '1', AGENT_OFFICE_FAKE_ENGINE: '1' },
  })
  opened.push(app)
  const page = await app.firstWindow()
  const accountId = await page.evaluate(async () => {
    const added = await window.office.addAccount('main', 'sk-ant-oat01-fake-ok')
    if (!('account' in added)) throw new Error(added.error)
    return added.account.id
  })
  const start = async (cwd: string, prompt: string) => {
    const started = await page.evaluate(({ accountId, cwd, prompt }) => window.office.startChat(accountId, cwd, `${prompt} [hang]`), { accountId, cwd, prompt })
    expect(started).toHaveProperty('chatId')
  }
  return { page, start }
}

const sign = (page: Page, name: string) => page.locator('.sign', { hasText: name })

test.afterAll(async () => {
  await Promise.all(opened.map((app) => app.close().catch(() => undefined)))
  rmSync(scratch, { recursive: true, force: true })
})

test.afterEach(async () => {
  for (const app of opened.splice(0)) {
    await app.evaluate(({ dialog }) => Object.assign(dialog, { showMessageBox: async () => ({ response: 0, checkboxChecked: false }) })).catch(() => undefined)
    await app.close().catch(() => undefined)
  }
})

test('a fresh install gives each repo its own room, with nothing about research, the gym, the monorepo or MWS', async () => {
  test.setTimeout(90_000)
  const repos = ['alpha', 'beta', 'gamma'].map((name) => gitRepo(join(scratch, 'fresh', name)))
  const { page, start } = await launch()
  for (const [i, repo] of repos.entries()) await start(repo, `Task ${i + 1}`)
  for (const name of ['alpha', 'beta', 'gamma']) await expect(sign(page, name)).toBeVisible()
  await expect(sign(page, 'Side projects')).toBeHidden()

  await page.getByRole('button', { name: 'New agent' }).first().click()
  const options = await page.getByLabel('Section').locator('option').allTextContents()
  const words = [...(await page.locator('.sign:visible').allTextContents()), ...options, await page.getByRole('complementary', { name: 'Inbox' }).innerText()].join(' ')
  expect(words).not.toMatch(/research|gym|monorepo|mws/i)
})

test('an MWS colleague gets the MWS rooms for the monorepo wherever the clone lives, with no config', async () => {
  test.setTimeout(90_000)
  const clone = mwsMonorepo(join(scratch, 'code', 'mws'))
  mkdirSync(join(clone, 'services', 'api'), { recursive: true })
  const { page, start } = await launch()
  await start(join(clone, 'frontend', 'marketplace'), 'Bid flow')
  await start(join(clone, 'services', 'api'), 'Refund webhook')
  await expect(sign(page, 'Marketplace')).toBeVisible()
  await expect(sign(page, 'Backend / infra')).toBeVisible()
  await expect(sign(page, 'mws')).toBeHidden()
})

test('an unreadable config shows the error in the inbox and sends new repos to the playground', async () => {
  test.setTimeout(90_000)
  const repo = gitRepo(join(scratch, 'broken', 'shop'))
  const { page, start } = await launch('{ not json')
  await expect(page.getByRole('alert').filter({ hasText: 'departments.json can’t be read' })).toBeVisible()
  await start(repo, 'Checkout')
  await expect(sign(page, 'Side projects')).toBeVisible()
  await expect(sign(page, 'shop')).toBeHidden()
})

test('a config room with a bad entry is skipped by name, and the good ones still work', async () => {
  test.setTimeout(90_000)
  const api = gitRepo(join(scratch, 'configured', 'api'))
  const config = JSON.stringify({ rooms: [{ name: 'Platform', folders: [api], look: 'servers' }, { name: 'Broken', look: 'nope', folders: [api] }] })
  const { page, start } = await launch(config)
  await expect(page.getByRole('alert')).toContainText('Skipped room "Broken"')
  await start(api, 'Rate limits')
  await expect(sign(page, 'Platform')).toBeVisible()
})

test('ten repos get ten rooms, all signed and on screen', async () => {
  test.setTimeout(120_000)
  const names = Array.from({ length: 10 }, (_, i) => `repo-${String.fromCharCode(97 + i)}`)
  const { page, start } = await launch()
  for (const name of names) await start(gitRepo(join(scratch, 'ten', name)), name)
  for (const name of names) await expect(sign(page, name)).toBeVisible()
  const canvas = (await page.locator('canvas').boundingBox())!
  const inside = async (name: string) => {
    const box = await sign(page, name).boundingBox()
    return !!box && box.x >= canvas.x - 1 && box.y >= canvas.y - 1 && box.x + box.width <= canvas.x + canvas.width + 1 && box.y + box.height <= canvas.y + canvas.height + 1
  }
  await expect.poll(async () => (await Promise.all(names.map(inside))).every(Boolean), { timeout: 10_000 }).toBe(true)
})
