import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ChatView } from '../../src/shared/chat'

const root = resolve(__dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'agent-office-review-'))
const repo = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-review-repo-')))
const env = { ...process.env, AGENT_OFFICE_USER_DATA: userData, AGENT_OFFICE_FAKE_VALIDATOR: '1', AGENT_OFFICE_FAKE_ENGINE: '1' }
const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=office@test', '-c', 'user.name=office', ...args], { cwd: repo, stdio: 'ignore' })

test.afterAll(() => {
  rmSync(userData, { recursive: true, force: true })
  rmSync(repo, { recursive: true, force: true })
})

test('the Review tab shows the empty states, then the diff after the next Stop', async () => {
  writeFileSync(join(repo, 'BidFlow.vue'), '<template>\n  <p>{{ bid }}</p>\n</template>\n')
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  git('checkout', '-q', '-b', 'bid-rounding')

  const app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  const page = await app.firstWindow()
  const view = (id: string) => app.evaluate((_electron, chatId) => (globalThis as unknown as { store: { view(id: string): ChatView | undefined } }).store.view(chatId), id)
  const started = await page.evaluate(async (cwd) => {
    const added = await window.office.addAccount('main', 'sk-ant-oat01-fake-ok')
    if (!('account' in added)) throw new Error(added.error)
    return window.office.startChat(added.account.id, cwd, 'Round the bids')
  }, repo)
  if (!('chatId' in started)) throw new Error(started.error)
  await expect.poll(async () => (await view(started.chatId))?.state).toBe('done')

  const drawer = page.getByRole('complementary', { name: 'Inbox' })
  await drawer.locator('.brow', { hasText: 'Round the bids' }).click()
  await drawer.getByRole('tab', { name: 'Review' }).click()
  await expect(drawer.getByText('No changes yet')).toBeVisible()
  await expect(drawer.getByText('Not pushed')).toBeVisible()
  await expect(drawer.locator('.rv code')).toHaveText('bid-rounding')

  writeFileSync(join(repo, 'BidFlow.vue'), '<template>\n  <p>{{ Math.round(bid) }}</p>\n</template>\n')
  writeFileSync(join(repo, 'round.ts'), 'export const round = (n: number) => Math.round(n)\n')
  await drawer.getByLabel('Message').fill('Round to whole euros')
  await drawer.getByLabel('Message').press('Meta+Enter')

  const files = drawer.getByRole('region', { name: 'Changed files' })
  await expect(files.locator('.sum')).toContainText('2 files · +2 −1')
  await expect(files.locator('.ft')).toHaveText(['MBidFlow.vue+1 −1', 'Around.ts+1 −0'])
  await files.getByRole('button', { name: /BidFlow\.vue/ }).first().click()
  await expect(files.locator('.ln.del .tx')).toHaveText('−  <p>{{ bid }}</p>')
  await expect(files.locator('.ln.add .tx')).toHaveText('+  <p>{{ Math.round(bid) }}</p>')
  await expect(files.getByRole('button', { name: 'Open BidFlow.vue at line 2' })).toBeVisible()
  await expect(drawer.getByRole('status').filter({ hasText: /gh|GitHub/ })).toBeVisible()

  await app.evaluate(({ dialog }) => Object.assign(dialog, { showMessageBox: async () => ({ response: 0, checkboxChecked: false }) }))
  await app.close()
})
