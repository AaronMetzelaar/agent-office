import { EventEmitter } from 'node:events'
import type { NotificationConstructorOptions } from 'electron'
import type { Navigate } from '../../shared/ipc'
import type { NotificationLike } from '../notify'
import type { StripState } from '../tray/strip'
import type { HostServer } from './server'

export interface UiState {
  visible: boolean
  focused: boolean
}

export interface Ui {
  state(): UiState
  confirm(message: string, detail: string, action?: string): Promise<boolean>
  show(to?: Navigate): void
  notification(options: NotificationConstructorOptions): NotificationLike
  strip(state: StripState): void
  onChange(listener: (state: UiState) => void): void
}

export type NoteEvent = 'action' | 'reply' | 'click' | 'close' | 'failed'

const hidden: UiState = { visible: false, focused: false }

export function remoteUi(server: HostServer): Ui {
  const changes = new EventEmitter<{ change: [UiState] }>()
  const notes = new Map<string, EventEmitter>()
  let state = hidden
  let strip: StripState | undefined

  const change = (next: UiState) => {
    state = next
    changes.emit('change', state)
  }
  server.handle('uiState', (next: UiState) => change({ visible: next?.visible === true, focused: next?.focused === true }))
  server.handle('noteEvent', (key: string, event: NoteEvent, args: unknown[]) => {
    const note = notes.get(key)
    if (event !== 'failed') notes.delete(key)
    note?.emit(event, ...(Array.isArray(args) ? args : []))
  })
  server.events.on('connect', (peer) => strip && peer.emit('strip', strip))
  server.events.on('disconnect', () => server.clients() || change(hidden))

  return {
    state: () => state,
    confirm: async (message, detail, action) => (await server.ask('confirm', [message, detail, action]).catch(() => false)) === true,
    show: (to) => server.send('show', to),
    notification(options) {
      const key = options.id ?? ''
      const note: EventEmitter & NotificationLike = Object.assign(new EventEmitter(), {
        ...options,
        actions: options.actions ?? [],
        show() {
          notes.set(key, note)
          server.send('notify', options)
        },
        close() {
          if (notes.get(key) === note) notes.delete(key)
          server.send('unnotify', key)
        },
      })
      return note
    },
    strip(next) {
      strip = next
      server.send('strip', next)
    },
    onChange: (listener) => void changes.on('change', listener),
  }
}
