import { basename } from 'node:path'
import type { NotificationConstructorOptions } from 'electron'
import { ago, doingNow, type ChatPatch, type ChatView } from '../../shared/chat'
import type { Tightest } from '../../shared/guardrails'
import type { Navigate } from '../../shared/ipc'
import type { Decision, PendingRequestView, ResolveResult } from '../../shared/permissions'
import type { ChatStore } from '../store/chats'
import type { Push } from './ntfy'

export interface NotificationLike {
  on(event: 'action', listener: (event: { actionIndex?: number }, index?: number) => void): unknown
  on(event: 'reply', listener: (event: { reply?: string }, reply?: string) => void): unknown
  on(event: 'click' | 'close', listener: () => void): unknown
  on(event: 'failed', listener: (event: unknown, error: string) => void): unknown
  show(): void
  close(): void
}

export interface NotifierOptions {
  store: Pick<ChatStore, 'events' | 'view'>
  department(chat: Readonly<ChatView>): string
  resolve(requestId: string, decision: Decision): ResolveResult
  sendMessage(chatId: string, text: string): unknown
  open(to: Navigate): void
  notification(options: NotificationConstructorOptions): NotificationLike
  push(push: Push): unknown
  shown?: (chatId: string) => boolean
  log?: (message: string) => void
}

type Action = [label: string, run: () => void]

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)
const secretish = /^(?:[\w-]+=.*|[A-Za-z0-9+/_=.-]{24,})$/

function shortCommand(command: string): string {
  const lines = command.trim().split('\n')
  const words = lines[0]!.split(/\s+/).filter(Boolean)
  const kept = words.slice(0, 2).map((word) => (secretish.test(word) ? '…' : word))
  return clip(kept.join(' '), 40) + (words.length > 2 || lines.length > 1 ? ' …' : '')
}

function hostOf(url: unknown): string {
  return (typeof url === 'string' && URL.parse(url)?.hostname) || 'a web page'
}

export function wants(request: Pick<PendingRequestView, 'tool' | 'input'>): string {
  const input = request.input
  const file = basename(String(input.file_path ?? input.notebook_path ?? input.path ?? ''))
  switch (request.tool) {
    case 'Bash':
      return `run: ${shortCommand(String(input.command ?? ''))}`
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `edit ${clip(file, 40)}`
    case 'Write':
      return `write ${clip(file, 40)}`
    case 'Read':
      return `read ${clip(file, 40)}`
    case 'Grep':
    case 'Glob':
      return 'search files'
    case 'WebFetch':
      return `fetch ${hostOf(input.url)}`
    case 'WebSearch':
      return 'search the web'
    case 'AskUserQuestion':
      return 'ask you a question'
    case 'ExitPlanMode':
      return 'start on its plan'
    default:
      return `use ${clip(request.tool, 40)}`
  }
}

export function createNotifier({ store, department, resolve, sendMessage, open, notification, push, shown = () => false, log = (message) => console.warn(`[notify] ${message}`) }: NotifierOptions) {
  const live = new Map<string, NotificationLike>()
  const requests = new Map<string, string>()
  let warned = false

  function close(key: string) {
    live.get(key)?.close()
    live.delete(key)
  }

  function show(key: string, options: NotificationConstructorOptions, actions: Action[], click: () => void, reply?: (text: string) => void) {
    close(key)
    const note = notification({ ...options, id: key, actions: actions.map(([text]) => ({ type: 'button', text })), ...(reply ? { hasReply: true } : {}) })
    const forget = () => live.delete(key)
    note.on('action', (event, index) => {
      forget()
      actions[event.actionIndex ?? index ?? -1]?.[1]()
    })
    note.on('reply', (event, text) => {
      forget()
      const body = (event.reply ?? text ?? '').trim()
      if (body) reply?.(body)
    })
    note.on('click', () => {
      forget()
      click()
    })
    note.on('close', forget)
    note.on('failed', (_event, error) => {
      if (!warned) log(`macOS didn’t show a notification: ${error}`)
      warned = true
    })
    live.set(key, note)
    note.show()
  }

  const answer = (requestId: string, decision: Decision) => {
    const result = resolve(requestId, decision)
    if ('error' in result) log(`notification answer ignored: ${result.error}`)
  }

  function request(chat: Readonly<ChatView>, pending: PendingRequestView) {
    const dept = department(chat)
    const what = `Auto mode wants to ${wants(pending)}`
    const openChat = () => open({ to: 'chat', chatId: chat.id })
    requests.set(pending.id, chat.id)
    show(
      pending.id,
      { title: chat.title, subtitle: dept, body: pending.dangerous ? `${what}\nNeeds a click in Agent Office` : what, groupId: chat.id, replyPlaceholder: 'Tell Claude what to do instead' },
      [...(pending.dangerous ? [] : [['Allow once', () => answer(pending.id, { kind: 'allow' })] as Action]), ['Deny', () => answer(pending.id, { kind: 'deny' })], ['Open', openChat]],
      openChat,
      (text) => answer(pending.id, { kind: 'deny', message: text }),
    )
    void push({ kind: 'needs', title: clip(`${chat.title} needs you`, 60), message: `${dept} · ${what}`, request: { id: pending.id, dangerous: pending.dangerous } })
  }

  function stuck(chat: Readonly<ChatView>) {
    const dept = department(chat)
    const why = doingNow(chat, Date.now()).replace(/^Stuck · /, '')
    const openChat = () => open({ to: 'chat', chatId: chat.id })
    show(`stuck:${chat.id}`, { title: `${chat.title} is stuck`, subtitle: dept, body: why, groupId: chat.id }, [['Open', openChat]], openChat)
    void push({ kind: 'stuck', title: clip(`${chat.title} is stuck`, 60), message: `${dept} · ${why}` })
  }

  function done(chat: Readonly<ChatView>) {
    const dept = department(chat)
    const openChat = () => open({ to: 'chat', chatId: chat.id })
    show(`done:${chat.id}`, { title: `${chat.title} is done`, subtitle: dept, body: 'Ready to review', groupId: chat.id, replyPlaceholder: `Reply to ${chat.title}` }, [['Open', openChat]], openChat, (text) => sendMessage(chat.id, text))
    void push({ kind: 'done', title: clip(`${chat.title} is done`, 60), message: `${dept} · ready to review` })
  }

  function halted(chat: Readonly<ChatView>) {
    const dept = department(chat)
    const openChat = () => open({ to: 'chat', chatId: chat.id })
    show(`halt:${chat.id}`, { title: `${chat.title} needs you`, subtitle: dept, body: chat.halt, groupId: chat.id, replyPlaceholder: `Reply to ${chat.title}` }, [['Open', openChat]], openChat, (text) => sendMessage(chat.id, text))
    void push({ kind: 'needs', title: clip(`${chat.title} needs you`, 60), message: `${dept} · ${chat.halt}` })
  }

  function onPatch(patch: ChatPatch) {
    const fields = patch.fields
    const chat = fields && store.view(patch.id)
    if (!chat) return
    if (fields.pendingRequests) {
      const stillOpen = new Set(fields.pendingRequests.map((pending) => pending.id))
      for (const [requestId, chatId] of requests) {
        if (chatId !== chat.id || stillOpen.has(requestId)) continue
        requests.delete(requestId)
        close(requestId)
      }
      for (const pending of fields.pendingRequests) {
        if (requests.has(pending.id)) continue
        if (shown(chat.id)) requests.set(pending.id, chat.id)
        else request(chat, pending)
      }
    }
    if (!fields.state) return
    if (fields.state !== 'done') close(`done:${chat.id}`)
    if (fields.state !== 'stuck') close(`stuck:${chat.id}`)
    if (fields.state !== 'needs-you') close(`halt:${chat.id}`)
    if (fields.state === 'needs-you' && chat.halt) halted(chat)
    if (fields.state === 'done') done(chat)
    if (fields.state === 'stuck' && chat.stuck?.reason !== 'needs-login') stuck(chat)
  }

  store.events.on('patch', onPatch)

  return {
    live,
    login(account: { id: string; label: string }) {
      const toAccounts = () => open({ to: 'accounts' })
      show(`login:${account.id}`, { title: `${account.label} needs login`, body: 'Add its token again in Accounts. Its chats wait until then.' }, [['Open Accounts', toAccounts]], toAccounts)
      void push({ kind: 'needs', title: clip(`${account.label} needs login`, 60), message: 'Add its token again in Accounts' })
    },
    loginFixed: (accountId: string) => close(`login:${accountId}`),
    headroom(account: { id: string; label: string }, window: Tightest | undefined) {
      if (!window) return close(`headroom:${account.id}`)
      const toAccounts = () => open({ to: 'accounts' })
      const title = `${account.label} is at ${Math.round(window.utilization)}% of its ${window.window === 'fiveHour' ? '5-hour' : 'weekly'} limit`
      const body = window.resetsAt ? `Resets in ${ago(window.resetsAt - Date.now())}` : 'Consider the other account for new agents'
      show(`headroom:${account.id}`, { title, body, silent: true }, [['Open Accounts', toAccounts]], toAccounts)
      void push({ kind: 'housekeeping', title: clip(title, 60), message: body })
    },
    cleanup(count: number) {
      const toHousekeeping = () => open({ to: 'housekeeping' })
      const title = `${count} chat${count === 1 ? ' is' : 's are'} ready for cleanup`
      show('cleanup', { title, body: 'Quiet for days. Review them in Housekeeping.', silent: true }, [['Open Housekeeping', toHousekeeping]], toHousekeeping)
      void push({ kind: 'housekeeping', title, message: 'Review them in Housekeeping' })
    },
    stop: () => store.events.off('patch', onPatch),
  }
}
