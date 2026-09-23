import { join } from 'node:path'
import { app, BrowserWindow, dialog, Menu, Notification, shell } from 'electron'
import { version } from '../../package.json'
import { departmentOf, deptNames, isResearch } from '../shared/office'
import type { Navigate, SettingName } from '../shared/ipc'
import { createAccounts, fakeValidator, validateWithSdk } from './accounts/health'
import { openVault } from './accounts/tokens'
import { createPlacement, loadRules } from './departments/classifier'
import { handle, send } from './ipc'
import { confirmQuitWhileBusy, hideOnClose, reveal } from './lifecycle'
import { createWaitMetrics } from './metrics/wait'
import { createNotifier } from './notify'
import { configDir, createPhonePush } from './notify/ntfy'
import { createBroker, windowResolver } from './permissions/registry'
import { createRules } from './permissions/rules'
import { bundleUrl, hardenWindow, registerBundleScheme, secureSession } from './security'
import { createSessionManager, type Engine } from './sessions/manager'
import { createChatStore } from './store/chats'
import { openDb } from './store/db'
import { loginItems, wireChats } from './store/ipc-sync'
import { createTray } from './tray'
import { stripState } from './tray/strip'

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
  const engine: Engine = fakeEngine ?? createSessionManager((accountId) => vault.token(accountId), (...args) => broker.canUseTool(...args))
  const rules = createRules(db.sql, engine)
  const deptRules = loadRules(configDir())
  const store = createChatStore(engine, db, accounts, rules.forSession, deptRules)
  const broker = createBroker(engine, store, rules, createWaitMetrics(db.sql, store))
  if (fakeEngine) fakeEngine.canUseTool = broker.canUseTool
  const sync = wireChats(win, appUrl, store)
  createPlacement(engine, store, deptRules, (chatId) => sync.openChat() === chatId)
  handle('departmentRules', win, appUrl, () => deptRules)
  sync.setAccounts(accounts.list())
  handle('resolveRequest', win, appUrl, windowResolver(broker, () => win.isFocused()))
  handle('listRules', win, appUrl, rules.list)
  handle('revokeRule', win, appUrl, rules.revoke)
  const show = (to?: Navigate) => {
    reveal(win)
    sync.setVisible(true)
    send(win, 'windowVisibility', { visible: true })
    if (to) send(win, 'navigate', to)
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
  handle('getAppInfo', win, appUrl, () => ({ name: app.getName(), version }))
  handle('listAccounts', win, appUrl, accounts.list)
  handle('addAccount', win, appUrl, accounts.add)
  handle('removeAccount', win, appUrl, accounts.remove)
  handle('revalidateAccount', win, appUrl, accounts.revalidate)
  handle('setLinearKey', win, appUrl, (key) => {
    if (typeof key === 'string' && key.trim()) vault.setLinearKey(key.trim())
  })
  handle('clearLinearKey', win, appUrl, vault.clearLinearKey)
  handle('hasLinearKey', win, appUrl, () => vault.linearKey() !== undefined)
  handle('recentFolders', win, appUrl, store.recentFolders)
  handle('pickFolder', win, appUrl, async () => {
    const picked = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Choose' })
    return picked.canceled ? undefined : picked.filePaths[0]
  })

  const phone = createPhonePush({ dir: configDir(), vault, settings: db, resolve: broker.resolveRequest, onOpen: () => console.info('[ntfy] listening for phone decisions') })
  const settings = () => ({ phonePush: phone.enabled(), phonePushAvailable: phone.available, alertsHintSeen: db.setting('alertsHintSeen') === true })
  handle('getSettings', win, appUrl, settings)
  handle('setSetting', win, appUrl, (name: SettingName, value: boolean) => {
    if (typeof value !== 'boolean') return settings()
    if (name === 'phonePush') phone.set(value)
    if (name === 'alertsHintSeen') db.saveSetting(name, value)
    return settings()
  })
  handle('openNotificationSettings', win, appUrl, () => void shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension'))

  const research = () => new Set(accounts.list().filter(isResearch).map((account) => account.id))
  const notifier = createNotifier({
    store,
    department: (chat) => deptNames[departmentOf(chat, research().has(chat.accountId))],
    resolve: (requestId, decision) => broker.resolveRequest(requestId, decision, 'notification'),
    sendMessage: store.sendMessage,
    open: show,
    notification: (options) => new Notification(options),
    push: phone.post,
    shown: (chatId) => win.isVisible() && win.isFocused() && sync.openChat() === chatId,
  })
  const strip = createTray(() => show({ to: 'inbox' }), () => stripState(store.views(), loginItems(accounts.list()), Date.now()))
  store.events.on('patch', (patch) => {
    if (patch.fields && ('state' in patch.fields || 'pendingRequests' in patch.fields || 'archived' in patch.fields)) strip.update()
  })
  setInterval(strip.update, 60_000)
  accounts.events.on('needs-login', notifier.login)
  accounts.events.on('changed', (list) => {
    send(win, 'accountsChanged', list)
    sync.setAccounts(list)
    strip.update()
    for (const account of list) if (account.health.status !== 'needs-login') notifier.loginFixed(account.id)
  })
  accounts.events.on('removed', store.accountRemoved)
  Menu.setApplicationMenu(appMenu(() => show({ to: 'new' })))
  Object.assign(globalThis, { tray: strip.tray, notifier, phone, store })
  app.on('second-instance', () => show())
  app.on('activate', () => show())
}

function appMenu(newAgent: () => void): Menu {
  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'File', submenu: [{ id: 'new-agent', label: 'New Agent…', accelerator: 'CmdOrCtrl+N', click: newAgent }, { type: 'separator' }, { role: 'close' }] },
    { role: 'editMenu' },
    ...(app.isPackaged ? [] : [{ role: 'viewMenu' as const }]),
    { role: 'windowMenu' },
  ])
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
