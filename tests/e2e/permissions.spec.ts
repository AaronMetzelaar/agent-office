import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

const root = resolve(__dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'agent-office-permissions-'))
const env = { ...process.env, AGENT_OFFICE_USER_DATA: userData, AGENT_OFFICE_FAKE_VALIDATOR: '1', AGENT_OFFICE_FAKE_ENGINE: '1' }

test.afterAll(() => rmSync(userData, { recursive: true, force: true }))

const chat = (page: Page, id: string) => page.evaluate(async (chatId) => (await window.office.getSnapshot()).chats.find((view) => view.id === chatId), id)

async function askingChat(page: Page, accountId: string) {
  const result = await page.evaluate(({ accountId, cwd }) => window.office.startChat(accountId, cwd, 'Run the tests [ask]'), { accountId, cwd: userData })
  if (!('chatId' in result)) throw new Error(result.error)
  await expect.poll(async () => (await chat(page, result.chatId))?.state).toBe('needs-you')
  return { id: result.chatId, request: (await chat(page, result.chatId))!.pendingRequests[0]! }
}

test('a permission request is answered once over IPC, and an Always allow rule can be listed and revoked', async () => {
  const app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  const page = await app.firstWindow()
  const accountId = await page.evaluate(async () => {
    const added = await window.office.addAccount('main', 'sk-ant-oat01-fake-ok')
    if (!('account' in added)) throw new Error(added.error)
    return added.account.id
  })

  const first = await askingChat(page, accountId)
  expect(first.request).toMatchObject({ tool: 'Bash', summary: 'pnpm test', dangerous: false, alwaysAllow: true })
  const answer = (source: string, kind = 'allow') => page.evaluate(({ requestId, source, kind }) => window.office.resolveRequest(requestId, { kind } as never, source as never), { requestId: first.request.id, source, kind })
  expect(await answer('notification')).toEqual({ error: 'Unknown request.' })
  expect(await answer('inbox')).toEqual({ ok: true })
  expect(await answer('chat', 'deny')).toEqual({ error: 'already answered (inbox)' })
  await expect.poll(async () => (await chat(page, first.id))?.state).toBe('done')
  expect((await chat(page, first.id))?.rows.map((row) => ('text' in row ? row.text : row.kind))).toEqual(['Run the tests [ask]', 'Tests pass.', 'Sure, done.'])

  const second = await askingChat(page, accountId)
  expect(await page.evaluate((requestId) => window.office.resolveRequest(requestId, { kind: 'always' }, 'chat'), second.request.id)).toEqual({ ok: true })
  await expect.poll(async () => (await chat(page, second.id))?.state).toBe('done')
  const rules = await page.evaluate(() => window.office.listRules())
  expect(rules).toMatchObject([{ accountId, rule: 'Bash(pnpm test)' }])

  await page.evaluate((id) => window.office.revokeRule(id), rules[0]!.id)
  expect(await page.evaluate(() => window.office.listRules())).toEqual([])
  await app.close()
})
