import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { createAccounts, fakeValidator, validateWithSdk } from './accounts/health'
import { openVault } from './accounts/tokens'
import { handle, send } from './ipc'
import { confirmQuitWhileBusy, hideOnClose, reveal } from './lifecycle'
import { bundleUrl, hardenWindow, registerBundleScheme, secureSession } from './security'
import { createSessionManager, type Engine } from './sessions/manager'
import { createChatStore } from './store/chats'
import { openDb } from './store/db'
import { wireChats } from './store/ipc-sync'
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

async function start(): Promise<void> {
  const fakeEngine = !app.isPackaged && process.env.AGENT_OFFICE_FAKE_ENGINE === '1' ? (await import('../../tests/fakes/fake-engine')).createFakeEngine({ auto: true }) : undefined
  secureSession(devServerUrl, join(__dirname, '../renderer'))
  const win = createWindow()
  const userData = app.getPath('userData')
  const vault = openVault(userData)
  const db = openDb(join(userData, 'office.db'))
  const useFakeValidator = !app.isPackaged && process.env.AGENT_OFFICE_FAKE_VALIDATOR === '1'
  const accounts = createAccounts(vault, useFakeValidator ? fakeValidator : validateWithSdk, db)
  const engine: Engine = fakeEngine ?? createSessionManager((accountId) => vault.token(accountId), (...args) => store.canUseTool(...args))
  const store = createChatStore(engine, db, accounts)
  const sync = wireChats(win, appUrl, store)
  const show = () => {
    reveal(win)
    sync.setVisible(true)
    send(win, 'windowVisibility', { visible: true })
  }
  const hide = () => {
    win.hide()
    sync.setVisible(false)
    send(win, 'windowVisibility', { visible: false })
  }
  confirmQuitWhileBusy(app, store.busy, () => confirmQuit(win), store.shutdown)
  hideOnClose(app, win, hide)
  win.once('ready-to-show', () => {
    if (!app.getLoginItemSettings().wasOpenedAtLogin) show()
  })
  handle('getAppInfo', win, appUrl, () => ({ name: app.getName(), version: app.getVersion() }))
  accounts.events.on('changed', (list) => send(win, 'accountsChanged', list))
  accounts.events.on('removed', store.accountRemoved)
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

async function confirmQuit(win: BrowserWindow): Promise<boolean> {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Quit', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Agents are still working',
    detail: 'Quitting interrupts their turns. They come back as Stuck, with Resume.',
  })
  return response === 0
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
