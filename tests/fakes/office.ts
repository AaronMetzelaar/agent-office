import { join } from 'node:path'
import { vi } from 'vitest'
import { createWaitMetrics } from '../../src/main/metrics/wait'
import { createBroker } from '../../src/main/permissions/registry'
import { createRules } from '../../src/main/permissions/rules'
import { createChatStore } from '../../src/main/store/chats'
import { openDb } from '../../src/main/store/db'
import { createFakeEngine } from './fake-engine'

export function openOffice(dir: string, engine = createFakeEngine()) {
  const db = openDb(join(dir, 'office.db'))
  const loggedOut = new Set<string>()
  const accounts = { exists: (id: string) => id === 'main' || id === 'research', needsLogin: (id: string) => loggedOut.has(id), loginFailed: vi.fn(), recordHeadroom: vi.fn() }
  const rules = createRules(db.sql, engine)
  const store = createChatStore(engine, db, accounts, rules.forSession)
  const waits = createWaitMetrics(db.sql, store)
  const broker = createBroker(engine, store, rules, waits)
  engine.canUseTool = broker.canUseTool
  const chat = (id: string) => {
    const found = store.snapshot().find((view) => view.id === id)
    if (!found) throw new Error(`no chat ${id}`)
    return found
  }
  const start = (prompt = 'Fix the bid flow', account = 'main', cwd = dir) => {
    const result = store.start(account, cwd, prompt)
    if ('error' in result) throw new Error(result.error)
    return result.chatId
  }
  return { engine, db, accounts, loggedOut, rules, store, waits, broker, chat, start }
}
