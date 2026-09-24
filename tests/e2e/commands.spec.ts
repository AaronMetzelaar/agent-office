import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

const root = resolve(__dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'agent-office-commands-'))
const folder = mkdtempSync(join(tmpdir(), 'agent-office-commands-folder-'))
const claude = mkdtempSync(join(tmpdir(), 'agent-office-commands-claude-'))
const env = { ...process.env, AGENT_OFFICE_USER_DATA: userData, AGENT_OFFICE_FAKE_VALIDATOR: '1', AGENT_OFFICE_FAKE_ENGINE: '1', CLAUDE_CONFIG_DIR: claude }

let app: ElectronApplication
let page: Page

const drawer = () => page.getByRole('complementary', { name: 'Inbox' })
const picker = () => drawer().getByRole('listbox', { name: 'Commands and skills' })

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  mkdirSync(join(claude, 'skills', 'unslop'), { recursive: true })
  writeFileSync(join(claude, 'skills', 'unslop', 'SKILL.md'), '---\nname: unslop\ndescription: Cut AI tells\n---\n')
  app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  page = await app.firstWindow()
  const accountId = await page.evaluate(async () => {
    const added = await window.office.addAccount('main', 'sk-ant-oat01-fake-ok')
    if (!('account' in added)) throw new Error(added.error)
    return added.account.id
  })
  await expect(page.locator('canvas')).toBeVisible()
  const started = await page.evaluate(({ accountId, folder }) => window.office.startChat(accountId, folder, 'Tidy the bid flow'), { accountId, folder })
  if (!('chatId' in started)) throw new Error(started.error)
})

test.afterAll(async () => {
  await app?.evaluate(({ dialog }) => Object.assign(dialog, { showMessageBox: async () => ({ response: 0, checkboxChecked: false }) }))
  await app?.close()
  for (const dir of [userData, folder, claude]) rmSync(dir, { recursive: true, force: true })
})

test('typing / lists the chat’s commands, filters as you type, and Enter inserts one', async () => {
  await drawer().locator('.brow', { hasText: 'Tidy the bid flow' }).click()
  const message = drawer().getByLabel('Message')
  await message.fill('')
  await message.pressSequentially('/')
  await expect(picker().getByRole('option', { name: /\/compact/ })).toBeVisible()
  await message.pressSequentially('mws-p')
  await expect(picker().getByRole('option').first()).toContainText('/mws-pr')
  await message.press('Enter')
  await expect(message).toHaveValue('/mws-pr ')
  await expect(picker()).toBeHidden()
})

test('Esc closes the picker without leaving the chat', async () => {
  const message = drawer().getByLabel('Message')
  await message.pressSequentially('/co')
  await expect(picker()).toBeVisible()
  await message.press('Escape')
  await expect(picker()).toBeHidden()
  await expect(drawer().getByRole('heading', { name: 'Tidy the bid flow' })).toBeVisible()
})

test('Browse all opens the full list and inserts the chosen entry', async () => {
  await drawer().getByLabel('Message').fill('fix it')
  await drawer().getByRole('button', { name: '/ Commands' }).click()
  const dialog = page.getByRole('dialog', { name: 'Commands and skills' })
  await dialog.getByLabel('Search commands and skills').fill('review')
  await dialog.getByLabel('Search commands and skills').press('Enter')
  await expect(dialog).toBeHidden()
  await expect(drawer().getByLabel('Message')).toHaveValue('fix it /review ')
})

test('the new agent form offers the folder’s commands from the last session', async () => {
  await drawer().getByRole('button', { name: 'Back to inbox' }).click()
  await drawer().getByRole('button', { name: 'New agent', exact: true }).click()
  await drawer().getByLabel('Prompt').pressSequentially('/mws')
  await expect(picker().getByRole('option', { name: /\/mws-pr/ })).toBeVisible()
  await expect(drawer().getByText('from last session')).toBeVisible()
})
