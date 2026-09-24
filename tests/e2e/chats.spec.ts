import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import type { ChatPatchBatch } from '../../src/shared/chat'

declare global {
  interface Window {
    batches: ChatPatchBatch[]
  }
}

const root = resolve(__dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'agent-office-chats-'))
const env = { ...process.env, AGENT_OFFICE_USER_DATA: userData, AGENT_OFFICE_FAKE_VALIDATOR: '1', AGENT_OFFICE_FAKE_ENGINE: '1' }

async function launch() {
  const app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  const page = await app.firstWindow()
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true)
  return { app, page }
}

const chat = (page: Page, id: string) => page.evaluate(async (chatId) => (await window.office.getSnapshot()).chats.find((view) => view.id === chatId), id)

async function start(page: Page, prompt: string) {
  const result = await page.evaluate(({ cwd, prompt }) => window.office.startChat(window.accountId, cwd, prompt), { cwd: userData, prompt })
  if (!('chatId' in result)) throw new Error(result.error)
  return result.chatId
}

declare global {
  interface Window {
    accountId: string
  }
}

test.describe.configure({ mode: 'serial' })

test.afterAll(() => rmSync(userData, { recursive: true, force: true }))

let hungChat = ''

test('a chat streams patches to the renderer and goes Starting → Working → Done → Idle', async () => {
  const { app, page } = await launch()
  await page.evaluate(async () => {
    const added = await window.office.addAccount('main', 'sk-ant-oat01-fake-ok')
    if ('account' in added) window.accountId = added.account.id
    window.batches = []
    window.office.onChatPatches((batch) => window.batches.push(batch))
  })

  const id = await start(page, 'Fix the bid flow')
  await expect.poll(async () => (await chat(page, id))?.state).toBe('done')
  const streamed = await page.evaluate((chatId) => window.batches.flatMap((batch) => batch.patches).filter((patch) => patch.id === chatId && patch.partialAppend).map((patch) => patch.partialAppend).join(''), id)
  expect(streamed).toMatch(/^Sure/)
  expect((await chat(page, id))?.rows.map((row) => ('text' in row ? row.text : row.kind))).toEqual(['Fix the bid flow', 'Sure, done.'])

  await page.evaluate((chatId) => window.office.markRead(chatId), id)
  await expect.poll(async () => (await chat(page, id))?.state).toBe('idle')

  hungChat = await start(page, 'Refactor everything [hang]')
  await expect.poll(async () => (await chat(page, hungChat))?.state).toBe('working')

  const answerQuit = (response: number) =>
    app.evaluate(({ dialog }, answer) => {
      const state = globalThis as unknown as { asked: string[] }
      state.asked ??= []
      Object.assign(dialog, {
        showMessageBox: async (_win: unknown, options: { message: string }) => {
          state.asked.push(options.message)
          return { response: answer, checkboxChecked: false }
        },
      })
    }, response)
  const asked = () => app.evaluate(() => (globalThis as unknown as { asked: string[] }).asked)

  await answerQuit(1)
  await app.evaluate(({ app }) => app.quit())
  await expect.poll(asked).toEqual(['Agents are still working'])
  expect((await chat(page, hungChat))?.state).toBe('working')

  await answerQuit(0)
  const exited = new Promise((done) => app.process().once('exit', done))
  await app.evaluate(({ app }) => app.quit())
  await exited
})

test('after relaunch the interrupted chat is Stuck, and Resume continues it', async () => {
  const { app, page } = await launch()
  await expect.poll(async () => (await chat(page, hungChat))?.state).toBe('stuck')
  expect((await chat(page, hungChat))?.stuck).toEqual({ reason: 'interrupted' })
  const sessionId = (await chat(page, hungChat))?.sessionId
  expect(sessionId).toBeTruthy()

  await page.evaluate((chatId) => window.office.resumeChat(chatId), hungChat)
  await expect.poll(async () => (await chat(page, hungChat))?.state).toBe('done')
  expect((await chat(page, hungChat))?.sessionId).toBe(sessionId)
  await app.close()
})
