import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { SDKMessage, SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk'
import type { Engine, EngineEvents, StartOptions } from '../../src/main/sessions/manager'

const message = (fields: Record<string, unknown>) => ({ uuid: randomUUID(), session_id: 'fake', ...fields }) as unknown as SDKMessage

export const sdk = {
  init: (sessionId: string, model = 'claude-fake-1') => message({ type: 'system', subtype: 'init', session_id: sessionId, model }),
  delta: (text: string) => message({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } }),
  text: (text: string, parent: string | null = null) => message({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'text', text }] } }),
  toolUse: (tools: { id: string; name: string; input: unknown }[], parent: string | null = null) =>
    message({ type: 'assistant', parent_tool_use_id: parent, message: { content: tools.map((tool) => ({ type: 'tool_use', ...tool })) } }),
  toolResult: (toolUseId: string, content: unknown, isError = false) =>
    message({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }] } }),
  result: (inputTokens = 100, outputTokens = 20, costUsd = 0.01) =>
    message({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'ok',
      total_cost_usd: costUsd,
      modelUsage: { 'claude-fake-1': { inputTokens, outputTokens, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: costUsd } },
    }),
  errorResult: (text: string) => message({ type: 'result', subtype: 'success', is_error: true, result: text, total_cost_usd: 0, modelUsage: {} }),
  apiError: (error: string) => message({ type: 'assistant', parent_tool_use_id: null, error, message: { content: [] } }),
  rateLimit: (info: SDKRateLimitInfo) => message({ type: 'rate_limit_event', rate_limit_info: info }),
  taskNotification: (toolUseId: string) => message({ type: 'system', subtype: 'task_notification', task_id: 't', tool_use_id: toolUseId, status: 'completed', output_file: '', summary: '' }),
}

interface FakeSession {
  options: StartOptions
  sessionId: string
  initialized: boolean
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 15))

export function createFakeEngine({ auto = false } = {}) {
  const events = new EventEmitter<EngineEvents>()
  const live = new Map<string, FakeSession>()
  const starts: { chatId: string; options: StartOptions }[] = []
  const sent: { chatId: string; text: string }[] = []
  const calls: string[] = []
  const emit = (chatId: string, sdkMessage: SDKMessage) => events.emit('message', chatId, sdkMessage)

  const init = (chatId: string) => {
    const session = live.get(chatId)
    if (!session) throw new Error(`no fake session for ${chatId}`)
    session.initialized = true
    emit(chatId, sdk.init(session.sessionId))
  }

  async function play(chatId: string, text: string) {
    const session = live.get(chatId)
    const still = () => live.get(chatId) === session
    await tick()
    if (!still()) return
    if (!session?.initialized) init(chatId)
    if (text.includes('[hang]')) return
    for (const piece of ['Sure', ', ', 'done', '.']) {
      await tick()
      if (!still()) return
      emit(chatId, sdk.delta(piece))
    }
    emit(chatId, sdk.text('Sure, done.'))
    emit(chatId, sdk.result())
  }

  const engine = {
    events,
    start(chatId, options) {
      starts.push({ chatId, options })
      live.set(chatId, { options, sessionId: options.resume && !options.forkSession ? options.resume : randomUUID(), initialized: false })
    },
    send(chatId, text) {
      if (!live.has(chatId)) throw new Error('This chat has no running session')
      sent.push({ chatId, text })
      if (auto) void play(chatId, text)
    },
    async interrupt(chatId) {
      calls.push(`interrupt:${chatId}`)
    },
    stop(chatId) {
      live.delete(chatId)
    },
    async setModel(chatId, model) {
      calls.push(`setModel:${chatId}:${model}`)
    },
    async setEffort(chatId, effort) {
      calls.push(`setEffort:${chatId}:${effort}`)
    },
    async setPermissionMode(chatId, mode) {
      calls.push(`setPermissionMode:${chatId}:${mode}`)
    },
    running: (chatId) => live.has(chatId),
    pid: (chatId) => (live.has(chatId) ? 4242 : undefined),
  } satisfies Engine

  return Object.assign(engine, {
    starts,
    sent,
    calls,
    emit,
    init,
    sessionId: (chatId: string) => live.get(chatId)?.sessionId,
    exit(chatId: string, error?: string) {
      live.delete(chatId)
      events.emit('end', chatId, error)
    },
  })
}

export type FakeEngine = ReturnType<typeof createFakeEngine>
