import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { OfficeApi } from '../../src/shared/ipc'

declare global {
  interface Window {
    office: OfficeApi
    seen: boolean[]
    violations: string[]
    injected?: boolean
  }
}

interface Recorded {
  tray: Electron.Tray
  asked: string[]
  opened: string[]
}

const root = resolve(__dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'agent-office-e2e-'))
const env = { ...process.env, AGENT_OFFICE_USER_DATA: userData }

let app: ElectronApplication
let page: Page

const windowStates = () =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((win) => win.isVisible()))
const recorded = <K extends keyof Recorded>(key: K) =>
  app.evaluate((_electron, name) => (globalThis as unknown as Recorded)[name], key)

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  app = await electron.launch({ args: [root], env })
  page = await app.firstWindow()
})

test.afterAll(async () => {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
})

test('launch shows the window, the floor and a tray icon', async () => {
  await expect.poll(windowStates).toEqual([true])
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.getByText(/^Agent Office \d+\.\d+\.\d+$/)).toBeVisible()
  expect(await app.evaluate(() => !(globalThis as unknown as Recorded).tray.isDestroyed())).toBe(true)
})

test('closing the window keeps the app in the tray, and the tray shows it again', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
  await expect.poll(windowStates).toEqual([false])
  expect(app.process().exitCode).toBeNull()

  await app.evaluate(() => (globalThis as unknown as Recorded).tray.emit('click'))
  await expect.poll(windowStates).toEqual([true])
})

test('a second launch focuses the existing window instead of starting another app', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide())
  await expect.poll(windowStates).toEqual([false])

  const executable = await app.evaluate(() => process.execPath)
  const second = spawn(executable, [root], { env, stdio: 'ignore' })
  const exitCode = await new Promise((done) => second.on('exit', done))

  expect(exitCode).toBe(0)
  await expect.poll(windowStates).toEqual([true])
})

test('the renderer calls a typed command and receives pushed events', async () => {
  const info = await page.evaluate(() => window.office.getAppInfo())
  expect(info).toEqual({ name: 'Agent Office', version: expect.stringMatching(/^\d+\.\d+\.\d+$/) })

  await page.evaluate(() => {
    window.seen = []
    window.office.onWindowVisibility(({ visible }) => window.seen.push(visible))
  })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
  await app.evaluate(() => (globalThis as unknown as Recorded).tray.emit('click'))
  await expect.poll(() => page.evaluate(() => window.seen)).toEqual([false, true])
})

test('new windows and navigation away from the app are blocked', async () => {
  await app.evaluate(({ dialog, shell }) => {
    const state = globalThis as unknown as Recorded
    state.asked = []
    state.opened = []
    Object.assign(dialog, {
      showMessageBox: async (_win: unknown, options: { detail: string }) => {
        state.asked.push(options.detail)
        return { response: 0, checkboxChecked: false }
      },
    })
    Object.assign(shell, {
      openExternal: async (url: string) => {
        state.opened.push(url)
      },
    })
  })
  const appUrl = page.url()

  await page.evaluate(() => {
    window.open('https://example.com/docs')
    window.open('file:///etc/hosts')
  })
  await expect.poll(() => recorded('opened')).toEqual(['https://example.com/docs'])

  await page.evaluate(() => {
    location.href = 'file:///etc/hosts'
  })
  await page.evaluate(() => {
    location.href = 'https://example.com/away'
  })
  await expect.poll(() => recorded('opened')).toEqual(['https://example.com/docs', 'https://example.com/away'])

  expect(await recorded('asked')).toEqual(['https://example.com/docs', 'https://example.com/away'])
  expect(page.url()).toBe(appUrl)
  expect(await windowStates()).toEqual([true])
})

test('a command from any other webContents is refused', async () => {
  const preload = join(root, 'out/preload/index.js')
  const outcome = await app.evaluate(async ({ BrowserWindow }, { preload, url }) => {
    const foreign = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true } })
    try {
      await foreign.loadURL(url)
      return await foreign.webContents.executeJavaScript(
        'window.office.getAppInfo().then(() => "allowed", (error) => error.message)',
      )
    } finally {
      foreign.destroy()
    }
  }, { preload, url: page.url() })

  expect(outcome).toContain('getAppInfo refused')
})

test('the content security policy blocks injected scripts', async () => {
  await page.evaluate(() => {
    window.violations = []
    document.addEventListener('securitypolicyviolation', (event) => window.violations.push(event.effectiveDirective))
    const script = document.createElement('script')
    script.textContent = 'window.injected = true'
    document.body.append(script)
    document.body.insertAdjacentHTML('beforeend', '<img src="data:," onerror="window.injected = true">')
    setTimeout('window.injected = true')
  })

  await expect
    .poll(() => page.evaluate(() => [...new Set(window.violations)].sort()))
    .toEqual(['script-src', 'script-src-attr', 'script-src-elem'])
  expect(await page.evaluate(() => window.injected)).toBeUndefined()
})
