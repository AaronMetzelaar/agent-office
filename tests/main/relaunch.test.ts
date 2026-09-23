import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmQuitWhileBusy, hideOnClose } from '../../src/main/lifecycle'
import { createFakeEngine, sdk } from '../fakes/fake-engine'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-relaunch-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function quitEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
  }
}

function quittingApp(office: ReturnType<typeof openOffice>, answer: boolean) {
  const app = Object.assign(new EventEmitter(), { quit: vi.fn() })
  const confirm = vi.fn(async () => answer)
  confirmQuitWhileBusy(app, office.store.busy, confirm, office.store.shutdown)
  return { app, confirm }
}

function workingChat(office: ReturnType<typeof openOffice>) {
  const id = office.start('Fix the bid flow')
  office.engine.init(id)
  return id
}

function writeTranscript(sessionId: string) {
  const project = join(dir, 'projects', '-tmp-repo')
  mkdirSync(project, { recursive: true })
  const line = (fields: object) => JSON.stringify({ sessionId, timestamp: '2026-09-23T10:00:00Z', ...fields })
  writeFileSync(
    join(project, `${sessionId}.jsonl`),
    [
      line({ type: 'user', uuid: 'u1', parentUuid: null, message: { role: 'user', content: 'Fix the bid flow' } }),
      line({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Looking at BidFlow.vue' }] } }),
      '{"type":"assistant", truncated',
      line({ type: 'assistant', uuid: 'a2', parentUuid: 'a1', message: { id: 'm2', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/BidFlow.vue' } }] } }),
      line({ type: 'user', uuid: 'u2', parentUuid: 'a2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '<template/>' }] } }),
    ].join('\n'),
  )
}

describe('quit confirmation', () => {
  it('asks before quitting while a chat works, and Cancel keeps it working', async () => {
    const office = openOffice(dir)
    const id = workingChat(office)
    const { app, confirm } = quittingApp(office, false)
    const event = quitEvent()

    app.emit('before-quit', event)
    await confirm.mock.results[0]?.value

    expect(event.defaultPrevented).toBe(true)
    expect(app.quit).not.toHaveBeenCalled()
    expect(office.chat(id).state).toBe('working')
    office.db.close()
  })

  it('Quit interrupts working turns, stops every session and quits', async () => {
    const office = openOffice(dir)
    const id = workingChat(office)
    const { app, confirm } = quittingApp(office, true)

    app.emit('before-quit', quitEvent())
    await confirm.mock.results[0]?.value
    expect(app.quit).toHaveBeenCalledOnce()

    const second = quitEvent()
    app.emit('before-quit', second)
    expect(second.defaultPrevented).toBe(false)
    expect(office.chat(id)).toMatchObject({ state: 'stuck', stuck: { reason: 'interrupted' } })
    expect(office.engine.running(id)).toBe(false)
    office.db.close()
  })

  it('quits without asking when nothing is working', () => {
    const office = openOffice(dir)
    const id = workingChat(office)
    office.engine.emit(id, sdk.result())
    const { app, confirm } = quittingApp(office, true)
    const event = quitEvent()

    app.emit('before-quit', event)

    expect(confirm).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(office.chat(id).state).toBe('done')
    office.db.close()
  })

  it('a cancelled quit keeps the window hiding on close', async () => {
    const office = openOffice(dir)
    workingChat(office)
    const { app, confirm } = quittingApp(office, false)
    const win = new EventEmitter()
    const hide = vi.fn()
    hideOnClose(app, win, hide)

    app.emit('before-quit', quitEvent())
    await confirm.mock.results[0]?.value
    const close = { preventDefault: vi.fn() }
    win.emit('close', close)

    expect(close.preventDefault).toHaveBeenCalled()
    expect(hide).toHaveBeenCalled()
    office.db.close()
  })
})

describe('relaunch', () => {
  it('a chat that was mid-turn when the app died comes back Stuck (interrupted)', () => {
    const before = openOffice(dir)
    const id = workingChat(before)
    before.db.close()

    const after = openOffice(dir)
    expect(after.chat(id)).toMatchObject({ state: 'stuck', stuck: { reason: 'interrupted' } })
    expect(after.engine.starts).toEqual([])
    after.db.close()
  })

  it('Resume continues the same session id, never a fork', () => {
    const before = openOffice(dir)
    const id = workingChat(before)
    const sessionId = before.engine.sessionId(id)
    before.store.shutdown()
    before.db.close()

    const engine = createFakeEngine()
    const after = openOffice(dir, engine)
    after.store.resumeChat(id)
    expect(engine.starts).toEqual([{ chatId: id, options: expect.objectContaining({ resume: sessionId }) }])
    expect(engine.starts[0]?.options.forkSession).toBeUndefined()
    expect(engine.sent).toEqual([{ chatId: id, text: 'Continue where you left off.' }])
    expect(after.chat(id).state).toBe('working')

    engine.init(id)
    expect(after.chat(id)).toMatchObject({ state: 'working', sessionId })
    after.db.close()
  })

  it('replays a Stuck chat’s earlier turns from its transcript', async () => {
    const before = openOffice(dir)
    const id = workingChat(before)
    const sessionId = before.engine.sessionId(id)!
    before.db.close()
    writeTranscript(sessionId)

    const after = openOffice(dir)
    await after.store.restore(id)

    expect(after.chat(id).rows).toEqual([
      { kind: 'user', id: 'u1', text: 'Fix the bid flow' },
      { kind: 'text', id: 'a1:0', text: 'Looking at BidFlow.vue' },
      { kind: 'tool', id: 't1', name: 'Read', input: { file_path: '/repo/BidFlow.vue' }, result: { text: '<template/>', isError: false } },
    ])
    after.db.close()
  })
})
