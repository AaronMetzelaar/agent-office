import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { doingNow } from '../../src/shared/chat'
import { limitHit, limitsOf, tightest } from '../../src/shared/guardrails'
import { sdk } from '../fakes/fake-engine'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let office: ReturnType<typeof openOffice>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-guardrails-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  office = openOffice(dir)
})

afterEach(() => {
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function working(prompt = 'Fix the bid flow') {
  const id = office.start(prompt)
  office.engine.init(id)
  return id
}

let toolId = 0
const tools = (id: string, count: number) => {
  for (let i = 0; i < count; i++) office.engine.emit(id, sdk.toolUse([{ id: `tool-${++toolId}`, name: 'Read', input: { file_path: '/a.ts' } }]))
}

describe('limit logic', () => {
  it('keeps only positive numbers and reports the first limit crossed', () => {
    expect(limitsOf({ turns: 20.4, costUsd: -1 })).toEqual({ turns: 20 })
    expect(limitsOf('nope')).toEqual({})
    expect(limitHit({}, 999, 999)).toBeUndefined()
    expect(limitHit({ turns: 3 }, 3, 0)).toBeUndefined()
    expect(limitHit({ turns: 3 }, 4, 0)).toBe('Stopped at its 3-turn limit')
    expect(limitHit({ costUsd: 2 }, 0, 2)).toBe('Stopped at its $2.00 limit')
  })

  it('picks the most used window and treats a passed reset as empty', () => {
    const now = 1_000_000
    expect(tightest({ fiveHour: { utilization: 40, resetsAt: now + 1 }, sevenDay: { utilization: 70 } }, now)).toEqual({ window: 'sevenDay', utilization: 70 })
    expect(tightest({ fiveHour: { utilization: 95, resetsAt: now - 1, warn: true } }, now)).toEqual({ window: 'fiveHour', utilization: 0 })
    expect(tightest(undefined, now)).toBeUndefined()
  })
})

describe('per-agent limits', () => {
  it('interrupts a runaway turn at its turn limit and waits for Aaron with the reason', () => {
    const { engine, store, chat } = office
    const id = office.start('Loop forever')
    store.setLimits(id, { turns: 3 })
    engine.init(id)

    tools(id, 3)
    expect(chat(id).state).toBe('working')
    tools(id, 1)
    expect(engine.calls).toEqual([`interrupt:${id}`])
    expect(chat(id)).toMatchObject({ state: 'needs-you', halt: 'Stopped at its 3-turn limit' })
    expect(doingNow(chat(id), Date.now())).toBe('Waiting for you · Stopped at its 3-turn limit')

    engine.emit(id, sdk.errorResult('[Request interrupted by user]'))
    expect(chat(id).state).toBe('needs-you')
    expect(store.busy()).toBe(false)

    store.sendMessage(id, 'Carry on, but stop after the tests')
    expect(chat(id)).toMatchObject({ state: 'working', halt: undefined })
    tools(id, 3)
    expect(chat(id).state).toBe('working')
  })

  it('stops at the cost limit counted from Aaron’s last message, using the global default', () => {
    const { engine, store, db, chat } = office
    db.saveSetting('limits', { costUsd: 1 })
    const id = working()
    engine.emit(id, sdk.result(100, 20, 0.6))
    expect(chat(id).state).toBe('done')

    store.sendMessage(id, 'More')
    engine.emit(id, sdk.result(100, 20, 1.5))
    expect(chat(id).state).toBe('done')

    store.sendMessage(id, 'And more')
    engine.emit(id, sdk.result(100, 20, 2.6))
    expect(chat(id)).toMatchObject({ state: 'needs-you', halt: 'Stopped at its $1.00 limit' })
    expect(engine.calls).not.toContain(`interrupt:${id}`)
  })

  it('persists a halted chat through a restart and lets it finish', () => {
    const { engine, store } = office
    const id = office.start('Loop')
    store.setLimits(id, { turns: 1 })
    engine.init(id)
    tools(id, 2)
    office.db.close()
    office = openOffice(dir)
    expect(office.chat(id)).toMatchObject({ state: 'needs-you', halt: 'Stopped at its 1-turn limit', limits: { turns: 1 } })
    expect(office.store.finish(id)).toBe(true)
  })

  it('takes limits from the New agent options and clears them when blank', () => {
    const { store, chat } = office
    const result = store.start('main', dir, 'Go', undefined, undefined, { limits: { turns: 5, costUsd: 0 } })
    if ('error' in result) throw new Error(result.error)
    expect(chat(result.chatId).limits).toEqual({ turns: 5 })
    store.setLimits(result.chatId, {})
    expect(chat(result.chatId).limits).toBeUndefined()
  })
})

describe('pause all', () => {
  it('interrupts working chats without marking them Done, holds sends, and resumes on Resume all', () => {
    const { engine, store, chat } = office
    const busy = working()
    const resting = working('Other')
    engine.emit(resting, sdk.result())
    store.markRead(resting)

    store.setPaused(true)
    expect(store.paused()).toBe(true)
    expect(engine.calls).toEqual([`interrupt:${busy}`])
    engine.emit(busy, sdk.errorResult('[Request interrupted by user]'))
    expect(chat(busy)).toMatchObject({ state: 'idle', paused: true, unread: false })
    expect(store.busy()).toBe(true)

    const sentBefore = engine.sent.length
    store.sendMessage(resting, 'Queued while paused')
    const fresh = office.start('Started while paused')
    expect(engine.sent).toHaveLength(sentBefore)
    expect(chat(resting)).toMatchObject({ state: 'idle', paused: true })
    expect(chat(fresh)).toMatchObject({ state: 'idle', paused: true })

    store.setPaused(false)
    expect(engine.sent.slice(sentBefore)).toEqual([
      { chatId: busy, text: 'Continue where you left off.' },
      { chatId: resting, text: 'Queued while paused' },
      { chatId: fresh, text: 'Started while paused' },
    ])
    for (const id of [busy, resting, fresh]) expect(chat(id)).toMatchObject({ state: 'working', paused: undefined })
    expect(chat(fresh).rows.filter((row) => row.kind === 'user')).toHaveLength(1)
  })

  it('lets a turn that ends on its own before the interrupt finish normally', () => {
    const { engine, store, chat } = office
    const id = working()
    store.setPaused(true)
    engine.emit(id, sdk.result())
    expect(chat(id)).toMatchObject({ state: 'done', paused: undefined })
    store.setPaused(false)
    expect(chat(id).state).toBe('done')
    expect(engine.sent).toHaveLength(1)
  })
})
