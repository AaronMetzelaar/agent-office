import { randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

const root = resolve(__dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'agent-office-onboarding-'))
const env = { ...process.env, AGENT_OFFICE_USER_DATA: userData, AGENT_OFFICE_FAKE_VALIDATOR: '1' }
const mainToken = `sk-ant-oat01-fake-ok-${randomUUID()}`
const researchToken = `sk-ant-oat01-fake-ok-${randomUUID()}`
const rejectedToken = `sk-ant-oat01-rejected-${randomUUID()}`
const output: string[] = []
const rendererState: string[] = []

async function launch() {
  const app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  app.process().stdout?.on('data', (chunk) => output.push(String(chunk)))
  app.process().stderr?.on('data', (chunk) => output.push(String(chunk)))
  const page = await app.firstWindow()
  page.on('console', (message) => output.push(message.text()))
  return { app, page }
}

async function captureRendererState(page: Page) {
  rendererState.push(
    await page.content(),
    await page.evaluate(async () =>
      JSON.stringify({
        inputs: [...document.querySelectorAll('input')].map((input) => input.value),
        local: { ...localStorage },
        session: { ...sessionStorage },
        accounts: await window.office.listAccounts(),
      }),
    ),
  )
}

test.describe.configure({ mode: 'serial' })

test.afterAll(() => rmSync(userData, { recursive: true, force: true }))

test('first run keeps the office behind onboarding until a token validates', async () => {
  const { app, page } = await launch()
  const heading = page.getByRole('heading', { name: 'Connect a Claude account' })
  await expect(heading).toBeVisible()
  await expect(page.getByText('claude setup-token')).toBeVisible()
  await expect(page.getByText('It lasts one year.')).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(page.getByLabel('Token')).toHaveAttribute('type', 'password')

  await page.getByLabel('Label').fill('main')
  await page.getByLabel('Token').fill(rejectedToken)
  await page.getByRole('button', { name: 'Add account' }).click()
  await expect(page.getByRole('alert')).toContainText('rejected this token (401)')
  await expect(page.getByLabel('Token')).toHaveValue('')
  await expect(page.locator('canvas')).toHaveCount(0)
  await captureRendererState(page)

  await page.getByLabel('Token').fill(mainToken)
  await page.getByRole('button', { name: 'Add account' }).click()
  await expect(page.locator('canvas')).toBeVisible()
  await expect(heading).toHaveCount(0)
  await captureRendererState(page)
  await app.close()
})

test('settings opens Accounts, shows headroom and adds the second account without leaving the office', async () => {
  const { app, page } = await launch()
  await expect(page.locator('canvas')).toBeVisible()
  await page.locator('canvas').evaluate((canvas) => (canvas.dataset.marker = 'kept'))

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Accounts' }).click()
  const drawer = page.getByRole('complementary', { name: 'Accounts' })
  const main = drawer.locator('[data-account="main"]')
  await expect(main).toContainText('OK')

  await main.getByRole('button', { name: 'Check now' }).click()
  await expect(main).toContainText('OK')
  await expect(main.getByRole('meter')).toHaveCount(2)
  await expect(main).toContainText('5-hour 42%')
  await expect(main).toContainText('Weekly 81%')

  await expect(drawer.getByLabel('Label')).toHaveValue('work')
  await drawer.getByLabel('Label').fill('research')
  await drawer.getByLabel('Token').fill(researchToken)
  await drawer.getByRole('button', { name: 'Add account' }).click()
  await expect(drawer.locator('[data-account="research"]')).toContainText('OK')
  await expect(page.locator('canvas[data-marker="kept"]')).toHaveCount(1)
  await captureRendererState(page)
  await app.close()
})

test('a restart keeps both accounts and their last health, listing only labels and health', async () => {
  const { app, page } = await launch()
  await expect(page.locator('canvas')).toBeVisible()
  const accounts = await page.evaluate(() => window.office.listAccounts())
  expect(accounts.map(({ label, health }) => ({ label, status: health.status }))).toEqual([
    { label: 'main', status: 'ok' },
    { label: 'research', status: 'ok' },
  ])
  expect(Object.keys(accounts[0] ?? {}).sort()).toEqual(['createdAt', 'health', 'id', 'label'])
  await captureRendererState(page)
  await app.close()
})

test('no token substring reaches the data folder, logs or renderer state', () => {
  const files = readdirSync(userData, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
  const onDisk = files.map((entry) => readFileSync(join(entry.parentPath, entry.name)).toString('latin1'))
  const haystack = [...onDisk, ...output, ...rendererState].join('\n')
  expect(files.some((entry) => entry.parentPath.endsWith('secrets'))).toBe(true)
  for (const token of [mainToken, researchToken, rejectedToken]) {
    expect(haystack).not.toContain(token)
    expect(haystack).not.toContain(token.slice(-16))
  }
})
