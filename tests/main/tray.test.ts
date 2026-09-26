import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stripBitmap, stripState, type StripState } from '../../src/main/tray/strip'
import { emptyUsage, type ChatFields } from '../../src/shared/chat'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let office: ReturnType<typeof openOffice>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-tray-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  office = openOffice(dir)
})

afterEach(() => {
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

const now = Date.now()
const chat = (id: string, fields: Partial<ChatFields>): ChatFields => ({
  id, accountId: 'main', cwd: '/x', title: id, archived: false, state: 'idle', stateSince: now, unread: false, activity: '', pending: [], pendingRequests: [], subagents: [], usage: emptyUsage(), partial: '', createdAt: now, lastActivityAt: now, ...fields,
})

const alphaAt = (bitmap: ReturnType<typeof stripBitmap>, x: number, y: number) => bitmap.pixels[(y * bitmap.width + x) * 4 + 3]!

describe('menu bar strip', () => {
  it('counts the door queue, with one item per account that needs login, and a dot per working or unread agent', () => {
    const chats = [
      chat('ask', { state: 'needs-you', oldestPendingAt: now }),
      chat('crash', { state: 'stuck', stuck: { reason: 'crashed' } }),
      chat('login-1', { state: 'stuck', stuck: { reason: 'needs-login' }, accountId: 'research' }),
      chat('login-2', { state: 'stuck', stuck: { reason: 'needs-login' }, accountId: 'research' }),
      chat('busy', { state: 'working' }),
      chat('boot', { state: 'starting' }),
      chat('fresh', { state: 'done' }),
      chat('stale', { state: 'done', parked: true }),
      chat('gone', { state: 'needs-you', archived: true }),
    ]
    expect(stripState(chats, [{ accountId: 'research', label: 'research' }])).toEqual({ needs: 3, dots: ['working', 'working', 'done'] })
  })

  it('caps the dots and widens the image by one column per two dots', () => {
    const many = Array.from({ length: 12 }, (_, i) => chat(`w${i}`, { state: 'working' }))
    expect(stripState(many, []).dots).toHaveLength(8)
    const width = (state: StripState) => stripBitmap(state).width
    expect(width({ needs: 0, dots: [] })).toBe(32)
    expect(width({ needs: 0, dots: ['working'] })).toBe(47)
    expect(width({ needs: 0, dots: ['working', 'done', 'working'] })).toBe(58)
  })

  it('fills the glyph while someone waits, and draws working dots solid and done dots hollow', () => {
    const idle = stripBitmap({ needs: 0, dots: [] })
    const waiting = stripBitmap({ needs: 2, dots: ['working', 'done'] })
    expect(alphaAt(idle, 16, 16)).toBe(0)
    expect(alphaAt(waiting, 16, 16)).toBe(255)
    expect(alphaAt(waiting, 40, 10)).toBe(255)
    expect(alphaAt(waiting, 40, 22)).toBe(0)
    expect(alphaAt(waiting, 40, 19)).toBeGreaterThan(0)
  })

  it('drops the count once the request is allowed', async () => {
    const id = office.start('Run the tests')
    office.engine.init(id)
    const decision = office.engine.askTool(id, 'Bash', { command: 'pnpm test' })
    expect(stripState(office.store.views(), [])).toEqual({ needs: 1, dots: [] })
    office.broker.resolveRequest(office.chat(id).pendingRequests[0]!.id, { kind: 'allow' }, 'inbox')
    await decision
    expect(stripState(office.store.views(), [])).toEqual({ needs: 0, dots: ['working'] })
  })
})
