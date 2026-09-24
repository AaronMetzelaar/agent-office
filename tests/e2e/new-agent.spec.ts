import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Locator } from '@playwright/test'
import type { ChatView } from '../../src/shared/chat'

const root = resolve(__dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'agent-office-new-agent-'))
const mobile = join(mkdtempSync(join(tmpdir(), 'agent-office-repos-')), 'monorepo/frontend/mobile')
const env = { ...process.env, AGENT_OFFICE_USER_DATA: userData, AGENT_OFFICE_FAKE_VALIDATOR: '1', AGENT_OFFICE_FAKE_ENGINE: '1' }

async function anchor(locator: Locator) {
  const box = await locator.boundingBox()
  return box ? { x: box.x + box.width / 2, y: box.y + box.height } : undefined
}

test.afterAll(() => {
  rmSync(userData, { recursive: true, force: true })
  rmSync(resolve(mobile, '../../..'), { recursive: true, force: true })
})

test('starting from the free Mobile desk walks a new character in from the entrance to that desk, and the section grows its next free desk back at the overview', async () => {
  test.setTimeout(90_000)
  mkdirSync(mobile, { recursive: true })
  const app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  const page = await app.firstWindow()
  const views = () => app.evaluate(() => (globalThis as unknown as { store: { views(): ChatView[] } }).store.views())
  const accountId = await page.evaluate(async () => {
    const added = await window.office.addAccount('main', 'sk-ant-oat01-fake-ok')
    if (!('account' in added)) throw new Error(added.error)
    return added.account.id
  })
  const first = await page.evaluate(({ accountId, mobile }) => window.office.startChat(accountId, mobile, 'Bid alerts widget'), { accountId, mobile })
  expect(first).toHaveProperty('chatId')
  await expect.poll(async () => (await views())[0]?.state).toBe('done')

  await page.locator('.sign', { hasText: 'Mobile' }).click()
  const desk2 = page.getByRole('button', { name: 'New agent at Mobile desk 2' })
  const desk3 = page.getByRole('button', { name: 'New agent at Mobile desk 3' })
  await expect(desk2).toBeVisible()
  await expect(desk3).toBeHidden()
  await expect(page.getByRole('button', { name: 'New agent at Mobile desk 1' })).toBeHidden()
  await page.waitForTimeout(1200)
  const target = (await anchor(desk2))!
  await desk2.click()

  const drawer = page.getByRole('complementary', { name: 'Inbox' })
  await expect(drawer.getByRole('heading', { name: 'New agent' })).toBeVisible()
  await expect(drawer.getByText('Mobile · desk 2')).toBeVisible()
  await expect(drawer.getByLabel('Folder')).toHaveValue(mobile)
  await expect(drawer.getByLabel('Section')).toHaveValue('mob')
  await expect(drawer.getByLabel('Account')).toHaveValue(accountId)
  await drawer.getByLabel('Prompt').fill('Push notification deep links')
  await drawer.getByRole('button', { name: 'Start agent' }).click()

  const chip = page.locator('.chip', { hasText: 'Push notification deep links' })
  const start = await anchor(chip)
  expect(!start || Math.hypot(start.x - target.x, start.y - target.y) > 150).toBe(true)
  await expect
    .poll(
      async () => {
        const at = await anchor(chip)
        return at ? Math.abs(at.x - target.x) < 40 && Math.abs(at.y - target.y) < 90 : false
      },
      { timeout: 45_000 },
    )
    .toBe(true)
  await expect(desk2).toBeHidden()
  await expect(desk3).toBeHidden()

  const chat = (await views()).find((view) => view.title === 'Push notification deep links')!
  expect(chat).toMatchObject({ department: 'mob', cwd: mobile, accountId })
  await expect.poll(async () => (await views()).find((view) => view.id === chat.id)?.rows.map((row) => ('text' in row ? row.text : row.kind))).toEqual(['Push notification deep links', 'Sure, done.'])
  expect(chat).toMatchObject({ model: expect.any(String), effort: 'medium' })
  await page.evaluate((id) => window.office.sendMessage(id, 'Keep going [hang]'), chat.id)
  await expect.poll(async () => (await views()).find((view) => view.id === chat.id)?.state).toBe('working')

  await page.getByRole('button', { name: 'Overview' }).click()
  await page.waitForTimeout(1500)
  await page.locator('.sign', { hasText: 'Mobile' }).click()
  await expect(desk3).toBeVisible()

  await app.evaluate(({ dialog }) => Object.assign(dialog, { showMessageBox: async () => ({ response: 0, checkboxChecked: false }) }))
  await app.close()
})
