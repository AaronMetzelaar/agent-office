import { ipcMain, type BrowserWindow } from 'electron'
import type { Commands, Events } from '../shared/ipc'
import { isTrustedSender } from './security'

export function handle<K extends keyof Commands>(name: K, win: BrowserWindow, appUrl: string, command: Commands[K]): void {
  ipcMain.handle(name, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event, win, appUrl)) throw new Error(`${name} refused: sender is not the Agent Office window`)
    return Reflect.apply(command, undefined, args)
  })
}

export function send<K extends keyof Events>(win: BrowserWindow, name: K, payload: Events[K]): void {
  if (!win.isDestroyed()) win.webContents.send(name, payload)
}
