import { ipcMain, type BrowserWindow } from 'electron'
import type { Commands, Events } from '../shared/ipc'
import { isTrustedSender } from './security'

export interface Hub {
  handle<K extends keyof Commands>(name: K, command: Commands[K]): void
  send<K extends keyof Events>(name: K, payload: Events[K]): void
}

export function guard(name: string, win: BrowserWindow, appUrl: string, command: (...args: never[]) => unknown): void {
  ipcMain.handle(name, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event, win, appUrl)) throw new Error(`${name} refused: sender is not the Agent Office window`)
    return Reflect.apply(command, undefined, args)
  })
}

export function handle<K extends keyof Commands>(name: K, win: BrowserWindow, appUrl: string, command: Commands[K]): void {
  guard(name, win, appUrl, command)
}

export function send<K extends keyof Events>(win: BrowserWindow, name: K, payload: Events[K]): void {
  if (!win.isDestroyed()) win.webContents.send(name, payload)
}

export const windowHub = (win: BrowserWindow, appUrl: string): Hub => ({
  handle: (name, command) => handle(name, win, appUrl, command),
  send: (name, payload) => send(win, name, payload),
})
