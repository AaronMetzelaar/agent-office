import { emptyUsage, maxRows, type ChatFields, type ChatPatch, type ChatState, type ChatView, type OlderRows } from '../../shared/chat'
import { homeDept, isResearch, type DeptId, type DeptRule } from '../../shared/departments'
import { classify, evidenceOf, newTally, type Tally } from '../departments/classifier'
import type { ChatEvent } from '../sessions/normalize'
import { describeTool, olderRowsOf, transcriptRows } from '../store/chats'
import type { HookEvent } from './listener'
import { activeWindowMs, titleOf, type VisitorSeed } from './transcripts'

export interface VisitorOptions {
  patch(patch: ChatPatch): void
  accounts(): readonly { id: string; label: string }[]
  rules: readonly DeptRule[]
  officeSessions(): ReadonlySet<string>
  describe(sessionId: string): VisitorSeed | undefined
  settings: { setting(key: string): unknown; saveSetting(key: string, value: unknown): void }
  log?: (message: string) => void
  now?: () => number
}

interface Entry {
  view: ChatView
  tally: Tally
  hookAt?: number
  titled: boolean
  tool?: { id: string; name: string }
}

export type Visitors = ReturnType<typeof createVisitors>

export const unknownAccount = 'unknown'
const movedKey = 'movedSessions'
const readKey = 'readSessions'
const maxMoved = 500
const permissionPrompts = new Set(['permission_prompt', 'elicitation_dialog'])
const midTurn = new Set<ChatState>(['working', 'needs-you'])
const refreshOn = new Set<HookEvent['hook_event_name']>(['UserPromptSubmit', 'Notification', 'Stop'])
const refreshMs = 500
const hookQuietMs = 30 * 60_000

const asksPermission = (event: HookEvent) => (event.notification_type ? permissionPrompts.has(event.notification_type) : /permission/i.test(event.message ?? ''))

export function createVisitors({ patch, accounts, rules, officeSessions, describe, settings, log = (message) => console.warn(`[outside] ${message}`), now = Date.now }: VisitorOptions) {
  const visitors = new Map<string, Entry>()
  const saved = settings.setting(movedKey)
  const moved = new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [])
  const savedRead = settings.setting(readKey)
  const read = new Map(savedRead && typeof savedRead === 'object' ? Object.entries(savedRead).filter((entry): entry is [string, number] => typeof entry[1] === 'number') : [])
  const unreadDone = (seed: VisitorSeed) => seed.state === 'done' && (read.get(seed.sessionId) ?? -1) < (seed.endedAt ?? seed.lastActivityAt)
  const stateOf = (seed: VisitorSeed): ChatState => (seed.state === 'done' && !unreadDone(seed) ? 'idle' : seed.state)
  let open: string | undefined
  let refreshTimer: ReturnType<typeof setTimeout> | undefined

  const accountFor = (instance?: string) => {
    if (!instance) return unknownAccount
    const research = /research/i.test(instance)
    return accounts().find((account) => isResearch(account) === research)?.id ?? unknownAccount
  }
  const inResearch = (accountId: string) => isResearch({ label: accounts().find((account) => account.id === accountId)?.label ?? '' })

  const set = (entry: Entry, fields: Partial<ChatFields>) => {
    Object.assign(entry.view, fields)
    patch({ id: entry.view.id, fields })
  }
  const transition = (entry: Entry, state: ChatState, fields: Partial<ChatFields> = {}) => {
    const at = now()
    set(entry, { ...(entry.view.state === state ? {} : { state, stateSince: at }), lastActivityAt: at, ...fields })
  }

  function placed(entry: Entry, events: readonly ChatEvent[]): DeptId | undefined {
    return entry.view.department === 'gym' ? undefined : classify(entry.tally, evidenceOf(events, entry.view.cwd, rules))
  }

  function add(seed: VisitorSeed): Entry {
    const accountId = accountFor(seed.instance)
    const view: ChatView = {
      id: seed.sessionId,
      sessionId: seed.sessionId,
      accountId,
      cwd: seed.cwd,
      title: seed.title,
      department: homeDept(seed.cwd, inResearch(accountId), rules),
      visitor: seed.source,
      archived: false,
      state: stateOf(seed),
      stateSince: seed.lastActivityAt,
      unread: unreadDone(seed),
      activity: '',
      pending: [],
      pendingRequests: [],
      subagents: [],
      usage: emptyUsage(),
      partial: '',
      createdAt: seed.createdAt,
      lastActivityAt: seed.lastActivityAt,
      rows: [],
      ...(moved.has(seed.sessionId) ? { moved: true, parked: true } : {}),
    }
    const entry: Entry = { view, tally: newTally(), titled: seed.titled }
    for (const events of seed.evidence) view.department = placed(entry, events) ?? view.department
    visitors.set(view.id, entry)
    const { rows, ...fields } = view
    patch({ id: view.id, fields, rows, replaceRows: true })
    return entry
  }

  function remove(entry: Entry) {
    visitors.delete(entry.view.id)
    patch({ id: entry.view.id, fields: { archived: true } })
  }

  async function refresh(id: string) {
    const rows = await transcriptRows(id)
    const entry = visitors.get(id)
    if (!entry || open !== id) return
    entry.view.rows = rows.slice(-maxRows)
    patch({ id, rows: entry.view.rows, replaceRows: true })
    if (rows.length > maxRows && !entry.view.earlier) set(entry, { earlier: true })
  }

  function apply(entry: Entry, event: HookEvent) {
    switch (event.hook_event_name) {
      case 'UserPromptSubmit': {
        const title = !entry.titled && event.prompt?.trim() ? { title: titleOf(event.prompt) } : {}
        entry.titled ||= 'title' in title
        transition(entry, 'working', { activity: 'Thinking', pending: [], unread: false, ...title })
        break
      }
      case 'PreToolUse': {
        const name = event.tool_name ?? 'a tool'
        entry.tool = { id: event.tool_use_id ?? name, name }
        const department = placed(entry, [{ type: 'tool-use', id: entry.tool.id, name, input: event.tool_input }])
        transition(entry, 'working', { activity: describeTool(name, event.tool_input), pending: [], ...(department && department !== entry.view.department ? { department } : {}) })
        break
      }
      case 'PostToolUse':
        if (entry.view.state !== 'working') transition(entry, 'working', { pending: [] })
        break
      case 'Stop':
        transition(entry, 'done', { unread: true, activity: '', pending: [] })
        break
      case 'Notification':
        if (asksPermission(event)) transition(entry, 'needs-you', { pending: [{ id: entry.tool?.id ?? 'notification', toolName: entry.tool?.name ?? 'a decision' }], activity: event.message ?? '' })
        else set(entry, { lastActivityAt: now() })
        break
      case 'SessionEnd':
        if (midTurn.has(entry.view.state)) transition(entry, 'idle', { activity: '', pending: [] })
        break
      default:
        set(entry, { lastActivityAt: now() })
    }
  }

  return {
    has: (chatId: unknown) => typeof chatId === 'string' && visitors.has(chatId),
    view: (chatId: string): Readonly<ChatView> | undefined => visitors.get(chatId)?.view,
    views: (): readonly Readonly<ChatView>[] => [...visitors.values()].map((entry) => entry.view),
    snapshot: (): ChatView[] => [...visitors.values()].map((entry) => structuredClone(entry.view)),

    sync(seeds: readonly VisitorSeed[]): void {
      const office = officeSessions()
      const fresh = new Set<string>()
      for (const seed of seeds) {
        if (office.has(seed.sessionId)) continue
        const entry = visitors.get(seed.sessionId)
        if (seed.archived) {
          if (entry) remove(entry)
          continue
        }
        fresh.add(seed.sessionId)
        if (!entry) {
          add(seed)
          continue
        }
        const fields: Partial<ChatFields> = {}
        if (seed.titled && seed.title !== entry.view.title) fields.title = seed.title
        const accountId = accountFor(seed.instance)
        if (accountId !== entry.view.accountId) fields.accountId = accountId
        if (seed.lastActivityAt > entry.view.lastActivityAt) fields.lastActivityAt = seed.lastActivityAt
        const hookGoneQuiet = entry.view.state === 'working' && now() - (entry.hookAt ?? 0) > hookQuietMs
        if ((entry.hookAt === undefined || hookGoneQuiet) && stateOf(seed) !== entry.view.state) Object.assign(fields, { state: stateOf(seed), stateSince: now(), unread: unreadDone(seed) })
        if (Object.keys(fields).length) set(entry, fields)
      }
      const cutoff = now() - activeWindowMs
      for (const entry of visitors.values()) if (!fresh.has(entry.view.id) && entry.view.lastActivityAt < cutoff) remove(entry)
    },

    hook(event: HookEvent): void {
      const id = event.session_id
      if (officeSessions().has(id)) return
      let entry = visitors.get(id)
      if (!entry) {
        const seed = describe(id)
        if (!seed || seed.archived) return log(`dropped a ${event.hook_event_name} event: session ${id} ${seed ? 'is archived in the desktop app' : 'has no outside transcript'}`)
        entry = add(seed)
      }
      entry.hookAt = now()
      apply(entry, event)
      if (open !== id || !refreshOn.has(event.hook_event_name)) return
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => void refresh(id), refreshMs)
    },

    open(chatId: unknown): void {
      open = typeof chatId === 'string' && visitors.has(chatId) ? chatId : undefined
      if (open) void refresh(open)
    },

    olderRows(chatId: string, beforeId?: unknown): Promise<OlderRows> {
      const entry = visitors.get(chatId)
      return entry ? olderRowsOf(chatId, entry.view.rows, beforeId) : Promise.resolve({ rows: [], more: false })
    },

    markRead(chatId: string): void {
      const entry = visitors.get(chatId)
      if (entry?.view.state !== 'done') return
      read.set(chatId, now())
      settings.saveSetting(readKey, Object.fromEntries([...read].slice(-maxMoved)))
      set(entry, { state: 'idle', stateSince: now(), unread: false })
    },

    markMoved(chatId: string): void {
      moved.add(chatId)
      settings.saveSetting(movedKey, [...moved].slice(-maxMoved))
      const entry = visitors.get(chatId)
      if (entry) set(entry, { moved: true, parked: true })
    },
  }
}
