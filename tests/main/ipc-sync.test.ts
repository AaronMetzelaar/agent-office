import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPatchSync } from '../../src/main/store/ipc-sync'
import { applyPatch, type ChatPatchBatch, type ChatView } from '../../src/shared/chat'
import { sdk } from '../fakes/fake-engine'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let office: ReturnType<typeof openOffice>
let pushed: ChatPatchBatch[]
let sync: ReturnType<typeof createPatchSync>

beforeEach(() => {
  vi.useFakeTimers()
  dir = mkdtempSync(join(tmpdir(), 'agent-office-sync-'))
  office = openOffice(dir)
  pushed = []
  sync = createPatchSync(office.store, (batch) => pushed.push(batch))
  sync.setVisible(true)
})

afterEach(() => {
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

function renderer() {
  let seq = -1
  let chats = new Map<string, ChatView>()
  return {
    load() {
      const snapshot = sync.snapshot()
      seq = snapshot.seq
      chats = new Map(snapshot.chats.map((chat) => [chat.id, chat]))
    },
    apply(batch: ChatPatchBatch) {
      if (batch.seq <= seq) return
      seq = batch.seq
      for (const patch of batch.patches) chats.set(patch.id, applyPatch(chats.get(patch.id) ?? ({ ...patch.fields, rows: [] } as ChatView), patch))
    },
    chat: (id: string) => chats.get(id),
  }
}

function startWorking(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const id = office.start(`Chat ${index}`)
    office.engine.init(id)
    return id
  })
}

describe('ipc sync', () => {
  it('flushes at most once per frame tick while 15 chats stream', () => {
    const ids = startWorking(15)
    vi.advanceTimersByTime(16)
    pushed = []
    for (let elapsed = 0; elapsed < 1000; elapsed += 4) {
      for (const id of ids) office.engine.emit(id, sdk.delta('x'))
      vi.advanceTimersByTime(4)
    }
    vi.advanceTimersByTime(16)

    expect(pushed.length).toBeLessThanOrEqual(Math.ceil(1000 / 16) + 1)
    expect(pushed.every((batch) => batch.patches.length === 15)).toBe(true)
    const streamed = pushed.flatMap((batch) => batch.patches).filter((patch) => patch.id === ids[0])
    expect(streamed.map((patch) => patch.partialAppend).join('')).toBe('x'.repeat(250))
  })

  it('pushes only state transitions while the window is hidden', () => {
    const [id] = startWorking(1) as [string]
    sync.setVisible(false)
    vi.advanceTimersByTime(16)
    pushed = []

    office.engine.emit(id, sdk.delta('secret draft text'))
    office.engine.emit(id, sdk.toolUse([{ id: 't1', name: 'Bash', input: { command: 'pnpm test' } }]))
    vi.advanceTimersByTime(16)
    expect(pushed).toEqual([])

    office.engine.emit(id, sdk.text('secret draft text'))
    office.engine.emit(id, sdk.result())
    vi.advanceTimersByTime(16)
    expect(pushed).toEqual([{ seq: expect.any(Number), patches: [{ id, fields: { state: 'done', stuck: undefined } }] }])
  })

  it('a renderer reloaded mid-stream gets the in-flight partial text in its snapshot, then diffs', () => {
    const [id] = startWorking(1) as [string]
    const view = renderer()
    office.engine.emit(id, sdk.delta('Hel'))
    vi.advanceTimersByTime(16)
    const inFlight = pushed.at(-1)!
    office.engine.emit(id, sdk.delta('lo'))

    view.load()
    expect(view.chat(id)?.partial).toBe('Hello')

    view.apply(inFlight)
    office.engine.emit(id, sdk.delta(' there'))
    vi.advanceTimersByTime(16)
    view.apply(pushed.at(-1)!)
    expect(view.chat(id)?.partial).toBe('Hello there')

    office.engine.emit(id, sdk.text('Hello there'))
    office.engine.emit(id, sdk.toolUse([{ id: 't1', name: 'Read', input: { file_path: '/repo/a.ts' } }]))
    office.engine.emit(id, sdk.toolResult('t1', 'contents'))
    office.engine.emit(id, sdk.delta('Next'))
    vi.advanceTimersByTime(16)
    view.apply(pushed.at(-1)!)
    expect(view.chat(id)).toEqual(office.chat(id))
  })

  it('a new chat arrives complete through patches alone', () => {
    const view = renderer()
    view.load()
    const [id] = startWorking(1) as [string]
    office.engine.emit(id, sdk.delta('Hi'))
    vi.advanceTimersByTime(16)
    for (const batch of pushed) view.apply(batch)
    expect(view.chat(id)).toEqual(office.chat(id))
  })
})
