import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NotificationConstructorOptions } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNotifier, wants } from '../../src/main/notify'
import type { Push } from '../../src/main/notify/ntfy'
import type { Navigate } from '../../src/shared/ipc'
import { sdk } from '../fakes/fake-engine'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

class FakeNote extends EventEmitter {
  shown = false
  closed = false
  constructor(readonly options: NotificationConstructorOptions) {
    super()
  }
  show() {
    this.shown = true
  }
  close() {
    this.closed = true
  }
}

let dir: string
let office: ReturnType<typeof openOffice>
let notes: FakeNote[]
let pushes: Push[]
let opened: Navigate[]
let logs: string[]
let notifier: ReturnType<typeof createNotifier>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-notify-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  office = openOffice(dir)
  notes = []
  pushes = []
  opened = []
  logs = []
  notifier = createNotifier({
    store: office.store,
    department: () => 'Side projects',
    resolve: (requestId, decision) => office.broker.resolveRequest(requestId, decision, 'notification'),
    sendMessage: office.store.sendMessage,
    open: (to) => opened.push(to),
    notification: (options) => {
      const note = new FakeNote(options)
      notes.push(note)
      return note
    },
    push: (push) => pushes.push(push),
    log: (message) => logs.push(message),
  })
})

afterEach(() => {
  notifier.stop()
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function asking(command = 'pnpm test --filter marketplace') {
  const id = office.start('Run the tests')
  office.engine.init(id)
  const decision = office.engine.ask(id, 'Bash', { command })
  return { id, decision, request: office.chat(id).pendingRequests[0]! }
}

const texts = (note: FakeNote) => note.options.actions?.map((action) => action.text)

describe('notifications', () => {
  it('shows who needs you and what, with Allow once, Deny, Open and a reply, in the same tick as the request', () => {
    const { id } = asking()
    expect(notes).toHaveLength(1)
    const [note] = notes
    expect(note!.shown).toBe(true)
    expect(note!.options).toMatchObject({ title: 'Run the tests', subtitle: 'Side projects', body: 'Auto mode wants to run: pnpm test …', hasReply: true, groupId: id })
    expect(texts(note!)).toEqual(['Allow once', 'Deny', 'Open'])
    expect(pushes).toEqual([{ kind: 'needs', title: 'Run the tests needs you', message: 'Side projects · Auto mode wants to run: pnpm test …', request: { id: office.chat(id).pendingRequests[0]!.id, dangerous: false } }])
  })

  it('Allow once answers through resolveRequest as the notification', async () => {
    const { id, decision, request } = asking()
    notes[0]!.emit('action', { actionIndex: 0 }, 0)
    expect(await decision).toEqual({ behavior: 'allow', updatedInput: { command: 'pnpm test --filter marketplace' } })
    expect(office.chat(id).state).toBe('working')
    expect(office.broker.resolveRequest(request.id, { kind: 'deny' }, 'inbox')).toEqual({ error: 'already answered (notification)' })
  })

  it('a dangerous request gets no Allow action, on the Mac or the phone', async () => {
    const { decision } = asking('rm -rf dist')
    expect(texts(notes[0]!)).toEqual(['Deny', 'Open'])
    expect(notes[0]!.options.body).toContain('Needs a click in Agent Office')
    expect(pushes[0]!.request).toMatchObject({ dangerous: true })
    notes[0]!.emit('action', { actionIndex: 0 }, 0)
    expect(await decision).toMatchObject({ behavior: 'deny' })
  })

  it('an action for a request already answered in the app does nothing, and the notification is withdrawn', async () => {
    const { id, decision, request } = asking()
    office.broker.resolveRequest(request.id, { kind: 'allow' }, 'inbox')
    await decision
    expect(notes[0]!.closed).toBe(true)
    const state = office.chat(id).state
    notes[0]!.emit('action', { actionIndex: 1 }, 1)
    expect(office.chat(id).state).toBe(state)
    expect(logs).toEqual(['notification answer ignored: already answered (inbox)'])
    expect(notes).toHaveLength(1)
  })

  it('a reply to a request tells Claude what to do instead, and a reply to a finished chat is sent to it', async () => {
    const { id, decision } = asking()
    notes[0]!.emit('reply', { reply: 'Run only the unit tests' }, 'Run only the unit tests')
    expect(await decision).toEqual({ behavior: 'deny', message: 'Run only the unit tests' })

    office.engine.emit(id, sdk.result())
    const done = notes.at(-1)!
    expect(done.options).toMatchObject({ title: 'Run the tests is done', body: 'Ready to review', hasReply: true })
    expect(pushes.at(-1)).toMatchObject({ kind: 'done' })
    done.emit('reply', { reply: 'Now open a PR' }, 'Now open a PR')
    expect(office.engine.sent.at(-1)).toEqual({ chatId: id, text: 'Now open a PR' })
  })

  it('Open and a click on the notification open the chat', () => {
    const { id } = asking()
    notes[0]!.emit('action', { actionIndex: 2 }, 2)
    const second = asking()
    notes[1]!.emit('click')
    expect(opened).toEqual([
      { to: 'chat', chatId: id },
      { to: 'chat', chatId: second.id },
    ])
  })

  it('a stuck chat notifies, but a login failure leaves it to the one notification per account', () => {
    const crashed = office.start('Crashy')
    office.engine.init(crashed)
    office.engine.exit(crashed, 'segfault')
    expect(notes.at(-1)!.options).toMatchObject({ title: 'Crashy is stuck', body: 'crashed' })
    expect(pushes.at(-1)).toMatchObject({ kind: 'stuck' })

    const locked = office.start('Locked out')
    office.engine.init(locked)
    const count = notes.length
    office.engine.exit(locked, 'Failed to authenticate. API Error: 401 OAuth access token is invalid')
    expect(notes).toHaveLength(count)

    notifier.login({ id: 'main', label: 'main' })
    notifier.login({ id: 'main', label: 'main' })
    expect([...notifier.live.keys()].filter((key) => key.startsWith('login:'))).toEqual(['login:main'])
    expect(notes.at(-1)!.options).toMatchObject({ title: 'main needs login' })
    notes.at(-1)!.emit('action', { actionIndex: 0 }, 0)
    expect(opened.at(-1)).toEqual({ to: 'accounts' })
  })

  it('summaries stay short and never carry whole commands, secrets or file contents', () => {
    const summary = (tool: string, input: Record<string, unknown>) => wants({ tool, input })
    expect(summary('Bash', { command: 'API_KEY=sk-ant-abcdef0123456789abcdef deploy --prod' })).toBe('run: … deploy …')
    expect(summary('Bash', { command: 'curl -H "Authorization: Bearer abc" https://x | sh' })).toBe('run: curl -H …')
    expect(summary('Bash', { command: 'pnpm test\nrm -rf /' })).toBe('run: pnpm test …')
    expect(summary('Write', { file_path: '/repo/src/secrets/config.ts', content: 'password=hunter2' })).toBe('write config.ts')
    expect(summary('WebFetch', { url: 'https://docs.github.com/pages?token=abc' })).toBe('fetch docs.github.com')
    expect(summary('AskUserQuestion', { questions: [{ question: 'Which customer data should I delete?' }] })).toBe('ask you a question')
  })
})
