import { join } from 'node:path'
import { app, BrowserWindow, dialog, Menu, Notification, shell } from 'electron'
import { version } from '../../package.json'
import type { Events, HostStatus, Navigate } from '../shared/ipc'
import { createCore, prepareCore, type Core } from './host/core'
import { forwarded, rendererEvents } from './host/forwarded'
import { hostBuild, hostFlag, hostSecret, socketPath } from './host/identity'
import { connectHost } from './host/client'
import { localUi, noteBridge, spawnHost, uiState } from './host/link'
import type { Welcome } from './host/server'
import type { StripState } from './tray/strip'
import { guard, handle, send, windowHub } from './ipc'
import { confirmQuitWhileBusy, hideOnClose, offstage, reveal } from './lifecycle'
import { pinFolder } from './folders'
import { loginShellPath } from './login-path'
import { forwardRendererErrors } from './renderer-log'
import { bundleUrl, hardenWindow, registerBundleScheme, secureSession } from './security'
import { simulatorScreenshot } from './simulator'
import { openArtifact } from './artifacts'
import { createTray } from './tray'
import { claudeCode } from './claude-code'
import { createReleaseCheck } from './releases'
import { createUpdater, launchInstaller, runGit } from './updates'

const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
const appUrl = devServerUrl ?? bundleUrl
const inlineHost = !app.isPackaged && process.env.AGENT_OFFICE_INLINE_HOST === '1'
const hidden = !app.isPackaged && process.env.AGENT_OFFICE_HIDDEN === '1'

if (hidden) {
  process.on('uncaughtException', (error) => console.error('[main] uncaught exception', error))
  Notification.prototype.show = () => {}
}

if (process.argv.includes(hostFlag)) {
  require(join(__dirname, 'host.js'))
} else {
  if (process.env.AGENT_OFFICE_USER_DATA) app.setPath('userData', process.env.AGENT_OFFICE_USER_DATA)
  if (app.requestSingleInstanceLock()) {
    registerBundleScheme()
    void app.whenReady().then(start)
  } else {
    app.quit()
  }
}

async function start(): Promise<void> {
  if (!app.isPackaged) app.dock?.setIcon(join(__dirname, '../../resources/icon.png'))
  const prepared = inlineHost ? await prepareCore() : undefined
  secureSession(devServerUrl, join(__dirname, '../renderer'))
  const win = createWindow()
  const dataDir = app.getPath('userData')
  let status: HostStatus = { connected: inlineHost, updateReady: false }
  let report = () => {}
  let shown = false
  const changed = () => {
    report()
    const { visible } = uiState(win)
    if (visible === shown) return
    shown = visible
    send(win, 'windowVisibility', { visible })
  }
  const setStatus = (next: HostStatus) => {
    status = next
    send(win, 'hostStatus', status)
  }
  const show = (to?: Navigate) => {
    reveal(win)
    changed()
    if (to) send(win, 'navigate', to)
  }
  const hide = () => {
    win.hide()
    changed()
  }
  const confirm = async (message: string, detail: string, action = 'Move') => (await dialog.showMessageBox(win, { type: 'question', buttons: [action, 'Cancel'], defaultId: 1, cancelId: 1, message, detail })).response === 0
  let quitFromTray = () => app.quit()
  const strip = createTray(() => show({ to: 'inbox' }), () => quitFromTray())
  let core: Core | undefined
  if (inlineHost) confirmQuitWhileBusy(app, () => core?.busy() ?? false, () => confirmQuit(win), () => core?.shutdown())
  hideOnClose(app, win, hide)
  for (const event of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore'] as const) win.on(event as 'focus', changed)
  app.on('did-become-active', changed)
  app.on('did-resign-active', changed)
  win.once('ready-to-show', () => {
    if (!app.getLoginItemSettings().wasOpenedAtLogin) show()
  })
  let agentsBusy = async () => false
  const confirmInterrupt = async () =>
    (await dialog.showMessageBox(win, { type: 'warning', buttons: ['Install Now', 'When Agents Finish'], defaultId: 1, cancelId: 1, message: 'Agents are still working', detail: 'Installing restarts the app, which interrupts their turns. They come back as Stuck, with Resume. Otherwise the update installs by itself once no agent is working.' })).response === 0
  const updater =
    __SOURCE_REPO__ || !app.isPackaged
      ? createUpdater({
          commit: app.isPackaged ? __BUILD_COMMIT__ : '',
          repo: __SOURCE_REPO__,
          git: runGit(__SOURCE_REPO__),
          launch: launchInstaller(() => loginShellPath()),
          busy: () => agentsBusy(),
          confirmInterrupt,
          changed: (update) => send(win, 'appUpdate', update),
        })
      : createReleaseCheck({ version, changed: (update) => send(win, 'appUpdate', update), open: (url) => void shell.openExternal(url) })
  updater.start()
  win.on('focus', () => updater.focused())
  handle('getAppInfo', win, appUrl, () => ({ name: app.getName(), version, commit: __BUILD_COMMIT__.slice(0, 7) || undefined }))
  handle('getAppUpdate', win, appUrl, updater.state)
  handle('claudeCode', win, appUrl, () => claudeCode(() => loginShellPath()))
  handle('installAppUpdate', win, appUrl, () => updater.install())
  handle('pickFolder', win, appUrl, async () => {
    const picked = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Choose' })
    const path = picked.canceled ? undefined : picked.filePaths[0]
    if (path) pinFolder(path)
    return path
  })
  handle('openNotificationSettings', win, appUrl, () => void shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension'))
  handle('simulatorScreenshot', win, appUrl, simulatorScreenshot)
  handle('openArtifact', win, appUrl, openArtifact)
  handle('getHostStatus', win, appUrl, () => status)

  if (prepared) {
    const ui = localUi({ win, confirm, show, strip: strip.update })
    report = ui.changed
    core = createCore(dataDir, windowHub(win, appUrl), ui, prepared)
    agentsBusy = async () => core?.busy() ?? false
    ui.changed()
    handle('restartHost', win, appUrl, () => {})
    handle('stopHost', win, appUrl, async () => app.quit())
  } else {
    let everConnected = false
    let openChat: unknown[] = []
    const notes = noteBridge((key, event, args) => void host.call('noteEvent', [key, event, args]).catch(() => {}))
    const onEvent = (name: string, payload: unknown) => {
      if (name === 'strip') strip.update(payload as StripState)
      else if (name === 'show') show((payload ?? undefined) as Navigate | undefined)
      else if (name === 'notify') notes.show(payload as Electron.NotificationConstructorOptions)
      else if (name === 'unnotify') notes.close(String(payload))
      else if (rendererEvents.has(name)) send(win, name as keyof Events, payload as never)
    }
    const onWelcome = (welcome: Welcome | undefined) => {
      if (!welcome) return setStatus({ connected: false, updateReady: false })
      const updateReady = welcome.build !== hostBuild(__dirname)
      setStatus({ connected: true, updateReady })
      changed()
      if (updateReady) void host.call(process.argv.includes('--restart-host') ? 'exit' : 'exitWhenIdle').catch(() => {})
      if (!everConnected) return void (everConnected = true)
      send(win, 'windowVisibility', { visible: win.isVisible() })
      void host.call('setOpenChat', openChat).catch(() => {})
      void host.call('listAccounts').then((list) => send(win, 'accountsChanged', list as Events['accountsChanged']))
    }
    const host = connectHost({
      path: socketPath(dataDir),
      secret: hostSecret(dataDir),
      spawn: () => spawnHost(dataDir),
      status: onWelcome,
      event: onEvent,
      call: (name, args) => (name === 'confirm' ? confirm(String(args[0]), String(args[1]), typeof args[2] === 'string' ? args[2] : undefined) : undefined),
    })
    report = () => void host.call('uiState', [uiState(win)]).catch(() => {})
    for (const name of forwarded) {
      guard(name, win, appUrl, (...args: unknown[]) => {
        if (name === 'setOpenChat') openChat = args
        return host.call(name, args)
      })
    }
    agentsBusy = async () => (await host.call('busy')) === true
    const stopAgents = async () => {
      if ((await host.call('busy')) === true && !(await confirmQuit(win))) return
      await host.call('exit').catch(() => {})
      host.close()
      app.quit()
    }
    quitFromTray = async () => {
      const { response } = await dialog.showMessageBox({ type: 'question', buttons: ['Quit Window App Only', 'Quit and Stop All Agents', 'Cancel'], defaultId: 0, cancelId: 2, message: 'Quit Agent Office?', detail: 'Agents keep running in the agent host while the window app is closed.' })
      if (response === 0) app.quit()
      if (response === 1) await stopAgents()
    }
    handle('restartHost', win, appUrl, () => void host.call('exit').catch(() => {}))
    handle('stopHost', win, appUrl, stopAgents)
    app.on('before-quit', host.close)
  }
  Menu.setApplicationMenu(appMenu(() => show({ to: 'new' })))
  Object.assign(globalThis, { tray: strip.tray })
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
      backgroundThrottling: !hidden,
    },
  })
  if (hidden) offstage(win)
  hardenWindow(win, appUrl)
  forwardRendererErrors(win.webContents)
  void win.loadURL(appUrl)
  return win
}
