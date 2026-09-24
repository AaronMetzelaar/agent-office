import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupCandidates, cleanupNotice, readThresholds, toThresholds } from '../../src/main/housekeeping/stale'
import { day, defaultThresholds } from '../../src/shared/housekeeping'
import { openHousekeeping, openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

const hour = 3_600_000
let dir: string
let office: ReturnType<typeof openOffice>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-stale-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  office = openOffice(dir)
})

afterEach(() => {
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function doneChat(prompt = 'Fix the bid flow') {
  const id = office.start(prompt)
  office.finish(id)
  return id
}

describe('parking', () => {
  it('parks a chat whose last message was 26 hours ago and stops its dev server, but not one from 23 hours ago', async () => {
    const { house, clock } = openHousekeeping(office)
    const stale = doneChat('Refund webhook retries')
    const fresh = doneChat('Crowdin translations')
    const staleSession = office.engine.pid(stale)!
    const freshSession = office.engine.pid(fresh)!
    Object.assign(office.store.view(fresh)!, { lastActivityAt: clock.now + 3 * hour })

    clock.now += 26 * hour
    house.tick()

    expect(office.chat(stale).parked).toBe(true)
    expect(office.chat(fresh).parked).toBeFalsy()
    await vi.waitFor(() => expect(office.engine.processes.signals).toEqual([{ pid: staleSession + 1, signal: 'SIGTERM' }]))
    expect(office.engine.processes.alive(staleSession)).toBe(true)
    expect(office.engine.processes.alive(freshSession + 1)).toBe(true)
    expect(office.db.listChats().find((record) => record.id === stale)?.parked).toBe(true)
  })

  it('never parks a chat that is working, waiting for you or stuck', () => {
    const { house, clock } = openHousekeeping(office)
    const working = office.start('Busy')
    office.engine.init(working)
    const stuck = office.start('Broken')
    office.engine.exit(stuck, 'boom')
    clock.now += 5 * day
    house.tick()
    expect(office.chat(working).parked).toBeFalsy()
    expect(office.chat(stuck).parked).toBeFalsy()
  })

  it('brings a parked chat back to its desk when a message arrives for it', () => {
    const { house, clock } = openHousekeeping(office)
    const id = doneChat()
    clock.now += 2 * day
    house.tick()
    expect(office.chat(id).parked).toBe(true)

    office.store.sendMessage(id, 'One more thing')

    expect(office.chat(id)).toMatchObject({ parked: false, state: 'working' })
    expect(office.engine.sent.at(-1)).toEqual({ chatId: id, text: 'One more thing' })
  })

  it('does not count reading a reply as a message', () => {
    const id = doneChat()
    const before = office.chat(id).lastActivityAt
    office.store.markRead(id)
    expect(office.chat(id)).toMatchObject({ state: 'idle', lastActivityAt: before })
  })
})

describe('thresholds', () => {
  it('parks sooner after the threshold is lowered, keeps it across a restart, and refuses values off the menu', () => {
    const { house, clock } = openHousekeeping(office)
    const id = doneChat()
    clock.now += 7 * hour
    house.tick()
    expect(office.chat(id).parked).toBeFalsy()

    const view = house.setThresholds({ parkAfterMs: 6 * hour, cleanupAfterMs: 2 * day })
    expect(view.thresholds).toEqual({ parkAfterMs: 6 * hour, cleanupAfterMs: 2 * day })
    expect(office.chat(id).parked).toBe(true)
    expect(house.setThresholds({ parkAfterMs: 5, cleanupAfterMs: 2 * day }).thresholds.parkAfterMs).toBe(6 * hour)
    expect(openHousekeeping(office).house.view().thresholds).toEqual({ parkAfterMs: 6 * hour, cleanupAfterMs: 2 * day })
  })

  it('validates thresholds', () => {
    expect(toThresholds({ parkAfterMs: day, cleanupAfterMs: 3 * day })).toEqual(defaultThresholds)
    expect(toThresholds({ parkAfterMs: 3 * day, cleanupAfterMs: day })).toBeUndefined()
    expect(toThresholds({ parkAfterMs: '1d', cleanupAfterMs: 3 * day })).toBeUndefined()
    expect(readThresholds(undefined)).toEqual(defaultThresholds)
  })
})

describe('cleanup candidates', () => {
  it('suggests settled chats quiet for three days, not archived or busy ones', () => {
    const now = Date.now()
    const chat = (id: string, fields: object) => ({ id, state: 'idle' as const, archived: false, lastActivityAt: now - 4 * day, ...fields })
    const chats = [chat('old', {}), chat('recent', { lastActivityAt: now - 2 * day }), chat('gone', { archived: true }), chat('busy', { state: 'working' as const })]
    expect(cleanupCandidates(chats, defaultThresholds, now)).toEqual(['old'])
  })

  it('notifies when new candidates appear, at most once a day', () => {
    const now = Date.now()
    const first = cleanupNotice(['a'], undefined, now)
    expect(first).toEqual({ at: now, ids: ['a'] })
    expect(cleanupNotice(['a'], first, now + 2 * day)).toBeUndefined()
    expect(cleanupNotice(['a', 'b'], first, now + hour)).toBeUndefined()
    expect(cleanupNotice(['a', 'b'], first, now + day)).toEqual({ at: now + day, ids: ['a', 'b'] })
    expect(cleanupNotice([], undefined, now)).toBeUndefined()
  })

  it('sends one low-priority notice when chats become candidates, and remembers it across restarts', () => {
    const { house, clock, notices } = openHousekeeping(office)
    doneChat('One')
    doneChat('Two')
    clock.now += 4 * day
    house.tick()
    house.tick()
    expect(notices).toEqual([2])
    const again = openHousekeeping(office)
    again.clock.now = clock.now + hour
    again.house.tick()
    expect(again.notices).toEqual([])
  })
})
