import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answeredElsewhere } from '../../src/renderer/panels/chat/cards'
import { createDrafts, submit } from '../../src/renderer/panels/chat/draft'
import type { Decision, PendingRequestView, WindowSource } from '../../src/shared/permissions'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let office: ReturnType<typeof openOffice>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-composer-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  office = openOffice(dir)
})

afterEach(() => {
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

const apiFor = (current: ReturnType<typeof openOffice>) => ({
  getDraft: async (chatId: string) => current.store.draft(chatId),
  saveDraft: async (chatId: string, text: string) => current.store.saveDraft(chatId, text),
  sendMessage: async (chatId: string, text: string) => current.store.sendMessage(chatId, text),
  resolveRequest: async (requestId: string, decision: Decision, source: WindowSource) => current.broker.resolveRequest(requestId, decision, source),
})

function asking() {
  const id = office.start('Run the tests')
  office.engine.init(id)
  const decision = office.engine.ask(id, 'Bash', { command: 'pnpm test' })
  return { id, decision, request: office.chat(id).pendingRequests[0]! }
}

describe('drafts', () => {
  it('restores a draft after switching chats and after a relaunch, and stores it encrypted', async () => {
    vi.useFakeTimers()
    const a = office.start('Fix the bid flow')
    const b = office.start('Close stale PRs')
    const drafts = createDrafts(apiFor(office))
    expect(await drafts.load(a)).toBe('')
    drafts.set(a, 'half a thought about rounding')
    expect(await drafts.load(b)).toBe('')
    drafts.set(b, 'something else')
    expect(await drafts.load(a)).toBe('half a thought about rounding')

    await vi.advanceTimersByTimeAsync(400)
    const raw = office.db.sql.prepare('select body from drafts where chat_id = ?').get(a) as { body: Buffer }
    expect(raw.body.toString()).not.toContain('rounding')
    office.db.close()

    office = openOffice(dir)
    const relaunched = createDrafts(apiFor(office))
    expect(await relaunched.load(a)).toBe('half a thought about rounding')
    expect(await relaunched.load(b)).toBe('something else')

    relaunched.set(a, '')
    await relaunched.flush(a)
    expect(office.store.draft(a)).toBe('')
  })

  it('sending while the account needs login keeps the text and asks for a re-login', async () => {
    const id = office.start('Fix the bid flow')
    office.engine.init(id)
    office.loggedOut.add('main')
    const drafts = createDrafts(apiFor(office))
    drafts.set(id, 'Ship it')

    const outcome = await submit(apiFor(office), id, 'Ship it')
    expect(outcome).toMatchObject({ sent: false, needsLogin: true })
    expect(await drafts.load(id)).toBe('Ship it')
    expect(office.engine.sent.map((sent) => sent.text)).not.toContain('Ship it')
    expect(office.chat(id).rows.some((row) => row.kind === 'user' && row.text === 'Ship it')).toBe(false)
  })
})

describe('replying while a request waits', () => {
  it('denies the request with the reply as Claude’s instructions', async () => {
    const { id, decision, request } = asking()
    expect(await submit(apiFor(office), id, 'Run only the unit tests', request)).toEqual({ sent: true })
    expect(await decision).toEqual({ behavior: 'deny', message: 'Run only the unit tests' })
    expect(office.engine.sent.map((sent) => sent.text)).not.toContain('Run only the unit tests')
  })

  it('a request answered from a notification while typing keeps the draft and says where it was answered', async () => {
    const { id, decision, request } = asking()
    const drafts = createDrafts(apiFor(office))
    const seen = new Map<string, PendingRequestView>([[request.id, request]])
    drafts.set(id, 'Actually, only the unit')

    office.broker.resolveRequest(request.id, { kind: 'allow' }, 'notification')
    expect(await decision).toMatchObject({ behavior: 'allow' })

    const chat = office.chat(id)
    expect(answeredElsewhere(seen, chat.pendingRequests, chat.answered)).toEqual([{ request, label: 'Answered from notification · Allowed' }])
    expect(await drafts.load(id)).toBe('Actually, only the unit')
    expect(await submit(apiFor(office), id, 'Actually, only the unit', chat.pendingRequests[0])).toEqual({ sent: true })
    expect(office.engine.sent.at(-1)).toEqual({ chatId: id, text: 'Actually, only the unit' })
  })

  it('a request answered in this panel shows no “answered elsewhere” card', () => {
    const { id, request } = asking()
    office.broker.resolveRequest(request.id, { kind: 'deny' }, 'chat')
    const chat = office.chat(id)
    expect(answeredElsewhere(new Map([[request.id, request]]), chat.pendingRequests, chat.answered)).toEqual([])
  })
})
