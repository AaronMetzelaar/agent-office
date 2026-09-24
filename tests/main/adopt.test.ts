import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let office: ReturnType<typeof openOffice>
const original = randomUUID()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-adopt-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  office = openOffice(dir)
})

afterEach(() => {
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

const adopt = () => office.store.adopt({ accountId: 'main', cwd: dir, title: 'Fix the bid rounding', department: 'mkt', sessionId: original })

describe('move into the office', () => {
  it('waits for your message, then forks the original instead of resuming it', () => {
    const { engine, store, chat } = office
    const id = adopt()
    expect(chat(id)).toMatchObject({ state: 'idle', forkPending: true, sessionId: original, department: 'mkt', rows: [{ kind: 'other' }] })
    expect(engine.starts).toEqual([])

    store.sendMessage(id, 'Carry on with the tests')
    expect(engine.starts[0]?.options).toMatchObject({ accountId: 'main', resume: original, forkSession: true })
    engine.init(id)
    expect(chat(id).sessionId).not.toBe(original)
    expect(chat(id).forkPending).toBe(false)

    const forked = chat(id).sessionId
    store.stopChat(id)
    store.resumeChat(id)
    expect(engine.starts[1]?.options).toMatchObject({ resume: forked })
    expect(engine.starts[1]?.options.forkSession).toBeUndefined()
  })

  it('still forks after a restart that happens before the first message', () => {
    const id = adopt()
    office.db.close()
    office = openOffice(dir)
    expect(office.chat(id)).toMatchObject({ forkPending: true, sessionId: original })
    office.store.sendMessage(id, 'Carry on')
    expect(office.engine.starts[0]?.options).toMatchObject({ resume: original, forkSession: true })
  })
})
