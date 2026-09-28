import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const root = resolve(__dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'agent-office-orphan-'))
const env = { ...process.env, AGENT_OFFICE_USER_DATA: userData, AGENT_OFFICE_CONFIG_DIR: join(userData, 'config'), AGENT_OFFICE_FAKE_VALIDATOR: '1', AGENT_OFFICE_FAKE_ENGINE: '1', AGENT_OFFICE_INLINE_HOST: '' }
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test.afterAll(() => rmSync(userData, { recursive: true, force: true }))

test('a dev agent host with nothing working exits once its window app quits', async () => {
  const app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  const page = await app.firstWindow()
  await expect.poll(() => page.evaluate(() => window.office.getHostStatus()), { timeout: 15_000 }).toMatchObject({ connected: true })
  const pid = Number(readFileSync(join(userData, 'host.pid'), 'utf8'))
  await app.evaluate(({ app }) => app.quit())
  await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false)
})
