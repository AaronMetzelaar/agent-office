import type { ChatPatch, ChatPatchBatch, ChatRow, ChatSnapshot, LoginItem } from '../../shared/chat'
import type { AccountView } from '../../shared/ipc'
import type { Hub } from '../ipc'
import type { Visitors } from '../outside/visitors'
import type { ChatStore } from './chats'

const tickMs = 16

export const loginItems = (accounts: readonly AccountView[]): LoginItem[] => accounts.filter((account) => account.health.status === 'needs-login').map((account) => ({ accountId: account.id, label: account.label }))

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
  let logins: LoginItem[] = []
  let loginsChanged = false

  const flush = () => {
    timer = undefined
    if (!pending.size && !loginsChanged) return
    push({ seq: ++seq, patches: [...pending.values()], ...(loginsChanged ? { logins } : {}) })
    pending.clear()
    loginsChanged = false
  }

  store.events.on('patch', (patch) => {
    const next = visible ? patch : transitionOnly(patch)
    if (!next) return
    merge(pending, next)
    timer ??= setTimeout(flush, tickMs)
  })

  return {
    snapshot(): ChatSnapshot {
      clearTimeout(timer)
      flush()
      return { seq, chats: store.snapshot(), logins }
    },
    setAccounts(accounts: AccountView[]) {
      const next = loginItems(accounts)
      if (JSON.stringify(next) === JSON.stringify(logins)) return
      logins = next
      loginsChanged = true
      timer ??= setTimeout(flush, tickMs)
    },
    setVisible(value: boolean) {
      visible = value
    },
  }
}

export function wireChats(hub: Hub, store: ChatStore, visitors: Visitors, onOpen: () => void = () => {}) {
  const sync = createPatchSync({ events: store.events, snapshot: () => [...store.snapshot(), ...visitors.snapshot()] }, (batch) => hub.send('chatPatches', batch))
  let openChat: string | undefined
  hub.handle('getSnapshot', sync.snapshot)
  hub.handle('sendMessage', store.sendMessage)
  hub.handle('interruptChat', store.interruptChat)
  hub.handle('stopTask', store.stopTask)
  hub.handle('rewindFiles', store.rewindFiles)
  hub.handle('stopChat', store.stopChat)
  hub.handle('setModel', store.setModel)
  hub.handle('setEffort', store.setEffort)
  hub.handle('setPlanMode', store.setPlanMode)
  hub.handle('olderRows', (chatId, beforeId) => (visitors.has(chatId) ? visitors.olderRows(chatId, beforeId) : store.olderRows(chatId, beforeId)))
  hub.handle('getDraft', store.draft)
  hub.handle('saveDraft', store.saveDraft)
  hub.handle('setOpenChat', (chatId) => {
    openChat = typeof chatId === 'string' ? chatId : undefined
    if (openChat) void store.restore(openChat)
    visitors.open(openChat)
    onOpen()
  })
  hub.handle('resumeChat', store.resumeChat)
  hub.handle('continueOnAccount', store.continueOnAccount)
  hub.handle('renameChat', store.rename)
  hub.handle('markRead', (chatId) => (visitors.has(chatId) ? visitors.markRead(chatId) : store.markRead(chatId)))
  return Object.assign(sync, { openChat: () => openChat })
}
