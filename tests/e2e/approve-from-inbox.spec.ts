import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { ChatView } from '../../src/shared/chat'

interface Note {
  title: string
  body: string
  actions: { text: string }[]
  emit(event: string, ...args: unknown[]): void
}

interface MainGlobals {
  tray: Electron.Tray
  store: { view(id: string): ChatView | undefined; views(): ChatView[] }
  notifier: { live: Map<string, Note> }
  phone: { available: boolean }
  kept?: Note
}

const root = resolve(__dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'agent-office-inbox-'))
const folder = mkdtempSync(join(tmpdir(), 'agent-office-folder-'))
const env = { ...process.env, AGENT_OFFICE_USER_DATA: userData, AGENT_OFFICE_FAKE_VALIDATOR: '1', AGENT_OFFICE_FAKE_ENGINE: '1' }

let app: ElectronApplication
let page: Page
let accountId = ''

const trayTitle = () => app.evaluate(() => (globalThis as unknown as MainGlobals).tray.getTitle())
const notes = () => app.evaluate(() => [...(globalThis as unknown as MainGlobals).notifier.live].map(([key, note]) => ({ key, title: note.title, body: note.body, actions: note.actions.map((action) => action.text) })))
const snapshotChat = (id: string) => app.evaluate((_electron, chatId) => (globalThis as unknown as MainGlobals).store.view(chatId), id)
const drawer = () => page.getByRole('complementary', { name: 'Inbox' })

async function start(prompt: string) {
  const result = await page.evaluate(({ accountId, folder, prompt }) => window.office.startChat(accountId, folder, prompt), { accountId, folder, prompt })
  if (!('chatId' in result)) throw new Error(result.error)
  await expect.poll(async () => (await snapshotChat(result.chatId))?.state).toBe('needs-you')
  return { id: result.chatId, request: (await snapshotChat(result.chatId))!.pendingRequests[0]! }
}

async function focusWindow() {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!
    win.isFocused = () => true
  })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  page = await app.firstWindow()
  accountId = await page.evaluate(async () => {
    const added = await window.office.addAccount('main', 'sk-ant-oat01-fake-ok')
    if (!('account' in added)) throw new Error(added.error)
    return added.account.id
  })
  await app.evaluate(({ dialog }, picked) => {
    Object.assign(dialog, { showOpenDialog: async () => ({ canceled: false, filePaths: [picked] }) })
  }, folder)
  await expect(page.locator('canvas')).toBeVisible()
  expect(await app.evaluate(() => (globalThis as unknown as MainGlobals).phone.available)).toBe(false)
})

test.afterAll(async () => {
  await app?.evaluate(({ dialog }) => Object.assign(dialog, { showMessageBox: async () => ({ response: 0, checkboxChecked: false }) }))
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
  rmSync(folder, { recursive: true, force: true })
})

test('⌘N quick start runs a chat in the chosen folder and account; Allow in the inbox resolves it, the agent walks back and the tray count drops', async () => {
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('new-agent')?.click())
  await expect(drawer().getByRole('heading', { name: 'New agent' })).toBeVisible()
  await drawer().getByRole('button', { name: 'Choose…' }).click()
  await expect(drawer().getByLabel('Folder')).toHaveValue(folder)
  await expect(drawer().getByLabel('Account')).toHaveValue(accountId)
  await drawer().getByLabel('Prompt').fill('Run the tests [ask]')
  await drawer().getByLabel('Effort').selectOption('high')

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!
    win.isFocused = () => false
  })
  const notified = app.evaluate(async () => {
    const started = Date.now()
    const live = (globalThis as unknown as MainGlobals).notifier.live
    while (![...live.values()].some((note) => note.body.startsWith('Auto mode wants to'))) {
      if (Date.now() - started > 5000) return Infinity
      await new Promise((done) => setTimeout(done, 5))
    }
    return Date.now() - started
  })
  await drawer().getByRole('button', { name: 'Start agent' }).click()
  expect(await notified).toBeLessThan(1000)

  const chat = (await app.evaluate(() => (globalThis as unknown as MainGlobals).store.views()))[0]!
  expect(chat).toMatchObject({ cwd: folder, accountId, effort: 'high', state: 'needs-you' })
  await expect(drawer().getByRole('heading', { name: 'Run the tests [ask]' })).toBeVisible()
  await expect(drawer().locator('.ask .cmd')).toHaveText('$ pnpm test')
  await expect(page.locator('.chip.q', { hasText: 'Run the tests [ask]' })).toBeVisible()
  expect(await trayTitle()).toBe('1')
  expect(await notes()).toEqual([{ key: chat.pendingRequests[0]!.id, title: 'Run the tests [ask]', body: 'Auto mode wants to run: pnpm test', actions: ['Allow once', 'Deny', 'Open'] }])

  await page.keyboard.press('Escape')
  await expect(drawer().getByRole('heading', { name: 'Waiting for you · 1' })).toBeVisible()
  const item = drawer().locator('.qi', { hasText: 'Run the tests [ask]' })
  await expect(item.locator('.cmd')).toHaveText('$ pnpm test')
  await item.getByRole('button', { name: 'Allow', exact: true }).click()

  await expect.poll(async () => (await snapshotChat(chat.id))?.state).toBe('done')
  await expect(drawer().getByRole('heading', { name: 'Waiting for you · 0' })).toBeVisible()
  await expect(page.locator('.chip.q')).toHaveCount(0)
  await expect.poll(trayTitle).toBe('')
  expect((await notes()).map((note) => note.title)).toEqual(['Run the tests [ask] is done'])

  await drawer().locator('.brow', { hasText: 'Run the tests [ask]' }).click()
  await expect(drawer().getByRole('log', { name: 'Transcript' })).toContainText('Sure, done.')
  await expect.poll(async () => (await snapshotChat(chat.id))?.state).toBe('idle')
  await drawer().getByLabel('Message').fill('Thanks [hang]')
  await drawer().getByRole('button', { name: /^Send/ }).click()
  await expect.poll(async () => (await snapshotChat(chat.id))?.state).toBe('working')
  await page.getByRole('button', { name: 'Back to inbox' }).click()
})

test('1 with no chat open shows the first card and 1 again allows it; j and k step through the queue; Esc returns to the inbox', async () => {
  const first = await start('First in line [ask]')
  const second = await start('Second in line [ask]')
  await focusWindow()

  await page.keyboard.press('1')
  await expect(drawer().getByRole('heading', { name: 'First in line [ask]' })).toBeVisible()
  await expect(drawer().locator('.ask')).toContainText('pnpm test')
  expect((await snapshotChat(first.id))?.state).toBe('needs-you')

  await page.keyboard.press('j')
  await expect(drawer().getByRole('heading', { name: 'Second in line [ask]' })).toBeVisible()
  await page.keyboard.press('j')
  await expect(drawer().getByRole('heading', { name: 'Second in line [ask]' })).toBeVisible()
  await page.keyboard.press('k')
  await expect(drawer().getByRole('heading', { name: 'First in line [ask]' })).toBeVisible()

  await page.keyboard.press('1')
  await expect.poll(async () => (await snapshotChat(first.id))?.state).not.toBe('needs-you')
  expect((await snapshotChat(first.id))?.rows.some((row) => row.kind === 'text' && row.text === 'Tests pass.')).toBe(true)

  await page.keyboard.press('Escape')
  await expect(drawer().getByRole('heading', { name: 'Waiting for you · 1' })).toBeVisible()
  await page.locator('.chip', { hasText: 'Second in line [ask]' }).click()
  await expect(drawer().getByRole('heading', { name: 'Second in line [ask]' })).toBeVisible()
  await page.keyboard.press('3')
  await expect.poll(async () => (await snapshotChat(second.id))?.rows.some((row) => row.kind === 'text' && row.text === 'Skipped the tests.')).toBe(true)
  await page.keyboard.press('Escape')
})

test('a dangerous request ignores 1, 2 and 3, and neither the inbox nor the notification offers Allow', async () => {
  const { id, request } = await start('Clean the build [danger]')
  expect(request).toMatchObject({ summary: 'rm -rf dist', dangerous: true })
  expect((await notes()).find((note) => note.key === request.id)?.actions).toEqual(['Deny', 'Open'])
  const item = drawer().locator('.qi', { hasText: 'Clean the build [danger]' })
  await expect(item.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0)
  await expect(item.getByRole('button', { name: 'Open' })).toBeVisible()
  await expect(item.locator('.why')).toContainText('rm -rf')

  await focusWindow()
  await page.keyboard.press('1')
  await expect(drawer().getByRole('heading', { name: 'Clean the build [danger]' })).toBeVisible()
  for (const key of ['1', '2', '3']) await page.keyboard.press(key)
  await page.waitForTimeout(300)
  expect((await snapshotChat(id))?.state).toBe('needs-you')

  await drawer().locator('.ask').getByRole('button', { name: /^Allow once/ }).click()
  await expect.poll(async () => (await snapshotChat(id))?.state).not.toBe('needs-you')
  await page.keyboard.press('Escape')
})

test('a notification action for a request already answered in the app does nothing and shows no duplicate', async () => {
  const { id, request } = await start('Answered twice [ask]')
  await app.evaluate((_electron, requestId) => {
    const globals = globalThis as unknown as MainGlobals
    globals.kept = globals.notifier.live.get(requestId)
  }, request.id)
  await drawer().locator('.qi', { hasText: 'Answered twice [ask]' }).getByRole('button', { name: 'Allow', exact: true }).click()
  await expect.poll(async () => (await snapshotChat(id))?.state).toBe('done')

  await app.evaluate(() => (globalThis as unknown as MainGlobals).kept?.emit('action', { actionIndex: 1 }, 1))
  await page.waitForTimeout(200)
  const chat = await snapshotChat(id)
  expect(chat?.state).toBe('done')
  expect(chat?.rows.some((row) => row.kind === 'text' && row.text === 'Tests pass.')).toBe(true)
  expect((await notes()).filter((note) => note.key === request.id)).toEqual([])
})
