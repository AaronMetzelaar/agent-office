import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { statSync } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk'
import { defaultEffort, defaultModel, efforts, emptyUsage, maxRows, simulatorTool, type Answered, type ChatFields, type ChatMode, type ChatPatch, type ChatRow, type ChatState, type ChatView, type Effort, type OlderRows, type Refusal, type StartChatResult, type Stuck } from '../../shared/chat'
import { playgroundRoom, repoPath, type StartOptions } from '../../shared/departments'
import { pickColour } from '../../shared/office'
import type { PendingRequestView } from '../../shared/permissions'
import type { Rooms } from '../departments/rooms'
import type { Engine, SessionPermissions } from '../sessions/manager'
import { errorReason, normalize, type ChatEvent } from '../sessions/normalize'
import { readHistory } from '../sessions/replay'
import { createWorktree, planWorktree, slugFor, type WorktreePlan } from '../worktrees/create'
import type { ChatRecord, Db } from './db'

export interface AccountHooks {
  exists(id: string): boolean
  label(id: string): string | undefined
  needsLogin(id: string): boolean
  loginFailed(id: string): void
  recordHeadroom(id: string, info: SDKRateLimitInfo): void
}

interface Chat {
  view: ChatView
  background: Set<string>
  backgroundTasks: number
  interrupting: boolean
  retryAt?: number
  lastError?: string
  doneAt?: number
  readAt?: number
  previousMode?: ChatMode
  restoring?: Promise<void>
}

export type ChatStore = ReturnType<typeof createChatStore>

const midTurn = new Set<ChatState>(['starting', 'working', 'needs-you'])
const resumePrompt = 'Continue where you left off.'
const modelPattern = /^[\w.:[\]-]{1,80}$/
const noPending = { pending: [], pendingRequests: [], oldestPendingAt: undefined }
const olderPage = 100
const maxDraft = 100_000
const needsLogin: Refusal = { error: 'This account needs a new login. Add its token again in Accounts, then try again.', code: 'needs-login' }

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const modelOrDefault = (model: unknown) => (model == null || model === '' || model === 'default' ? defaultModel : model)

export function describeTool(name: string, input: unknown): string {
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
    case simulatorTool:
      return `Using the simulator · ${String(args.action ?? '')}`
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

function upsert(rows: ChatRow[], row: ChatRow, cap = maxRows): void {
  const index = rows.findLastIndex((existing) => existing.id === row.id)
  if (index !== -1) rows[index] = row
  else if (rows.push(row) > cap) rows.splice(0, rows.length - cap)
}

export async function transcriptRows(sessionId: string): Promise<ChatRow[]> {
  const { events } = await readHistory(sessionId, { limit: Infinity }).catch(() => ({ events: [] }))
  const rows: ChatRow[] = []
  for (const event of events) {
    const row = rowFor(rows, event)
    if (row) upsert(rows, row, Infinity)
  }
  return rows
}

export async function olderRowsOf(sessionId: string, loaded: readonly ChatRow[], beforeId?: unknown): Promise<OlderRows> {
  const rows = await transcriptRows(sessionId)
  const anchors = new Set(typeof beforeId === 'string' ? [beforeId] : loaded.map((row) => row.id))
  const end = rows.findIndex((row) => anchors.has(row.id))
  if (end === -1) return { rows: [], more: false }
  const start = Math.max(0, end - olderPage)
  return { rows: rows.slice(start, end), more: start > 0 }
}

function fromRecord(record: ChatRecord): Chat {
  const { doneAt, readAt, ...fields } = record
  const view: ChatView = { ...fields, stateSince: record.lastActivityAt, activity: '', pending: [], pendingRequests: [], subagents: [], partial: '', rows: [] }
  return { view, background: new Set(), backgroundTasks: 0, interrupting: false, doneAt, readAt }
}

function toRecord({ view, doneAt, readAt }: Chat): ChatRecord {
  const { stateSince: _s, activity: _a, pending: _p, pendingRequests: _q, oldestPendingAt: _o, subagents: _g, partial: _t, rows: _r, answered: _n, earlier: _e, ...fields } = view
  return { ...fields, doneAt, readAt }
}

export function createChatStore(engine: Engine, db: Db, accounts: AccountHooks, rooms: Pick<Rooms, 'resolve' | 'revalidate' | 'tiedRoom' | 'isTied'>, permissionsFor: (chatId: string, accountId: string, cwd: string) => SessionPermissions | undefined = () => undefined) {
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
    chat.background.clear()
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

  function subagentDoing(chat: Chat, id: string, activity: string) {
    const subagents = chat.view.subagents
    if (subagents.some((agent) => agent.id === id && agent.activity !== activity)) set(chat, { subagents: subagents.map((agent) => (agent.id === id ? { ...agent, activity } : agent)) })
  }

  function wake(chat: Chat) {
    if (chat.view.state === 'done') transition(chat, 'working', { unread: false, activity: 'Thinking' })
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
        set(chat, { sessionId: event.sessionId, model: event.model, ...(view.forkPending ? { forkPending: false } : {}) })
        if (view.state === 'starting') transition(chat, 'working')
        else save(chat)
        break
      case 'mode':
        if (event.mode === view.permissionMode) break
        if (event.mode === 'plan') chat.previousMode = view.permissionMode ?? 'auto'
        set(chat, { permissionMode: event.mode })
        save(chat)
        break
      case 'text-delta':
        wake(chat)
        view.partial += event.text
        emit({ id: view.id, partialAppend: event.text })
        if (view.activity !== 'Writing a reply') set(chat, { activity: 'Writing a reply' })
        break
      case 'text':
        if (!event.parentToolUseId && view.partial) set(chat, { partial: '' })
        break
      case 'tool-use':
        if (event.parentToolUseId) subagentDoing(chat, event.parentToolUseId, describeTool(event.name, event.input))
        else {
          wake(chat)
          set(chat, { activity: describeTool(event.name, event.input) })
        }
        break
      case 'tool-result':
        if (!chat.background.has(event.toolUseId)) dropSubagent(chat, event.toolUseId)
        break
      case 'subagent-background':
        if (view.subagents.some((agent) => agent.id === event.id)) chat.background.add(event.id)
        break
      case 'subagent-start':
        set(chat, { subagents: [...view.subagents, { id: event.id, description: event.description }] })
        break
      case 'subagent-progress':
        subagentDoing(chat, event.id, event.activity)
        break
      case 'subagent-stop':
        chat.background.delete(event.id)
        dropSubagent(chat, event.id)
        break
      case 'background-tasks':
        chat.backgroundTasks = event.count
        break
      case 'turn-result': {
        const interrupted = chat.interrupting
        const lastError = chat.lastError
        chat.interrupting = false
        chat.lastError = undefined
        set(chat, { usage: event.usage })
        if (event.isError && !interrupted) fail(chat, [lastError, event.errorText].filter(Boolean).join(': '), 'error')
        else if (!interrupted && (chat.background.size || chat.backgroundTasks) && midTurn.has(view.state)) set(chat, { activity: 'Waiting on background tasks', subagents: view.subagents.filter((agent) => chat.background.has(agent.id)) })
        else if (midTurn.has(view.state)) {
          chat.background.clear()
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
      chat.backgroundTasks = 0
      if (midTurn.has(chat.view.state)) fail(chat, error ?? 'The Claude process exited mid-turn', 'crashed')
    }),
  )

  function run(chat: Chat, text: string, fork = false) {
    const view = chat.view
    try {
      if (!engine.running(view.id)) engine.start(view.id, { accountId: view.accountId, cwd: view.cwd, model: view.model || defaultModel, effort: view.effort, permissionMode: view.permissionMode, permissions: permissionsFor(view.id, view.accountId, view.cwd), resume: view.sessionId, ...(fork || view.forkPending ? { forkSession: true } : {}) })
      engine.send(view.id, text)
    } catch (error) {
      fail(chat, errorText(error), 'crashed')
    }
  }

  function send(chat: Chat, text: string, fields: Partial<ChatFields> = {}, fork = false) {
    const view = chat.view
    addRow(chat, { kind: 'user', id: randomUUID(), text })
    if (view.parked || view.finished) set(chat, { parked: false, finished: undefined })
    if (view.state === 'idle' || view.state === 'done' || view.state === 'stuck') transition(chat, 'working', { unread: false, stuck: undefined, activity: 'Thinking', partial: '', ...fields })
    run(chat, text, fork)
  }

  const isDirectory = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true
  const worktreeFailed = (chat: Chat, error: unknown) => transition(chat, 'stuck', { stuck: { reason: 'error', detail: `Couldn’t set up the worktree: ${errorText(error)}` }, setup: 'worktree-failed' })

  function nameTopic(id: string, accountId: string, prompt: string) {
    engine.topic(accountId, prompt).then(
      (topic) => guard(id, (chat) => {
        if (!topic) return
        set(chat, { title: topic })
        save(chat)
      }),
      () => {},
    )
  }

  function setUpWorktree(chat: Chat, plan: WorktreePlan, prompt: string) {
    const id = chat.view.id
    transition(chat, 'starting', { worktree: plan.path, cwd: plan.cwd, setup: 'worktree', stuck: undefined })
    createWorktree(plan).then(
      () =>
        guard(id, (current) => {
          const waiting = current.view.state === 'starting' && current.view.setup === 'worktree'
          set(current, { setup: undefined })
          if (waiting) run(current, prompt)
        }),
      (error: unknown) =>
        guard(id, (current) => {
          if (current.view.state === 'starting') worktreeFailed(current, error)
          else set(current, { setup: undefined })
        }),
    )
  }

  function retryWorktree(chat: Chat, worktree: string, prompt: string) {
    try {
      setUpWorktree(chat, planWorktree(repoPath(chat.view.cwd), basename(worktree)), prompt)
    } catch (error) {
      worktreeFailed(chat, error)
    }
  }

  const find = (chatId: unknown) => (typeof chatId === 'string' ? chats.get(chatId) : undefined)
  const deptOf = (chat: Pick<ChatFields, 'department'>) => chat.department ?? playgroundRoom.id
  const colourFor = (chat: Pick<ChatFields, 'department'>) =>
    pickColour(
      [...chats.values()].filter(({ view }) => !view.archived && view.colour).map(({ view }) => ({ colour: view.colour, dept: deptOf(view) })),
      deptOf(chat),
    )

  function create(init: Pick<ChatView, 'accountId' | 'cwd' | 'title' | 'department'> & Partial<ChatView>): Chat {
    const now = Date.now()
    const colour = colourFor(init)
    const view: ChatView = {
      id: randomUUID(),
      ...(colour ? { colour } : {}),
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
      ...init,
    }
    const chat: Chat = { view, background: new Set(), backgroundTasks: 0, interrupting: false }
    chats.set(view.id, chat)
    save(chat)
    const { rows, ...fields } = view
    emit({ id: view.id, fields, rows, replaceRows: true })
    return chat
  }

  for (const record of db.listChats()) {
    const chat = fromRecord(record)
    chats.set(chat.view.id, chat)
    const department = rooms.revalidate(chat.view, accounts.label(chat.view.accountId))
    if (department) {
      chat.view.department = department
      save(chat)
    }
    if (midTurn.has(chat.view.state)) transition(chat, 'stuck', { stuck: { reason: 'interrupted' } })
  }
  for (const chat of chats.values()) {
    const colour = chat.view.colour || chat.view.archived ? undefined : colourFor(chat.view)
    if (!colour) continue
    chat.view.colour = colour
    save(chat)
  }

  async function replay(chat: Chat, sessionId: string) {
    const rows = await transcriptRows(sessionId)
    const known = new Set(rows.map((row) => row.id))
    const asked = new Set(rows.flatMap((row) => (row.kind === 'user' ? [row.text] : [])))
    const merged = [...rows, ...chat.view.rows.filter((row) => !known.has(row.id) && !(row.kind === 'user' && asked.has(row.text)))]
    chat.view.rows = merged.slice(-maxRows)
    emit({ id: chat.view.id, rows: chat.view.rows, replaceRows: true })
    if (merged.length > maxRows) set(chat, { earlier: true })
  }

  return {
    events,
    snapshot: (): ChatView[] => [...chats.values()].map((chat) => structuredClone(chat.view)),
    view: (chatId: string): Readonly<ChatView> | undefined => chats.get(chatId)?.view,
    views: (): readonly Readonly<ChatView>[] => [...chats.values()].map((chat) => chat.view),
    recentFolders: (): string[] => [...new Set([...chats.values()].sort((a, b) => b.view.lastActivityAt - a.view.lastActivityAt).map((chat) => repoPath(chat.view.cwd)))].slice(0, 8),
    busy: () => [...chats.values()].some((chat) => midTurn.has(chat.view.state)),

    restore(chatId: unknown): Promise<void> {
      const chat = find(chatId)
      const sessionId = chat?.view.sessionId
      if (!chat || !sessionId || chat.view.archived) return Promise.resolve()
      return (chat.restoring ??= replay(chat, sessionId))
    },

    async olderRows(chatId: unknown, beforeId?: unknown): Promise<OlderRows> {
      const chat = find(chatId)
      const sessionId = chat?.view.sessionId
      return chat && sessionId ? olderRowsOf(sessionId, chat.view.rows, beforeId) : { rows: [], more: false }
    },

    draft(chatId: unknown): string {
      if (!find(chatId)) return ''
      try {
        return db.draft(chatId as string) ?? ''
      } catch {
        return ''
      }
    },

    saveDraft(chatId: unknown, text: unknown): void {
      if (find(chatId) && typeof text === 'string') db.saveDraft(chatId as string, text.slice(0, maxDraft))
    },

    async setPlanMode(chatId: unknown, on: unknown): Promise<void> {
      const chat = find(chatId)
      if (!chat || typeof on !== 'boolean') return
      const current = chat.view.permissionMode ?? 'auto'
      if (on && current === 'plan') return
      if (on) chat.previousMode = current
      const mode = on ? 'plan' : current === 'plan' ? (chat.previousMode ?? 'auto') : current
      set(chat, { permissionMode: mode })
      save(chat)
      if (engine.running(chat.view.id)) await engine.setPermissionMode(chat.view.id, mode)
    },

    start(accountId: unknown, cwd: unknown, prompt: unknown, model?: unknown, effort?: unknown, options?: unknown): StartChatResult {
      if (typeof accountId !== 'string' || !accounts.exists(accountId)) return { error: 'Pick an account first.' }
      if (accounts.needsLogin(accountId)) return needsLogin
      if (typeof cwd !== 'string' || !isAbsolute(cwd) || !statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) return { error: 'Pick an existing folder.' }
      if (typeof prompt !== 'string' || !prompt.trim()) return { error: 'Write a prompt first.' }
      const chosenModel = modelOrDefault(model)
      if (typeof chosenModel !== 'string' || !modelPattern.test(chosenModel)) return { error: 'That model name isn’t valid.' }
      const chosenEffort = effort == null || effort === '' ? defaultEffort : effort
      if (!efforts.includes(chosenEffort as Effort)) return { error: 'That effort level isn’t valid.' }
      const wanted = (typeof options === 'object' && options ? options : {}) as StartOptions
      const named = typeof wanted.title === 'string' && wanted.title.trim() ? wanted.title : undefined
      const title = (named ?? prompt).trim().split('\n')[0]!.slice(0, 60)
      let plan: WorktreePlan | undefined
      try {
        plan = wanted.worktree === true ? planWorktree(cwd, slugFor(title)) : undefined
      } catch (error) {
        return { error: errorText(error) }
      }
      const review = wanted.review === true
      const department = rooms.resolve(cwd, accounts.label(accountId), { review, chosen: typeof wanted.dept === 'string' ? wanted.dept : undefined, build: true })
      const chat = create({ accountId, cwd, department, title, model: chosenModel, effort: chosenEffort as Effort, ...(review ? { review } : {}) })
      if (!named) nameTopic(chat.view.id, accountId, prompt)
      if (plan) {
        addRow(chat, { kind: 'user', id: randomUUID(), text: prompt })
        setUpWorktree(chat, plan, prompt)
      } else send(chat, prompt)
      return { chatId: chat.view.id }
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
      const worktree = chat.view.worktree
      if (worktree && !isDirectory(worktree)) retryWorktree(chat, worktree, firstPrompt ?? chat.view.title)
      else send(chat, chat.view.sessionId ? resumePrompt : (firstPrompt ?? resumePrompt))
      return undefined
    },

    continueOnAccount(chatId: unknown, accountId: unknown): { chatId: string } | Refusal | undefined {
      const chat = find(chatId)
      const view = chat?.view
      if (!chat || !view?.sessionId || view.state !== 'stuck' || typeof accountId !== 'string' || accountId === view.accountId || !accounts.exists(accountId)) return undefined
      if (accounts.needsLogin(accountId)) return needsLogin
      engine.stop(view.id)
      const label = accounts.label(accountId)
      const leaving = !!view.department && rooms.isTied(view.department) && rooms.tiedRoom(label) !== view.department
      const copy = create({
        accountId,
        cwd: view.cwd,
        title: view.title,
        department: leaving ? rooms.resolve(view.cwd, label, { review: view.review, build: true }) : view.department,
        sessionId: view.sessionId,
        ...(view.review ? { review: true } : {}),
        ...(view.worktree ? { worktree: view.worktree } : {}),
        ...(view.model ? { model: view.model } : {}),
        ...(view.effort ? { effort: view.effort } : {}),
        ...(view.permissionMode ? { permissionMode: view.permissionMode } : {}),
        rows: structuredClone(view.rows),
      })
      addRow(chat, { kind: 'other', id: randomUUID(), label: `Continued on ${label ?? 'the other account'} in a new chat` })
      transition(chat, 'idle', { stuck: undefined, parked: true })
      send(copy, resumePrompt, {}, true)
      return { chatId: copy.view.id }
    },

    adopt(init: Pick<ChatView, 'accountId' | 'cwd' | 'title' | 'department' | 'sessionId'>): string {
      const chat = create({ ...init, state: 'idle', activity: '', forkPending: true })
      addRow(chat, { kind: 'other', id: randomUUID(), label: 'Moved into the office. Your next message continues a copy; the original stays as it is.' })
      return chat.view.id
    },

    finish(chatId: string): boolean {
      const chat = chats.get(chatId)
      if (!chat || chat.view.archived || midTurn.has(chat.view.state)) return false
      set(chat, { finished: Date.now(), unread: false })
      save(chat)
      return true
    },

    park(chatId: string): void {
      const chat = chats.get(chatId)
      if (!chat || chat.view.parked || chat.view.archived) return
      set(chat, { parked: true })
      save(chat)
    },

    archive(chatId: string): boolean {
      const chat = chats.get(chatId)
      if (!chat || chat.view.archived || midTurn.has(chat.view.state)) return false
      engine.stop(chatId)
      set(chat, { archived: true, parked: false, unread: false })
      save(chat)
      return true
    },

    setDepartment(chatId: string, department: string): void {
      const chat = chats.get(chatId)
      if (!chat || chat.view.department === department) return
      set(chat, { department })
      save(chat)
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

    async setModel(chatId: unknown, wanted: unknown): Promise<void> {
      const chat = find(chatId)
      const model = modelOrDefault(wanted)
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
      transition(chat, 'idle', { unread: false, lastActivityAt: chat.view.lastActivityAt })
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

    resolvePending(chatId: string, requestId: string, answer?: Omit<Answered, 'id'>): void {
      const chat = chats.get(chatId)
      if (!chat?.view.pendingRequests.some((request) => request.id === requestId)) return
      const pendingRequests = chat.view.pendingRequests.filter((request) => request.id !== requestId)
      const answered = answer ? { answered: [...(chat.view.answered ?? []), { id: requestId, ...answer }].slice(-5) } : {}
      const fields = { pending: chat.view.pending.filter((request) => request.id !== requestId), pendingRequests, oldestPendingAt: pendingRequests[0]?.createdAt, ...answered }
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
