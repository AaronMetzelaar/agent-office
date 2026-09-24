import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { closeSync, openSync } from 'node:fs'
import { app, Notification, type BrowserWindow, type NotificationConstructorOptions } from 'electron'
import type { Navigate } from '../../shared/ipc'
import type { StripState } from '../tray/strip'
import { hostFlag, logPath } from './identity'
import type { NoteEvent, Ui, UiState } from './ui'

export function spawnHost(dataDir: string): void {
  const log = openSync(logPath(dataDir), 'a')
  const args = [...(app.isPackaged ? [] : [app.getAppPath()]), hostFlag, ...(app.commandLine.hasSwitch('use-mock-keychain') ? ['--use-mock-keychain'] : [])]
  spawn(process.execPath, args, { detached: true, stdio: ['ignore', log, log], env: process.env }).unref()
  closeSync(log)
}

export const uiState = (win: BrowserWindow): UiState => ({ visible: !win.isDestroyed() && win.isVisible(), focused: !win.isDestroyed() && win.isFocused() })

export function noteBridge(report: (key: string, event: NoteEvent, args: unknown[]) => void) {
  const notes = new Map<string, Notification>()
  const close = (key: string) => {
    const note = notes.get(key)
    notes.delete(key)
    note?.removeAllListeners()
    note?.close()
  }
  return {
    close,
    show(options: NotificationConstructorOptions) {
      const key = options.id ?? ''
      close(key)
      const note = new Notification(options)
      const forward = (event: NoteEvent, args: unknown[]) => {
        if (event !== 'failed') notes.delete(key)
        report(key, event, args)
      }
      note.on('action', (event, index) => forward('action', [{ actionIndex: event.actionIndex }, index]))
      note.on('reply', (event, reply) => forward('reply', [{ reply: event.reply }, reply]))
      note.on('click', () => forward('click', []))
      note.on('close', () => forward('close', []))
      note.on('failed', (_event, error) => forward('failed', [null, error]))
      notes.set(key, note)
      note.show()
    },
  }
}

export interface LocalUiDeps {
  win: BrowserWindow
  confirm: Ui['confirm']
  show(to?: Navigate): void
  strip(state: StripState): void
}

export function localUi({ win, confirm, show, strip }: LocalUiDeps): Ui & { changed(): void } {
  const changes = new EventEmitter<{ change: [UiState] }>()
  return {
    state: () => uiState(win),
    confirm,
    show,
    notification: (options) => new Notification(options),
    strip,
    onChange: (listener) => void changes.on('change', listener),
    changed: () => void changes.emit('change', uiState(win)),
  }
}
