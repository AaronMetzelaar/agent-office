import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { statSync } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk'
import { efforts, emptyUsage, maxRows, type ChatFields, type ChatPatch, type ChatRow, type ChatState, type ChatView, type Effort, type Refusal, type StartChatResult, type Stuck } from '../../shared/chat'
import type { PendingRequestView } from '../../shared/permissions'
import type { Engine, SessionPermissions } from '../sessions/manager'
import { errorReason, normalize, type ChatEvent } from '../sessions/normalize'
import { readHistory } from '../sessions/replay'
import type { ChatRecord, Db } from './db'

export interface AccountHooks {
  exists(id: string): boolean
  needsLogin(id: string): boolean
  loginFailed(id: string): void
  recordHeadroom(id: string, info: SDKRateLimitInfo): void
}

interface Chat {
  view: ChatView
  background: Set<string>
  interrupting: boolean
  retryAt?: number
  lastError?: string
  doneAt?: number
  readAt?: number
}

export type ChatStore = ReturnType<typeof createChatStore>

const midTurn = new Set<ChatState>(['starting', 'working', 'needs-you'])
const resumePrompt = 'Continue where you left off.'
const modelPattern = /^[\w.:[\]-]{1,80}$/
const noPending = { pending: [], pendingRequests: [], oldestPendingAt: undefined }
const needsLogin: Refusal = { error: 'This account needs a new login. Add its token again in Accounts, then try again.', code: 'needs-login' }

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

function describeTool(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>
  const file = basename(String(args.file_path ?? args.notebook_path ?? args.path ?? ''))
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Editing ${file}`
    case 'Write':
      return `Writing ${file}`
    case 'Read':
      return `Reading ${file}`
    case 'Bash':
      return `Running ${String(args.command ?? '').split('\n')[0]!.slice(0, 48)}`
    case 'Grep':
    case 'Glob':
      return `Searching ${String(args.pattern ?? '')}`
    case 'WebFetch':
    case 'WebSearch':
      return 'Searching the web'
    default:
      return `Using ${name}`
  }
}

function rowFor(rows: ChatRow[], event: ChatEvent): ChatRow | undefined {
  const parent = 'parentToolUseId' in event && event.parentToolUseId ? { parentToolUseId: event.parentToolUseId } : {}
  switch (event.type) {
    case 'text':
      return { kind: 'text', id: event.id, text: event.text, ...parent }
    case 'tool-use':
      return { kind: 'tool', id: event.id, name: event.name, input: event.input, ...parent }
    case 'tool-result': {
      const tool = rows.findLast((row) => row.id === event.toolUseId)
      return tool?.kind === 'tool' ? { ...tool, result: { text: event.text, isError: event.isError } } : undefined
    }
    case 'user-text':
      return { kind: 'user', id: event.id, text: event.text }
    case 'other':
      return { kind: 'other', id: randomUUID(), label: event.label }
    default:
      return undefined
  }
}

function upsert(rows: ChatRow[], row: ChatRow): void {
  const index = rows.findLastIndex((existing) => existing.id === row.id)
  if (index !== -1) rows[index] = row
  else if (rows.push(row) > maxRows) rows.splice(0, rows.length - maxRows)
}

function fromRecord(record: ChatRecord): Chat {
  const { doneAt, readAt, ...fields } = record
  const view: ChatView = { ...fields, stateSince: record.lastActivityAt, activity: '', pending: [], pendingRequests: [], subagents: [], partial: '', rows: [] }
  return { view, background: new Set(), interrupting: false, doneAt, readAt }
}

function toRecord({ view, doneAt, readAt }: Chat): ChatRecord {
  const { stateSince: _s, activity: _a, pending: _p, pendingRequests: _q, oldestPendingAt: _o, subagents: _g, partial: _t, rows: _r, ...fields } = view
  return { ...fields, doneAt, readAt }
}

export function createChatStore(engine: Engine, db: Db, accounts: AccountHooks, permissionsFor: (chatId: string, accountId: string, cwd: string) => SessionPermissions | undefined = () => undefined) {
  const events = new EventEmitter<{ patch: [ChatPatch]; read: [chatId: string, doneAt: number, readAt: number] }>()
  const chats = new Map<string, Chat>()

  const emit = (patch: ChatPatch) => events.emit('patch', patch)
  const save = (chat: Chat) => db.saveChat(toRecord(chat))
  const set = (chat: Chat, fields: Partial<ChatFields>) => {
    Object.assign(chat.view, fields)
    emit({ id: chat.view.id, fields })
  }
  const addRow = (chat: Chat, row: ChatRow) => {
    upsert(chat.view.rows, row)
    emit({ id: chat.view.id, rows: [row] })
  }
  const transition = (chat: Chat, state: ChatState, fields: Partial<ChatFields> = {}) => {
    const now = Date.now()
    set(chat, { state, stateSince: now, lastActivityAt: now, ...fields })
    save(chat)
  }

  function stuck(chat: Chat, reason: Stuck) {
    if (chat.view.partial) addRow(chat, { kind: 'text', id: randomUUID(), text: chat.view.partial })
    transition(chat, 'stuck', { stuck: reason, ...noPending, subagents: [], partial: '' })
  }

  function fail(chat: Chat, error: string | undefined, fallback: 'crashed' | 'error') {
    if (chat.view.state === 'stuck') return
    const reason = errorReason(error) ?? fallback
    if (reason === 'needs-login') accounts.loginFailed(chat.view.accountId)
    stuck(chat, { reason, ...(error ? { detail: error } : {}), ...(reason === 'rate-limited' && chat.retryAt ? { retryAt: chat.retryAt } : {}) })
  }

  function dropSubagent(chat: Chat, id: string) {
    if (chat.view.subagents.some((agent) => agent.id === id)) set(chat, { subagents: chat.view.subagents.filter((agent) => agent.id !== id) })
  }

  function guard(chatId: string, handle: (chat: Chat) => void) {
    const chat = chats.get(chatId)
    if (!chat) return
    try {
      handle(chat)
    } catch (error) {
      engine.stop(chatId)
      fail(chat, errorText(error), 'crashed')
    }
  }

  function apply(chat: Chat, event: ChatEvent) {
    const view = chat.view
    const row = rowFor(view.rows, event)
    if (row) addRow(chat, row)
    switch (event.type) {
      case 'session':
        set(chat, { sessionId: event.sessionId, model: event.model })
        if (view.state === 'starting') transition(chat, 'working')
        else save(chat)
        break
      case 'text-delta':
        view.partial += event.text
        emit({ id: view.id, partialAppend: event.text })
        if (view.activity !== 'Writing a reply') set(chat, { activity: 'Writing a reply' })
        break
      case 'text':
        if (!event.parentToolUseId && view.partial) set(chat, { partial: '' })
        break
      case 'tool-use':
        if (!event.parentToolUseId) set(chat, { activity: describeTool(event.name, event.input) })
        break
      case 'tool-result':
        if (!chat.background.has(event.toolUseId)) dropSubagent(chat, event.toolUseId)
        break
      case 'subagent-start':
        if (event.background) chat.background.add(event.id)
        set(chat, { subagents: [...view.subagents, { id: event.id, description: event.description }] })
        break
      case 'subagent-stop':
        chat.background.delete(event.id)
        dropSubagent(chat, event.id)
        break
      case 'turn-result': {
        const interrupted = chat.interrupting
        const lastError = chat.lastError
        chat.interrupting = false
        chat.lastError = undefined
        set(chat, { usage: event.usage })
        if (event.isError && !interrupted) fail(chat, [lastError, event.errorText].filter(Boolean).join(': '), 'error')
        else if (midTurn.has(view.state)) {
          chat.doneAt = Date.now()
          transition(chat, 'done', { unread: true, activity: '', ...noPending, subagents: [], partial: '' })
        } else save(chat)
        break
      }
      case 'headroom':
        accounts.recordHeadroom(view.accountId, event.info)
        break
      case 'retry-at':
        chat.retryAt = event.at
        break
      case 'api-error':
        chat.lastError = event.error
        break
    }
  }

  engine.events.on('message', (chatId, message) =>
    guard(chatId, (chat) => {
      for (const event of normalize(message)) apply(chat, event)
    }),
  )
  engine.events.on('end', (chatId, error) =>
    guard(chatId, (chat) => {
      if (midTurn.has(chat.view.state)) fail(chat, error ?? 'The Claude process exited mid-turn', 'crashed')
    }),
  )

  function send(chat: Chat, text: string, fields: Partial<ChatFields> = {}) {
    const view = chat.view
    addRow(chat, { kind: 'user', id: randomUUID(), text })
    if (view.state === 'idle' || view.state === 'done' || view.state === 'stuck') transition(chat, 'working', { unread: false, stuck: undefined, activity: 'Thinking', partial: '', ...fields })
    try {
      if (!engine.running(view.id)) engine.start(view.id, { accountId: view.accountId, cwd: view.cwd, model: view.model, effort: view.effort, permissions: permissionsFor(view.id, view.accountId, view.cwd), resume: view.sessionId })
      engine.send(view.id, text)
    } catch (error) {
      fail(chat, errorText(error), 'crashed')
    }
  }

  const find = (chatId: unknown) => (typeof chatId === 'string' ? chats.get(chatId) : undefined)

  for (const record of db.listChats()) {
    const chat = fromRecord(record)
    chats.set(chat.view.id, chat)
    if (midTurn.has(chat.view.state)) transition(chat, 'stuck', { stuck: { reason: 'interrupted' } })
  }

  const restored = Promise.all(
    [...chats.values()].map(async (chat) => {
      if (!chat.view.sessionId || chat.view.archived) return
      const { events: history } = await readHistory(chat.view.sessionId).catch(() => ({ events: [] }))
      const rows: ChatRow[] = []
      for (const event of history) {
        const row = rowFor(rows, event)
        if (row) upsert(rows, row)
      }
      const known = new Set(rows.map((row) => row.id))
      chat.view.rows = [...rows, ...chat.view.rows.filter((row) => !known.has(row.id))].slice(-maxRows)
      emit({ id: chat.view.id, rows: chat.view.rows, replaceRows: true })
    }),
  )

  return {
    events,
    restored,
    snapshot: (): ChatView[] => [...chats.values()].map((chat) => structuredClone(chat.view)),
    busy: () => [...chats.values()].some((chat) => midTurn.has(chat.view.state)),

    start(accountId: unknown, cwd: unknown, prompt: unknown, model?: unknown, effort?: unknown): StartChatResult {
      if (typeof accountId !== 'string' || !accounts.exists(accountId)) return { error: 'Pick an account first.' }
      if (accounts.needsLogin(accountId)) return needsLogin
      if (typeof cwd !== 'string' || !isAbsolute(cwd) || !statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) return { error: 'Pick an existing folder.' }
      if (typeof prompt !== 'string' || !prompt.trim()) return { error: 'Write a prompt first.' }
      if (model !== undefined && (typeof model !== 'string' || !modelPattern.test(model))) return { error: 'That model name isn’t valid.' }
      if (effort !== undefined && !efforts.includes(effort as Effort)) return { error: 'That effort level isn’t valid.' }
      const now = Date.now()
      const view: ChatView = {
        id: randomUUID(),
        accountId,
        cwd,
        title: prompt.trim().split('\n')[0]!.slice(0, 60),
        ...(model ? { model: model as string } : {}),
        ...(effort ? { effort: effort as Effort } : {}),
        archived: false,
        state: 'starting',
        stateSince: now,
        unread: false,
        activity: 'Thinking',
        pending: [],
        pendingRequests: [],
        subagents: [],
        usage: emptyUsage(),
        partial: '',
        createdAt: now,
        lastActivityAt: now,
        rows: [],
      }
      const chat: Chat = { view, background: new Set(), interrupting: false }
      chats.set(view.id, chat)
      save(chat)
      const { rows: _rows, ...fields } = view
      emit({ id: view.id, fields, rows: [], replaceRows: true })
      send(chat, prompt)
      return { chatId: view.id }
    },

    sendMessage(chatId: unknown, text: unknown): Refusal | undefined {
      const chat = find(chatId)
      if (!chat || typeof text !== 'string' || !text.trim()) return undefined
      if (accounts.needsLogin(chat.view.accountId)) return needsLogin
      send(chat, text)
      return undefined
    },

    resumeChat(chatId: unknown): Refusal | undefined {
      const chat = find(chatId)
      if (chat?.view.state !== 'stuck') return undefined
      if (accounts.needsLogin(chat.view.accountId)) return needsLogin
      engine.stop(chat.view.id)
      const firstPrompt = chat.view.rows.find((row) => row.kind === 'user')?.text
      send(chat, chat.view.sessionId ? resumePrompt : (firstPrompt ?? resumePrompt))
      return undefined
    },

    async interruptChat(chatId: unknown): Promise<void> {
      const chat = find(chatId)
      if (!chat || !engine.running(chat.view.id)) return
      chat.interrupting = true
      await engine.interrupt(chat.view.id).catch(() => (chat.interrupting = false))
    },

    stopChat(chatId: unknown): void {
      const chat = find(chatId)
      if (!chat) return
      engine.stop(chat.view.id)
      if (midTurn.has(chat.view.state)) stuck(chat, { reason: 'interrupted' })
    },

    async setModel(chatId: unknown, model: unknown): Promise<void> {
      const chat = find(chatId)
      if (!chat || typeof model !== 'string' || !modelPattern.test(model)) return
      set(chat, { model })
      save(chat)
      if (engine.running(chat.view.id)) await engine.setModel(chat.view.id, model)
    },

    async setEffort(chatId: unknown, effort: unknown): Promise<void> {
      const chat = find(chatId)
      if (!chat || !efforts.includes(effort as Effort)) return
      set(chat, { effort: effort as Effort })
      save(chat)
      if (engine.running(chat.view.id)) await engine.setEffort(chat.view.id, effort as Effort)
    },

    markRead(chatId: unknown): void {
      const chat = find(chatId)
      if (chat?.view.state !== 'done') return
      chat.readAt = Date.now()
      if (chat.doneAt) events.emit('read', chat.view.id, chat.doneAt, chat.readAt)
      transition(chat, 'idle', { unread: false })
    },

    context(chatId: string): { accountId: string; cwd: string } | undefined {
      const chat = chats.get(chatId)
      return chat && chat.view.state !== 'stuck' ? { accountId: chat.view.accountId, cwd: chat.view.cwd } : undefined
    },

    addPending(chatId: string, request: PendingRequestView): void {
      const chat = chats.get(chatId)
      if (!chat || chat.view.state === 'stuck') return
      const pendingRequests = [...chat.view.pendingRequests, request]
      const fields = { pending: [...chat.view.pending, { id: request.id, toolName: request.tool }], pendingRequests, oldestPendingAt: pendingRequests[0]!.createdAt }
      if (chat.view.state !== 'needs-you') transition(chat, 'needs-you', fields)
      else set(chat, fields)
    },

    resolvePending(chatId: string, requestId: string): void {
      const chat = chats.get(chatId)
      if (!chat?.view.pendingRequests.some((request) => request.id === requestId)) return
      const pendingRequests = chat.view.pendingRequests.filter((request) => request.id !== requestId)
      const fields = { pending: chat.view.pending.filter((request) => request.id !== requestId), pendingRequests, oldestPendingAt: pendingRequests[0]?.createdAt }
      if (chat.view.state === 'needs-you' && pendingRequests.length === 0) transition(chat, 'working', fields)
      else set(chat, fields)
    },

    accountRemoved(accountId: string): void {
      for (const chat of chats.values()) {
        if (chat.view.accountId !== accountId) continue
        engine.stop(chat.view.id)
        stuck(chat, { reason: 'needs-login', detail: 'This chat’s account was removed.' })
      }
    },

    shutdown(): void {
      for (const chat of chats.values()) {
        engine.stop(chat.view.id)
        if (midTurn.has(chat.view.state)) stuck(chat, { reason: 'interrupted' })
      }
    },
  }
}
