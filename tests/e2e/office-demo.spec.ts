import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

declare global {
  interface Window {
    __fps: { sample(ms?: number, uncapped?: boolean): Promise<{ fps: number; size: [number, number] }> }
  }
}

const root = resolve(__dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'agent-office-demo-'))
const problems: string[] = []
let app: ElectronApplication
let page: Page

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(120_000)
  execFileSync('pnpm', ['exec', 'electron-vite', 'build', '--outDir', 'out-demo'], { cwd: root, env: { ...process.env, RENDERER_VITE_OFFICE_DEMO: '1' }, stdio: 'ignore' })
  app = await electron.launch({ args: ['--use-mock-keychain', join(root, 'out-demo/main/index.js')], env: { ...process.env, AGENT_OFFICE_USER_DATA: userData } })
  page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', (error) => problems.push(error.message))
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

test('the demo office renders its sections, signs and door queue', async () => {
  await expect(page.locator('canvas')).toBeVisible()
  for (const name of ['Marketplace', 'Mobile', 'Backend / infra', 'Side projects', 'PR reviews', 'Research gym', 'Lounge']) await expect(page.locator('.sign', { hasText: name })).toBeVisible()
  await expect(page.locator('.sign', { hasText: 'Admin' })).toBeHidden()
  await expect(page.getByRole('complementary', { name: 'Inbox' })).toContainText('Dialog flow CI fix')
  await expect(page.locator('.chip.q').first()).toBeVisible()
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
  await expect(page.getByText(new RegExp(`^Agent Office ${version.replaceAll('.', '\\.')} · [0-9a-f]{7}$`))).toBeVisible()
})

test('Admin unfolds when its first agent starts', async () => {
  await expect(page.locator('.sign', { hasText: 'Admin' })).toBeVisible({ timeout: 15_000 })
})

test('the scene holds at least 50fps at 1440×900 without console errors', async () => {
  const sample = await page.evaluate(() => window.__fps.sample(4000, true))
  expect(sample.size[0]).toBe(1440)
  expect(sample.fps).toBeGreaterThanOrEqual(50)
  expect(problems).toEqual([])
})
