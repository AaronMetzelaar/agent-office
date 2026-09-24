import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { line, writeTranscript } from '../fakes/outside'

const root = resolve(__dirname, '../..')
const scratch = mkdtempSync(join(tmpdir(), 'agent-office-search-'))
const claudeDir = join(scratch, 'claude')
const repo = join(scratch, 'repo')
mkdirSync(repo, { recursive: true })
writeTranscript(claudeDir, randomUUID(), [line.user('Why do marzipan bids round twice?'), line.text('The formatter rounds the marzipan price again.')], { cwd: repo, entrypoint: 'cli', at: Date.now() - 40 * 24 * 60 * 60_000 })

const { ELECTRON_RENDERER_URL: _devServer, ...inherited } = process.env
const env = {
  ...inherited,
  AGENT_OFFICE_USER_DATA: join(scratch, 'user-data'),
  AGENT_OFFICE_FAKE_VALIDATOR: '1',
  AGENT_OFFICE_FAKE_ENGINE: '1',
  AGENT_OFFICE_CONFIG_DIR: join(scratch, 'config'),
  AGENT_OFFICE_DESKTOP_DIR: join(scratch, 'desktop'),
  CLAUDE_CONFIG_DIR: claudeDir,
}

test.afterAll(() => rmSync(scratch, { recursive: true, force: true }))

test('⌘K finds a word inside an old terminal chat and opens its transcript read-only', async () => {
  const app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  const page = await app.firstWindow()
  await page.evaluate(() => window.office.addAccount('main', 'sk-ant-oat01-fake-ok'))
  await expect(page.getByRole('button', { name: /Search/ })).toBeVisible()

  await page.keyboard.press('Meta+K')
  await page.getByRole('textbox', { name: 'Search' }).fill('marzip')
  const hit = page.locator('.pr.hit', { hasText: 'Why do marzipan bids round twice?' })
  await expect(hit).toBeVisible()
  await expect(hit.locator('mark')).toHaveText('marzipan')
  await hit.click()

  const panel = page.locator('.chatp')
  await expect(panel.locator('h2')).toHaveText('Why do marzipan bids round twice?')
  await expect(panel.getByText('The formatter rounds the marzipan price again.')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Move into the office' })).toBeVisible()
  await app.close()
})
