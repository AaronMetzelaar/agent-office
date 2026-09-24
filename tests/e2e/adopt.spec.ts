import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { line, writeDesktopChat, writeTranscript } from '../fakes/outside'

const root = resolve(__dirname, '../..')
const scratch = mkdtempSync(join(tmpdir(), 'agent-office-adopt-'))
const claudeDir = join(scratch, 'claude')
const configDir = join(scratch, 'config')
const repo = join(scratch, 'repo')
const sessionId = randomUUID()
mkdirSync(repo, { recursive: true })
const transcript = writeTranscript(claudeDir, sessionId, [line.user('Fix the bid rounding'), line.text('Rounded to cents.')], { cwd: repo, at: Date.now() - 60_000 })
writeDesktopChat(join(scratch, 'desktop'), 'Claude', { cliSessionId: sessionId, title: 'Fix the bid rounding', cwd: repo, lastActivityAt: Date.now() - 60_000, lastFocusedAt: Date.now() })

const env = {
  ...process.env,
  AGENT_OFFICE_USER_DATA: join(scratch, 'user-data'),
  AGENT_OFFICE_FAKE_VALIDATOR: '1',
  AGENT_OFFICE_FAKE_ENGINE: '1',
  AGENT_OFFICE_CONFIG_DIR: configDir,
  AGENT_OFFICE_DESKTOP_DIR: join(scratch, 'desktop'),
  CLAUDE_CONFIG_DIR: claudeDir,
}

test.describe.configure({ mode: 'serial' })
test.afterAll(() => rmSync(scratch, { recursive: true, force: true }))

async function launch(): Promise<{ app: ElectronApplication; page: Page; accountId: string }> {
  const app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  const page = await app.firstWindow()
  const accountId = await page.evaluate(async () => {
    const listed = await window.office.listAccounts()
    if (listed[0]) return listed[0].id
    const added = await window.office.addAccount('main', 'sk-ant-oat01-fake-ok')
    return 'account' in added ? added.account.id : ''
  })
  await app.evaluate(({ dialog }) => Object.assign(dialog, { showMessageBox: async () => ({ response: 0, checkboxChecked: false }) }))
  return { app, page, accountId }
}

const chat = (page: Page, id: string) => page.evaluate(async (chatId) => (await window.office.getSnapshot()).chats.find((view) => view.id === chatId), id)

test('a desktop chat shows up read-only and moves into the office as a fork, leaving the original untouched', async () => {
  const { app, page, accountId } = await launch()
  await expect.poll(async () => (await chat(page, sessionId))?.accountId).toBe(accountId)
  expect(await chat(page, sessionId)).toMatchObject({ visitor: 'desktop', title: 'Fix the bid rounding', state: 'idle' })

  await page.evaluate((id) => window.office.sendMessage(id, 'Should be ignored'), sessionId)
  expect((await chat(page, sessionId))?.rows).toEqual([])

  const before = readFileSync(transcript, 'utf8')
  const moved = await page.evaluate((id) => window.office.moveIntoOffice(id), sessionId)
  if (!moved || !('chatId' in moved)) throw new Error(`move failed: ${JSON.stringify(moved)}`)
  await expect.poll(async () => (await chat(page, sessionId))?.moved).toBe(true)
  expect(await chat(page, moved.chatId)).toMatchObject({ accountId, sessionId, forkPending: true, state: 'idle' })

  await page.evaluate((id) => window.office.setOpenChat(id), moved.chatId)
  await expect.poll(async () => (await chat(page, moved.chatId))?.rows.flatMap((row) => ('text' in row ? [row.text] : []))).toEqual(['Fix the bid rounding', 'Rounded to cents.'])

  await page.evaluate((id) => window.office.sendMessage(id, 'Now add a test'), moved.chatId)
  await expect.poll(async () => (await chat(page, moved.chatId))?.state).toBe('done')
  const adopted = await chat(page, moved.chatId)
  expect(adopted?.sessionId).not.toBe(sessionId)
  expect(adopted?.forkPending).toBe(false)
  expect(readFileSync(transcript, 'utf8')).toBe(before)
  await app.close()
})

test('Settings installs the hook into the configured settings file, and hook events drive a visitor', async () => {
  const { app, page } = await launch()
  const installed = await page.evaluate(() => window.office.installHook())
  expect(installed).toMatchObject({ outsideChats: true })
  const settings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'))
  expect(settings.hooks.Notification[0].hooks[0].command).toContain(configDir)

  const endpoint = readFileSync(join(configDir, 'hook.curlrc'), 'utf8')
  const port = Number(/127\.0\.0\.1:(\d+)/.exec(endpoint)?.[1])
  const secret = /Secret: ([0-9a-f]+)/.exec(endpoint)?.[1] ?? ''
  const terminalId = randomUUID()
  writeTranscript(claudeDir, terminalId, [line.user('Refactor the tray strip')], { cwd: repo, entrypoint: 'cli' })
  const status = await new Promise<number>((done) => {
    const req = request({ host: '127.0.0.1', port, path: '/hook', method: 'POST', headers: { 'content-type': 'application/json', 'x-agent-office-secret': secret } }, (response) => {
      response.resume()
      done(response.statusCode ?? 0)
    })
    req.end(JSON.stringify({ session_id: terminalId, hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt', cwd: repo }))
  })
  expect(status).toBe(204)
  await expect.poll(async () => (await chat(page, terminalId))?.state).toBe('needs-you')
  expect(await chat(page, terminalId)).toMatchObject({ visitor: 'terminal', accountId: 'unknown', title: 'Refactor the tray strip' })

  expect(await page.evaluate(() => window.office.uninstallHook())).toMatchObject({ outsideChats: false })
  expect(JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'))).toEqual({})
  await app.close()
})
