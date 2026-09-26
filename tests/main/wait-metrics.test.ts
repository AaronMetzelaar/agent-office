import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { median } from '../../src/main/metrics/wait'
import { createFakeEngine, sdk } from '../fakes/fake-engine'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let office: ReturnType<typeof openOffice>

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] })
  dir = mkdtempSync(join(tmpdir(), 'agent-office-waits-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  office = openOffice(dir)
})

afterEach(() => {
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('median', () => {
  it('takes the middle value, or the mean of the two middle values', () => {
    expect(median([])).toBeUndefined()
    expect(median([30, 10, 20])).toBe(20)
    expect(median([40, 10, 30, 20])).toBe(25)
  })
})

describe('wait metrics', () => {
  it('produce a median blocked-to-resolved time over a sample of requests', async () => {
    const id = office.start()
    office.engine.init(id)
    for (const seconds of [5, 60, 12, 300, 30]) {
      const decision = office.engine.askTool(id, 'Bash', { command: 'pnpm test' })
      vi.advanceTimersByTime(seconds * 1000)
      office.broker.resolveRequest(office.chat(id).pendingRequests[0]!.id, { kind: 'allow' }, 'inbox')
      await decision
    }
    expect(office.waits.median('request')).toBe(30_000)
    expect(office.waits.median('request', Date.now() + 1)).toBeUndefined()
  })

  it('record the time from Done to read, and keep it across a restart', () => {
    const id = office.start()
    office.engine.init(id)
    office.engine.emit(id, sdk.result())
    vi.advanceTimersByTime(90_000)
    office.store.markRead(id)
    office.store.markRead(id)
    office.db.close()

    office = openOffice(dir, createFakeEngine())
    expect(office.waits.median('reply')).toBe(90_000)
  })
})
