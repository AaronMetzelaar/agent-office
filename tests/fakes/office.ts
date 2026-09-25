import { join } from 'node:path'
import { vi } from 'vitest'
import type { LoadedConfig } from '../../src/main/departments/config'
import { createRooms } from '../../src/main/departments/rooms'
import { createHousekeeping, realSystem, type System, type VisitorList } from '../../src/main/housekeeping'
import { createWaitMetrics } from '../../src/main/metrics/wait'
import { createBroker } from '../../src/main/permissions/registry'
import { createRules } from '../../src/main/permissions/rules'
import { createChatStore } from '../../src/main/store/chats'
import { openDb } from '../../src/main/store/db'
import type { ConfigRoom, DeptConfig } from '../../src/shared/departments'
import { createFakeEngine, sdk } from './fake-engine'

export const researchGym: ConfigRoom = { id: 'c-research-gym', name: 'Research gym', account: 'research', look: 'gym' }
export const configOf = (config: Partial<DeptConfig> = {}, unreadable?: string): LoadedConfig => ({ config: { rooms: [], playground: [], commands: {}, ...config }, skipped: [], ...(unreadable ? { unreadable } : {}) })

export function openOffice(dir: string, engine = createFakeEngine(), config = configOf({ rooms: [researchGym] })) {
  const db = openDb(join(dir, 'office.db'))
  const loggedOut = new Set<string>()
  const accounts = { exists: (id: string) => id === 'main' || id === 'research', label: (id: string) => id, needsLogin: (id: string) => loggedOut.has(id), loginFailed: vi.fn(), recordHeadroom: vi.fn() }
  const rules = createRules(db.sql, engine)
  const rooms = createRooms(db, config, () => store.views().flatMap((chat) => (chat.archived || !chat.department ? [] : [chat.department])))
  const store = createChatStore(engine, db, accounts, rooms, rules.forSession)
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
  const finish = (id: string) => {
    engine.init(id)
    engine.emit(id, sdk.text('Done.'))
    engine.emit(id, sdk.result())
  }
  return { engine, db, accounts, loggedOut, rules, rooms, store, waits, broker, chat, start, finish }
}

export const ghMissing = async (): Promise<string> => {
  throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })
}

export function openHousekeeping(office: ReturnType<typeof openOffice>, overrides: Partial<System> = {}, visitors?: VisitorList) {
  const clock = { now: Date.now() }
  const notices: number[] = []
  const system: System = { ...realSystem(), ...office.engine.processes, gh: ghMissing, graceMs: 50, totalMemory: 64 * 2 ** 30, now: () => clock.now, ...overrides }
  const house = createHousekeeping(office.store, office.engine, office.db, system, (count) => notices.push(count), visitors)
  return { house, clock, notices }
}
