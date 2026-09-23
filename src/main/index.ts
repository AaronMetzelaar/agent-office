import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { createAccounts, fakeValidator, validateWithSdk } from './accounts/health'
import { openVault } from './accounts/tokens'
import { handle, send } from './ipc'
import { hideOnClose, reveal } from './lifecycle'
import { bundleUrl, hardenWindow, registerBundleScheme, secureSession } from './security'
import { createTray } from './tray'

if (process.env.AGENT_OFFICE_USER_DATA) app.setPath('userData', process.env.AGENT_OFFICE_USER_DATA)

const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
const appUrl = devServerUrl ?? bundleUrl

if (app.requestSingleInstanceLock()) {
  registerBundleScheme()
  void app.whenReady().then(start)
} else {
  app.quit()
}

function start(): void {
  secureSession(devServerUrl, join(__dirname, '../renderer'))
  const win = createWindow()
  const show = () => {
    reveal(win)
    send(win, 'windowVisibility', { visible: true })
  }
  const hide = () => {
    win.hide()
    send(win, 'windowVisibility', { visible: false })
  }
  hideOnClose(app, win, hide)
  win.once('ready-to-show', () => {
    if (!app.getLoginItemSettings().wasOpenedAtLogin) show()
  })
  handle('getAppInfo', win, appUrl, () => ({ name: app.getName(), version: app.getVersion() }))
  const vault = openVault(app.getPath('userData'))
  const useFakeValidator = !app.isPackaged && process.env.AGENT_OFFICE_FAKE_VALIDATOR === '1'
  const accounts = createAccounts(vault, useFakeValidator ? fakeValidator : validateWithSdk)
  accounts.events.on('changed', (list) => send(win, 'accountsChanged', list))
  handle('listAccounts', win, appUrl, accounts.list)
  handle('addAccount', win, appUrl, accounts.add)
  handle('removeAccount', win, appUrl, accounts.remove)
  handle('revalidateAccount', win, appUrl, accounts.revalidate)
  handle('setLinearKey', win, appUrl, (key) => {
    if (typeof key === 'string' && key.trim()) vault.setLinearKey(key.trim())
  })
  handle('clearLinearKey', win, appUrl, vault.clearLinearKey)
  handle('hasLinearKey', win, appUrl, () => vault.linearKey() !== undefined)
  const tray = createTray(show)
  Object.assign(globalThis, { tray })
  app.on('second-instance', show)
  app.on('activate', show)
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    title: 'Agent Office',
    backgroundColor: '#f6f8fc',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  })
  hardenWindow(win, appUrl)
  void win.loadURL(appUrl)
  return win
}
