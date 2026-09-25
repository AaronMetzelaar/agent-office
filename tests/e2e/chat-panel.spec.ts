import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { ChatView } from '../../src/shared/chat'

interface MainGlobals {
  store: { view(id: string): ChatView | undefined }
  fakeEngine: { sent: { text: string; images?: unknown[] }[]; emit(chatId: string, message: unknown): void }
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
  await drawer().locator('.standby summary', { hasText: 'Standby' }).click({ position: { x: 12, y: 12 } })
  await drawer().locator('.standby .brow', { hasText: 'Tidy the bid flow' }).click()
  await expect(drawer().getByLabel('Message')).toHaveValue('half a thought')
})

test('send, then stop the turn', async () => {
  await drawer().getByLabel('Message').fill('Keep going')
  await drawer().getByLabel('Message').press('Shift+Enter')
  await expect(drawer().getByLabel('Message')).toHaveValue('Keep going\n')
  await drawer().getByLabel('Message').fill('Keep going [hang]')
  await drawer().getByLabel('Message').press('Enter')
  await expect.poll(async () => (await snapshotChat())?.state).toBe('working')
  await expect(drawer().getByLabel('Message')).toHaveValue('')
  await expect(drawer().getByRole('log', { name: 'Transcript' }).locator('.ur').last()).toHaveText('Keep going [hang]')

  await drawer().getByRole('button', { name: 'Stop' }).click()
  await expect.poll(async () => (await snapshotChat())?.state).not.toBe('working')
  await expect(drawer().getByRole('button', { name: 'Stop' })).toHaveCount(0)
})

test('attach an image, send it, then click a path in the reply to preview it', async () => {
  const png = join(folder, 'dot.png')
  writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
  await drawer().locator('.comp input[type=file]').setInputFiles(png)
  await expect(drawer().locator('.comp .atts li')).toHaveText(/dot\.png/)
  await drawer().getByLabel('Message').fill('What is this?')
  await drawer().getByLabel('Message').press('Enter')
  await expect(drawer().locator('.comp .atts')).toHaveCount(0)
  const last = await app.evaluate(() => (globalThis as unknown as MainGlobals).fakeEngine.sent.at(-1))
  expect(last?.text).toBe('What is this?\n\nAttached:\n- [image: dot.png]')
  expect(last?.images).toHaveLength(1)
  await expect.poll(async () => (await snapshotChat())?.state).not.toBe('working')

  await app.evaluate((_electron, { id, text }) => {
    const globals = globalThis as unknown as MainGlobals
    globals.fakeEngine.emit(id, { type: 'assistant', uuid: 'e2e-preview', session_id: 'fake', parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } })
  }, { id: chatId, text: `Saved it to ${png}.` })
  await drawer().getByRole('button', { name: png }).click()
  const preview = page.getByRole('region', { name: 'File preview' })
  await expect(preview.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/)
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(drawer().getByRole('heading', { name: 'Tidy the bid flow' })).toBeVisible()
})

test('run a shell code block from the reply in a terminal next to the chat', async () => {
  await app.evaluate((_electron, { id, text }) => {
    const globals = globalThis as unknown as MainGlobals
    globals.fakeEngine.emit(id, { type: 'assistant', uuid: 'e2e-run', session_id: 'fake', parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } })
  }, { id: chatId, text: 'Try this:\n\n```sh\necho "from $(basename $PWD)"\n```' })
  const block = drawer().locator('.md .code').last()
  await block.hover()
  await block.getByRole('button', { name: 'Run in terminal' }).click()
  const terminal = page.getByRole('region', { name: 'Terminal' })
  await expect(terminal).toContainText('echo "from $(basename $PWD)"')
  await expect(terminal.locator('.xterm-rows')).toContainText(`from ${folder.split('/').pop()}`)
  await terminal.getByRole('button', { name: 'Close terminal' }).click()
  await expect(terminal).toHaveCount(0)
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
