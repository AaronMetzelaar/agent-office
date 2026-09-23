import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readHistory } from '../../src/main/sessions/replay'

const sessionId = '5f0c1a52-8d0b-4c63-9a57-2f7a4b0e9c11'
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-replay-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  const project = join(dir, 'projects', '-Users-aaron-repo')
  mkdirSync(project, { recursive: true })
  const lines: string[] = []
  let parent: string | null = null
  for (let turn = 1; turn <= 5; turn++) {
    const user = `u${turn}`
    const reply = `a${turn}`
    lines.push(JSON.stringify({ type: 'user', uuid: user, parentUuid: parent, sessionId, message: { role: 'user', content: `question ${turn}` } }))
    lines.push(turn === 3 ? '{not json at all' : 'garbage line')
    lines.push(JSON.stringify({ type: 'assistant', uuid: reply, parentUuid: user, sessionId, message: { id: `m${turn}`, role: 'assistant', content: [{ type: 'text', text: `answer ${turn}` }] } }))
    parent = reply
  }
  writeFileSync(join(project, `${sessionId}.jsonl`), lines.join('\n'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

const texts = (events: Awaited<ReturnType<typeof readHistory>>['events']) => events.map((event) => ('text' in event ? event.text : event.type))

describe('readHistory', () => {
  it('reads a transcript back into chat events and skips malformed lines', async () => {
    const { events, more } = await readHistory(sessionId)
    expect(texts(events)).toEqual(['question 1', 'answer 1', 'question 2', 'answer 2', 'question 3', 'answer 3', 'question 4', 'answer 4', 'question 5', 'answer 5'])
    expect(events[0]).toEqual({ type: 'user-text', id: 'u1', text: 'question 1' })
    expect(more).toBe(false)
  })

  it('pages older history from the end', async () => {
    const latest = await readHistory(sessionId, { limit: 4 })
    expect(texts(latest.events)).toEqual(['question 4', 'answer 4', 'question 5', 'answer 5'])
    expect(latest.more).toBe(true)

    const older = await readHistory(sessionId, { skip: 8, limit: 4 })
    expect(texts(older.events)).toEqual(['question 1', 'answer 1'])
    expect(older.more).toBe(false)
  })

  it('returns nothing for a session without a transcript', async () => {
    expect(await readHistory('00000000-0000-4000-8000-000000000000')).toEqual({ events: [], more: false })
  })
})
