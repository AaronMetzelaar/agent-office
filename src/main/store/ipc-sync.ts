import type { BrowserWindow } from 'electron'
import type { ChatPatch, ChatPatchBatch, ChatRow, ChatSnapshot } from '../../shared/chat'
import { handle, send } from '../ipc'
import type { ChatStore } from './chats'

const tickMs = 16

function upsertRows(rows: ChatRow[], incoming: ChatRow[]): void {
  for (const row of incoming) {
    const index = rows.findIndex((existing) => existing.id === row.id)
    if (index === -1) rows.push(row)
    else rows[index] = row
  }
}

function merge(pending: Map<string, ChatPatch>, patch: ChatPatch): void {
  const current = pending.get(patch.id)
  if (!current) return void pending.set(patch.id, { ...patch, ...(patch.rows ? { rows: [...patch.rows] } : {}) })
  if (patch.fields) {
    current.fields = { ...current.fields, ...patch.fields }
    if ('partial' in patch.fields) delete current.partialAppend
  }
  if (patch.partialAppend) current.partialAppend = (current.partialAppend ?? '') + patch.partialAppend
  if (patch.replaceRows) {
    current.replaceRows = true
    current.rows = [...(patch.rows ?? [])]
  } else if (patch.rows) upsertRows((current.rows ??= []), patch.rows)
}

function transitionOnly(patch: ChatPatch): ChatPatch | undefined {
  if (!patch.fields || !('state' in patch.fields)) return undefined
  return { id: patch.id, fields: { state: patch.fields.state, stuck: patch.fields.stuck } }
}

export function createPatchSync(store: Pick<ChatStore, 'events' | 'snapshot'>, push: (batch: ChatPatchBatch) => void) {
  const pending = new Map<string, ChatPatch>()
  let visible = false
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    timer = undefined
    if (!pending.size) return
    push({ seq: ++seq, patches: [...pending.values()] })
    pending.clear()
  }

  store.events.on('patch', (patch) => {
    const next = visible ? patch : transitionOnly(patch)
    if (!next) return
    merge(pending, next)
    timer ??= setTimeout(flush, tickMs)
  })

  return {
    snapshot(): ChatSnapshot {
      pending.clear()
      return { seq, chats: store.snapshot() }
    },
    setVisible(value: boolean) {
      visible = value
    },
  }
}

export function wireChats(win: BrowserWindow, appUrl: string, store: ChatStore) {
  const sync = createPatchSync(store, (batch) => send(win, 'chatPatches', batch))
  handle('getSnapshot', win, appUrl, sync.snapshot)
  handle('startChat', win, appUrl, store.start)
  handle('sendMessage', win, appUrl, store.sendMessage)
  handle('interruptChat', win, appUrl, store.interruptChat)
  handle('stopChat', win, appUrl, store.stopChat)
  handle('setModel', win, appUrl, store.setModel)
  handle('setEffort', win, appUrl, store.setEffort)
  handle('resumeChat', win, appUrl, store.resumeChat)
  handle('markRead', win, appUrl, store.markRead)
  return sync
}
