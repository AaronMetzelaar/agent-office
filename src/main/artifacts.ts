import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { isWebUrl } from './security'

const open = new Map<string, BrowserWindow>()

export const isArtifactFile = (path: unknown): path is string => typeof path === 'string' && isAbsolute(path) && /\.html?$/i.test(path)

export const isArtifactUrl = (url: unknown): url is string => typeof url === 'string' && URL.parse(url)?.protocol === 'https:' && URL.parse(url)?.hostname === 'claude.ai'

export async function openArtifact(path: unknown, url: unknown): Promise<void> {
  const local = isArtifactFile(path) && (await stat(path).then((file) => file.isFile(), () => false))
  if (!local) {
    if (isArtifactUrl(url)) await shell.openExternal(url)
    return
  }
  const existing = open.get(path)
  if (existing && !existing.isDestroyed()) {
    existing.webContents.reloadIgnoringCache()
    return existing.show()
  }
  const win = new BrowserWindow({ width: 1200, height: 860, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  open.set(path, win)
  win.on('closed', () => open.delete(path))
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isWebUrl(target)) void shell.openExternal(target)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => {
    if (URL.parse(event.url)?.pathname === URL.parse(win.webContents.getURL())?.pathname) return
    event.preventDefault()
    if (isWebUrl(event.url)) void shell.openExternal(event.url)
  })
  await win.loadFile(path)
}
