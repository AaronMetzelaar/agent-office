import { join } from 'node:path'
import { vi } from 'vitest'
import { createChatStore } from '../../src/main/store/chats'
import { openDb } from '../../src/main/store/db'
import { createFakeEngine } from './fake-engine'

export function openOffice(dir: string, engine = createFakeEngine()) {
  const db = openDb(join(dir, 'office.db'))
  const accounts = { exists: (id: string) => id === 'main' || id === 'research', loginFailed: vi.fn(), recordHeadroom: vi.fn() }
  const store = createChatStore(engine, db, accounts)
  const chat = (id: string) => {
    const found = store.snapshot().find((view) => view.id === id)
    if (!found) throw new Error(`no chat ${id}`)
    return found
  }
  const start = (prompt = 'Fix the bid flow', account = 'main') => {
    const result = store.start(account, dir, prompt)
    if ('error' in result) throw new Error(result.error)
    return result.chatId
  }
  return { engine, db, accounts, store, chat, start }
}
