import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { ChatView } from '../../src/shared/chat'

interface MainGlobals {
  store: { view(id: string): ChatView | undefined }
}

const root = resolve(__dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'agent-office-chat-'))
const folder = mkdtempSync(join(tmpdir(), 'agent-office-chat-folder-'))
const env = { ...process.env, AGENT_OFFICE_USER_DATA: userData, AGENT_OFFICE_FAKE_VALIDATOR: '1', AGENT_OFFICE_FAKE_ENGINE: '1' }

let app: ElectronApplication
let page: Page
let chatId = ''

const drawer = () => page.getByRole('complementary', { name: 'Inbox' })
const snapshotChat = () => app.evaluate((_electron, id) => (globalThis as unknown as MainGlobals).store.view(id), chatId)

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
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
  chatId = started.chatId
  await expect.poll(async () => (await snapshotChat())?.state).toBe('done')
})

test.afterAll(async () => {
  await app?.evaluate(({ dialog }) => Object.assign(dialog, { showMessageBox: async () => ({ response: 0, checkboxChecked: false }) }))
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
  rmSync(folder, { recursive: true, force: true })
})

test('opening a chat shows its transcript, and a draft survives leaving and coming back', async () => {
  await drawer().locator('.brow', { hasText: 'Tidy the bid flow' }).click()
  await expect(drawer().getByRole('heading', { name: 'Tidy the bid flow' })).toBeVisible()
  const transcript = drawer().getByRole('log', { name: 'Transcript' })
  await expect(transcript.locator('.ur')).toHaveText('Tidy the bid flow')
  await expect(transcript.locator('.md')).toHaveText('Sure, done.')
  await expect(drawer().getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true')

  await drawer().getByLabel('Message').fill('half a thought')
  await drawer().getByRole('button', { name: 'Back to inbox' }).click()
  await expect(drawer().getByRole('heading', { name: /^Waiting for you/ })).toBeVisible()
  await drawer().locator('.standby summary').click()
  await drawer().locator('.standby .brow', { hasText: 'Tidy the bid flow' }).click()
  await expect(drawer().getByLabel('Message')).toHaveValue('half a thought')
})

test('send, then stop the turn', async () => {
  await drawer().getByLabel('Message').fill('Keep going [hang]')
  await drawer().getByLabel('Message').press('Meta+Enter')
  await expect.poll(async () => (await snapshotChat())?.state).toBe('working')
  await expect(drawer().getByLabel('Message')).toHaveValue('')
  await expect(drawer().getByRole('log', { name: 'Transcript' }).locator('.ur').last()).toHaveText('Keep going [hang]')

  await drawer().getByRole('button', { name: 'Stop' }).click()
  await expect.poll(async () => (await snapshotChat())?.state).not.toBe('working')
  await expect(drawer().getByRole('button', { name: 'Stop' })).toHaveCount(0)
})

test('change effort; it applies from the next turn', async () => {
  await drawer().getByRole('radio', { name: 'High', exact: true }).click()
  await expect.poll(async () => (await snapshotChat())?.effort).toBe('high')
  await expect(drawer().getByRole('radio', { name: 'High', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(drawer().getByRole('status')).toHaveText('High effort applies from the next turn.')

  await drawer().getByLabel('Model').selectOption('sonnet')
  await expect.poll(async () => (await snapshotChat())?.model).toBe('sonnet')
})

test('plan mode: approve the plan, and the chat returns to the mode it was in', async () => {
  await drawer().getByRole('button', { name: 'Plan', exact: true }).click()
  await expect.poll(async () => (await snapshotChat())?.permissionMode).toBe('plan')
  await expect(drawer().locator('.comp .mode')).toHaveText('Plan mode')

  await drawer().getByLabel('Message').fill('Plan the rounding fix [plan]')
  await drawer().getByRole('button', { name: /^Send/ }).click()
  const card = drawer().getByRole('group', { name: 'Plan ready for review' })
  await expect(card).toBeVisible()
  await expect(card.locator('h2')).toHaveText('Plan')
  await expect(card.locator('code')).toHaveText('BidFlow.vue')
  await expect(drawer().locator('.denynote')).toBeVisible()
  await expect(drawer().getByRole('button', { name: /^Deny and send/ })).toBeVisible()

  await card.getByRole('button', { name: /^Approve plan/ }).click()
  await expect(card).toHaveCount(0)
  await expect(drawer().getByRole('log', { name: 'Transcript' })).toContainText('Plan approved, starting.')
  await expect.poll(async () => (await snapshotChat())?.permissionMode).toBe('auto')
  await expect(drawer().locator('.comp .mode')).toHaveText('Auto mode')
})
