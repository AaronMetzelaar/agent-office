import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

const root = resolve(__dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'agent-office-sim-'))
const folder = mkdtempSync(join(tmpdir(), 'agent-office-sim-folder-'))
const env = { ...process.env, AGENT_OFFICE_USER_DATA: userData, AGENT_OFFICE_FAKE_VALIDATOR: '1', AGENT_OFFICE_FAKE_ENGINE: '1' }

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  page = await app.firstWindow()
  const accountId = await page.evaluate(async () => {
    const added = await window.office.addAccount('main', 'sk-ant-oat01-fake-ok')
    if (!('account' in added)) throw new Error(added.error)
    return added.account.id
  })
  await expect(page.locator('canvas')).toBeVisible()
  const started = await page.evaluate(({ accountId, folder }) => window.office.startChat(accountId, folder, 'Try the app [simulator]'), { accountId, folder })
  if (!('chatId' in started)) throw new Error(started.error)
})

test.afterAll(async () => {
  await app?.evaluate(({ dialog }) => Object.assign(dialog, { showMessageBox: async () => ({ response: 0, checkboxChecked: false }) }))
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
  rmSync(folder, { recursive: true, force: true })
})

test('an agent on the simulator gets a marker, and opening it shows the simulator tab with a real status', async () => {
  const chip = page.locator('.chip', { hasText: 'Try the app' })
  await expect(chip.locator('.sim')).toBeVisible()
  await chip.click()
  const drawer = page.getByRole('complementary', { name: 'Inbox' })
  await expect(drawer.getByRole('tab', { name: 'Simulator' })).toHaveAttribute('aria-selected', 'true')
  await expect(drawer.locator('.simv img, .simv .meta:not(:has-text("Connecting"))').first()).toBeVisible()
})
