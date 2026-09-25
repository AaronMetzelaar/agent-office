import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { validateWithSdk } from '../../src/main/accounts/health'
import { createWaitMetrics } from '../../src/main/metrics/wait'
import { createBroker, type Broker } from '../../src/main/permissions/registry'
import { createRules } from '../../src/main/permissions/rules'
import { createSessionManager } from '../../src/main/sessions/manager'
import { createRooms } from '../../src/main/departments/rooms'
import { createChatStore } from '../../src/main/store/chats'
import { openDb } from '../../src/main/store/db'

import { configOf } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

const enabled = process.env.AGENT_OFFICE_REAL_TOKENS === '1'

function spikeTokens(): [string, string][] {
  const raw = readFileSync(join(homedir(), '.config', 'agent-office', 'spike.env'), 'utf8')
  const vars = new Map(
    raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes('=') && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
  )
  return [
    ['main', vars.get('MAIN_TOKEN') ?? ''],
    ['research', vars.get('RESEARCH_TOKEN') ?? ''],
  ]
}

describe.skipIf(!enabled)('real token validation', () => {
  it('validates both accounts and reads their headroom', { timeout: 180_000 }, async () => {
    const results = await Promise.all(
      spikeTokens().map(async ([label, token]) => ({
        label,
        ...(await validateWithSdk(token).catch((error: unknown) => ({ status: 'error', message: String(error).split(token).join('[token]') }))),
      })),
    )
    console.log(JSON.stringify(results, null, 2))
    expect(results.map(({ label, status }) => ({ label, status }))).toEqual([
      { label: 'main', status: 'ok' },
      { label: 'research', status: 'ok' },
    ])
  })
})

describe.skipIf(!enabled)('real session smoke', () => {
  it('runs a one-turn chat on each account through the manager and store', { timeout: 180_000 }, async () => {
    const tokens = new Map(spikeTokens())
    const dir = mkdtempSync(join(tmpdir(), 'agent-office-smoke-'))
    const db = openDb(join(dir, 'office.db'))
    let broker: Broker | undefined
    const engine = createSessionManager((id) => tokens.get(id), (...args) => broker!.canUseTool(...args))
    const rules = createRules(db.sql, engine)
    const store = createChatStore(engine, db, { exists: (id) => tokens.has(id), label: (id) => id, needsLogin: () => false, loginFailed: () => {}, recordHeadroom: () => {} }, createRooms(db, configOf(), () => []), rules.forSession)
    broker = createBroker(engine, store, rules, createWaitMetrics(db.sql, store))
    const states = new Map<string, string[]>()
    const pidTracked = new Map<string, boolean>()
    store.events.on('patch', ({ id, fields }) => {
      if (!fields?.state) return
      states.set(id, [...(states.get(id) ?? []), fields.state])
      if (fields.state === 'working') pidTracked.set(id, typeof engine.pid(id) === 'number')
    })

    const chats = [...tokens.keys()].map((label) => {
      const started = store.start(label, dir, 'Reply with exactly: ok', 'haiku')
      if ('error' in started) throw new Error(started.error)
      return [label, started.chatId] as const
    })
    await vi.waitFor(() => expect(store.snapshot().every((chat) => chat.state === 'done' || chat.state === 'stuck')).toBe(true), { timeout: 150_000, interval: 500 })

    const report = chats.map(([label, id]) => {
      const chat = store.snapshot().find((view) => view.id === id)!
      return { label, states: states.get(id), stuck: chat.stuck?.reason, pidTracked: pidTracked.get(id), usage: chat.usage }
    })
    console.log(JSON.stringify(report, null, 2))
    store.shutdown()
    db.close()
    rmSync(dir, { recursive: true, force: true })
    expect(report.map((entry) => entry.states?.at(-1))).toEqual(['done', 'done'])
  })
})
