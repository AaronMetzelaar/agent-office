import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { maxRows, type ChatPatch } from '../../src/shared/chat'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-history-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function writeTranscript(sessionId: string, turns: number) {
  const project = join(dir, 'projects', '-tmp-repo')
  mkdirSync(project, { recursive: true })
  const lines: string[] = []
  let parent: string | null = null
  for (let turn = 1; turn <= turns; turn++) {
    lines.push(JSON.stringify({ type: 'user', uuid: `u${turn}`, parentUuid: parent, sessionId, message: { role: 'user', content: `question ${turn}` } }))
    lines.push(JSON.stringify({ type: 'assistant', uuid: `a${turn}`, parentUuid: `u${turn}`, sessionId, message: { id: `m${turn}`, role: 'assistant', content: [{ type: 'text', text: `answer ${turn}` }] } }))
    parent = `a${turn}`
  }
  writeFileSync(join(project, `${sessionId}.jsonl`), lines.join('\n'))
}

function relaunchWithHistory(turns: number) {
  const before = openOffice(dir)
  const id = before.start('question 1')
  before.engine.init(id)
  const sessionId = before.engine.sessionId(id)!
  before.store.stopChat(id)
  before.db.close()
  writeTranscript(sessionId, turns)
  return { id, after: openOffice(dir) }
}

const texts = (rows: { kind: string; text?: string }[]) => rows.map((row) => row.text)

describe('lazy replay', () => {
  it('replays nothing at startup, and a chat’s transcript only when it is first opened', async () => {
    const { id, after } = relaunchWithHistory(3)
    const patches: ChatPatch[] = []
    after.store.events.on('patch', (patch) => patches.push(patch))
    await new Promise((done) => setTimeout(done, 20))
    expect(after.chat(id).rows).toEqual([])
    expect(patches).toEqual([])

    await Promise.all([after.store.restore(id), after.store.restore(id)])
    expect(texts(after.chat(id).rows)).toEqual(['question 1', 'answer 1', 'question 2', 'answer 2', 'question 3', 'answer 3'])
    expect(patches.filter((patch) => patch.replaceRows)).toHaveLength(1)
    expect(after.chat(id).earlier).toBeUndefined()

    await after.store.restore(id)
    expect(patches.filter((patch) => patch.replaceRows)).toHaveLength(1)
    after.db.close()
  })
})

describe('older history', () => {
  it('keeps the newest rows in the store and pages older ones in from the transcript', async () => {
    const { id, after } = relaunchWithHistory(250)
    await after.store.restore(id)
    const rows = after.chat(id).rows
    expect(rows).toHaveLength(maxRows)
    expect(rows[0]).toMatchObject({ kind: 'user', text: 'question 151' })
    expect(after.chat(id).earlier).toBe(true)

    const first = await after.store.olderRows(id)
    expect(first.rows).toHaveLength(100)
    expect(first.rows.at(-1)).toMatchObject({ kind: 'text', text: 'answer 150' })
    expect(first.rows[0]).toMatchObject({ kind: 'user', text: 'question 101' })
    expect(first.more).toBe(true)

    const second = await after.store.olderRows(id, first.rows[0]!.id)
    expect([second.rows[0], second.rows.at(-1)]).toMatchObject([{ text: 'question 51' }, { text: 'answer 100' }])
    expect(second.more).toBe(true)

    const last = await after.store.olderRows(id, second.rows[0]!.id)
    expect(last.rows).toHaveLength(100)
    expect(texts(last.rows).slice(0, 2)).toEqual(['question 1', 'answer 1'])
    expect(last.more).toBe(false)

    expect(await after.store.olderRows(id, 'u1')).toEqual({ rows: [], more: false })
    expect(await after.store.olderRows('no-such-chat')).toEqual({ rows: [], more: false })
    after.db.close()
  })
})
