import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

const root = resolve(__dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'agent-office-host-'))
const env = { ...process.env, AGENT_OFFICE_USER_DATA: userData, AGENT_OFFICE_FAKE_VALIDATOR: '1', AGENT_OFFICE_FAKE_ENGINE: '1', AGENT_OFFICE_INLINE_HOST: '' }
const hostPid = () => Number(readFileSync(join(userData, 'host.pid'), 'utf8'))
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function launch() {
  const app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  const page = await app.firstWindow()
  await expect.poll(() => page.evaluate(() => window.office.getHostStatus()), { timeout: 15_000 }).toEqual({ connected: true, updateReady: false })
  return { app, page }
}

const chat = (page: Page, id: string) => page.evaluate(async (chatId) => (await window.office.getSnapshot()).chats.find((view) => view.id === chatId), id)

test.afterAll(async () => {
  try {
    process.kill(hostPid(), 'SIGTERM')
    await expect.poll(() => alive(hostPid())).toBe(false)
  } catch {}
  rmSync(userData, { recursive: true, force: true })
})

test('a working chat keeps running in the agent host while the window app quits and relaunches', async () => {
  test.setTimeout(60_000)
  const first = await launch()
  const chatId = await first.page.evaluate(async (cwd) => {
    const added = await window.office.addAccount('main', 'sk-ant-oat01-fake-ok')
    if (!('account' in added)) throw new Error(added.error)
    const started = await window.office.startChat(added.account.id, cwd, 'Refactor everything [hang]')
    if (!('chatId' in started)) throw new Error(started.error)
    return started.chatId
  }, userData)
  await expect.poll(async () => (await chat(first.page, chatId))?.state).toBe('working')
  const sessionId = (await chat(first.page, chatId))?.sessionId
  const pid = hostPid()
  expect(pid).not.toBe(first.app.process().pid)

  const exited = new Promise((done) => first.app.process().once('exit', done))
  await first.app.evaluate(({ app }) => app.quit())
  await exited
  expect(alive(pid)).toBe(true)

  const second = await launch()
  expect(hostPid()).toBe(pid)
  const after = await chat(second.page, chatId)
  expect(after).toMatchObject({ state: 'working', sessionId })
  expect(after?.stuck).toBeUndefined()
  await second.app.close()
})
