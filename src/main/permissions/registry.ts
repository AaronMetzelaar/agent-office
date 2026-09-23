import { randomUUID } from 'node:crypto'
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import type { Answered } from '../../shared/chat'
import { windowSources, type Decision, type PendingRequestView, type RequestSource, type ResolveResult } from '../../shared/permissions'
import type { WaitMetrics } from '../metrics/wait'
import type { ChatCanUseTool, Engine } from '../sessions/manager'
import type { ChatStore } from '../store/chats'
import { dangerReason } from './danger'
import { alwaysAllowRules, type Rules } from './rules'

interface Entry {
  chatId: string
  accountId: string
  cwd: string
  view: PendingRequestView
  rules: string[]
  settle(result: PermissionResult): void
}

export type Broker = ReturnType<typeof createBroker>

const sources = new Set<unknown>([...windowSources, 'notification', 'phone'])
const clickSources = new Set<RequestSource>(['chat', 'inbox', 'queue'])
const sessionEnded = 'session ended'

function summarize(toolName: string, input: Record<string, unknown>, title?: string): string {
  const questions = input.questions as { question?: unknown }[] | undefined
  const value =
    toolName === 'Bash' ? input.command
    : toolName === 'AskUserQuestion' ? questions?.[0]?.question
    : toolName === 'ExitPlanMode' ? 'Plan ready for review'
    : (input.file_path ?? input.notebook_path ?? input.path ?? input.url ?? input.query)
  return typeof value === 'string' ? value : (title ?? toolName)
}

function parseDecision(value: unknown): Decision | undefined {
  const decision = (value ?? {}) as Record<string, unknown>
  switch (decision.kind) {
    case 'allow':
    case 'always':
      return { kind: decision.kind }
    case 'deny':
      return typeof decision.message === 'string' && decision.message.trim() ? { kind: 'deny', message: decision.message.trim().slice(0, 4000) } : { kind: 'deny' }
    case 'answer': {
      const answers = decision.answers
      if (!answers || typeof answers !== 'object' || !Object.values(answers).every((answer) => typeof answer === 'string')) return undefined
      return { kind: 'answer', answers: answers as Record<string, string> }
    }
    default:
      return undefined
  }
}

function refusal(entry: Entry, decision: Decision, source: RequestSource): string | undefined {
  if (decision.kind === 'deny') return undefined
  if (entry.view.dangerous && !clickSources.has(source)) return 'Dangerous requests need a click in the app.'
  if (decision.kind === 'always' && !entry.view.alwaysAllow) return 'Always allow isn’t offered for this request.'
  if ((decision.kind === 'answer') !== (entry.view.tool === 'AskUserQuestion')) return 'That answer doesn’t fit this request.'
  return undefined
}

export function createBroker(engine: Pick<Engine, 'running'>, store: ChatStore, rules: Rules, waits: WaitMetrics) {
  const open = new Map<string, Entry>()
  const closed = new Map<string, string>()

  function close(requestId: string, outcome: string, answer?: Omit<Answered, 'id'>): Entry | undefined {
    const entry = open.get(requestId)
    if (!entry) return undefined
    open.delete(requestId)
    closed.set(requestId, outcome)
    store.resolvePending(entry.chatId, requestId, answer)
    return entry
  }

  store.events.on('patch', (patch) => {
    if (patch.fields?.state !== 'stuck') return
    for (const [requestId, entry] of open) if (entry.chatId === patch.id) close(requestId, sessionEnded)?.settle({ behavior: 'deny', message: 'The session ended.' })
  })

  const canUseTool: ChatCanUseTool = (chatId, toolName, input, options) => {
    const context = store.context(chatId)
    if (!context || options.signal.aborted) return Promise.resolve({ behavior: 'deny', message: 'This chat isn’t running in Agent Office.' })
    const reason = dangerReason(toolName, input, context.cwd, options)
    const always = reason || options.suppressAlwaysAllowRule ? [] : alwaysAllowRules(toolName, options.suggestions)
    const view: PendingRequestView = {
      id: randomUUID(),
      tool: toolName,
      summary: summarize(toolName, input, options.title),
      input,
      createdAt: Date.now(),
      dangerous: reason !== undefined,
      ...(reason ? { dangerReason: reason } : {}),
      alwaysAllow: always.length > 0,
    }
    return new Promise((settle) => {
      open.set(view.id, { chatId, ...context, view, rules: always, settle })
      options.signal.addEventListener('abort', () => close(view.id, 'cancelled')?.settle({ behavior: 'deny', message: 'Cancelled.' }), { once: true })
      store.addPending(chatId, view)
    })
  }

  function resolveRequest(requestId: unknown, input: unknown, source: unknown): ResolveResult {
    if (typeof requestId !== 'string' || !sources.has(source)) return { error: 'Unknown request.' }
    const earlier = closed.get(requestId)
    if (earlier) return { error: earlier }
    const entry = open.get(requestId)
    const decision = parseDecision(input)
    if (!entry || !decision) return { error: 'Unknown request.' }
    const refused = refusal(entry, decision, source as RequestSource)
    if (refused) return { error: refused }
    if (!engine.running(entry.chatId)) {
      close(requestId, sessionEnded)
      store.stopChat(entry.chatId)
      return { error: sessionEnded }
    }
    close(requestId, `already answered (${String(source)})`, { source: source as RequestSource, decision: decision.kind })
    waits.record('request', entry.chatId, entry.view.createdAt, Date.now())
    const allow: PermissionResult = { behavior: 'allow', updatedInput: entry.view.input }
    switch (decision.kind) {
      case 'allow':
        if (entry.view.tool === 'ExitPlanMode') void store.setPlanMode(entry.chatId, false).catch(() => {})
        entry.settle(allow)
        break
      case 'always':
        void rules.add(entry.accountId, entry.cwd, entry.rules).finally(() => entry.settle(allow))
        break
      case 'answer':
        entry.settle({ behavior: 'allow', updatedInput: { ...entry.view.input, answers: decision.answers } })
        break
      case 'deny':
        entry.settle({ behavior: 'deny', message: decision.message ?? 'Denied in Agent Office.' })
        break
    }
    return { ok: true }
  }

  return { canUseTool, resolveRequest }
}

export function windowResolver(broker: Broker, isFocused: () => boolean) {
  return (requestId: unknown, decision: unknown, source: unknown): ResolveResult => {
    if (!windowSources.includes(source as never)) return { error: 'Unknown request.' }
    if (source === 'keyboard' && !isFocused()) return { error: 'Keyboard answers only count while the window is focused.' }
    return broker.resolveRequest(requestId, decision, source)
  }
}
