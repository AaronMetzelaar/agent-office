import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const root = resolve(__dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'agent-office-guard-'))
const { ELECTRON_RENDERER_URL: _devServer, ...inherited } = process.env
const env = { ...inherited, AGENT_OFFICE_USER_DATA: userData, AGENT_OFFICE_FAKE_VALIDATOR: '1', AGENT_OFFICE_FAKE_ENGINE: '1' }

test.afterAll(() => rmSync(userData, { recursive: true, force: true }))

test('the top bar shows headroom, and Pause all holds a working agent until Resume all', async () => {
  const app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  const page = await app.firstWindow()
  const accountId = await page.evaluate(async () => {
    const added = await window.office.addAccount('main', 'sk-ant-oat01-fake-ok')
    return 'account' in added ? added.account.id : ''
  })
  const started = await page.evaluate(({ accountId, cwd }) => window.office.startChat(accountId, cwd, 'Keep going [hang]'), { accountId, cwd: userData })
  if (!('chatId' in started)) throw new Error(started.error)
  const state = () => page.evaluate(async (id) => (await window.office.getSnapshot()).chats.find((chat) => chat.id === id), started.chatId)
  await expect.poll(async () => (await state())?.state).toBe('working')

  const headroom = page.getByRole('button', { name: 'Account headroom. Open Accounts' })
  await expect(headroom).toContainText('main')
  await expect(headroom).toContainText('81%')
  await expect(headroom).toHaveClass(/hot/)

  await page.getByRole('button', { name: 'Pause all' }).click()
  await expect(page.getByRole('button', { name: 'Paused · Resume all' })).toBeVisible()
  await expect.poll(async () => (await state())?.paused).toBe(true)
  expect((await state())?.state).toBe('idle')

  await page.getByRole('button', { name: 'Paused · Resume all' }).click()
  await expect(page.getByRole('button', { name: 'Pause all' })).toBeVisible()
  await expect.poll(async () => (await state())?.rows.some((row) => row.kind === 'user' && row.text === 'Continue where you left off.')).toBe(true)
  expect((await state())?.paused).toBeUndefined()
  await page.evaluate((id) => window.office.stopChat(id), started.chatId)
  await app.close()
})
