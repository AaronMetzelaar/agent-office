import type { PermissionMode, SDKAssistantMessageError, SDKMessage, SDKRateLimitInfo, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { emptyUsage, type Usage } from '../../shared/chat'

export type ChatEvent =
  | { type: 'session'; sessionId: string; model: string }
  | { type: 'mode'; mode: PermissionMode }
  | { type: 'text-delta'; text: string }
  | { type: 'text'; id: string; text: string; parentToolUseId?: string }
  | { type: 'tool-use'; id: string; name: string; input: unknown; parentToolUseId?: string }
  | { type: 'tool-result'; toolUseId: string; text: string; isError: boolean }
  | { type: 'user-text'; id: string; text: string }
  | { type: 'subagent-start'; id: string; description: string; background: boolean }
  | { type: 'subagent-stop'; id: string }
  | { type: 'turn-result'; usage: Usage; isError: boolean; errorText?: string }
  | { type: 'headroom'; info: SDKRateLimitInfo }
  | { type: 'retry-at'; at: number }
  | { type: 'api-error'; error: SDKAssistantMessageError }
  | { type: 'other'; label: string }

type Block = { type?: string; id?: string; name?: string; input?: unknown; text?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }

const quietTypes = new Set(['tool_progress', 'auth_status', 'tool_use_summary', 'prompt_suggestion'])
const quietSystem = new Set([
  'hook_started',
  'hook_progress',
  'hook_response',
  'task_started',
  'task_updated',
  'task_progress',
  'thinking_tokens',
  'session_state_changed',
  'background_tasks_changed',
  'commands_changed',
  'files_persisted',
  'control_request_progress',
  'memory_recall',
  'plugin_install',
  'worker_shutting_down',
  'elicitation_complete',
  'mirror_error',
])
const subagentTools = new Set(['Agent', 'Task'])
const maxResultText = 4000

export function errorReason(error: unknown): 'needs-login' | 'rate-limited' | undefined {
  const text = String(error)
  if (/\b401\b|failed to authenticate|authentication_failed|oauth access token/i.test(text)) return 'needs-login'
  if (/rate.?limit|\b429\b|usage limit/i.test(text)) return 'rate-limited'
  return undefined
}

const blocksOf = (content: unknown): Block[] => (Array.isArray(content) ? (content as Block[]) : [])

function resultText(content: unknown): string {
  const text = typeof content === 'string' ? content : blocksOf(content).map((block) => (block.type === 'text' ? block.text : `[${block.type}]`)).join('\n')
  return text.length > maxResultText ? `${text.slice(0, maxResultText)}…` : text
}

function usageOf(result: SDKResultMessage): Usage {
  const usage = emptyUsage()
  for (const model of Object.values(result.modelUsage ?? {})) {
    usage.inputTokens += model.inputTokens
    usage.outputTokens += model.outputTokens
    usage.cacheReadTokens += model.cacheReadInputTokens
    usage.cacheWriteTokens += model.cacheCreationInputTokens
  }
  usage.costUsd = result.total_cost_usd ?? 0
  return usage
}

function assistantEvents(uuid: string, content: unknown, parent: string | null): ChatEvent[] {
  const parentToolUseId = parent ?? undefined
  return blocksOf(content).flatMap((block, index): ChatEvent[] => {
    if (block.type === 'text' && block.text) return [{ type: 'text', id: `${uuid}:${index}`, text: block.text, parentToolUseId }]
    if (block.type !== 'tool_use' || !block.id || !block.name) return []
    const toolUse: ChatEvent = { type: 'tool-use', id: block.id, name: block.name, input: block.input, parentToolUseId }
    if (!subagentTools.has(block.name)) return [toolUse]
    const input = (block.input ?? {}) as { description?: unknown; run_in_background?: unknown }
    return [toolUse, { type: 'subagent-start', id: block.id, description: String(input.description ?? 'Subagent'), background: input.run_in_background === true }]
  })
}

function userEvents(uuid: string | undefined, content: unknown): ChatEvent[] {
  if (typeof content === 'string') return uuid ? [{ type: 'user-text', id: uuid, text: content }] : []
  const blocks = blocksOf(content)
  const results = blocks.filter((block) => block.type === 'tool_result' && block.tool_use_id)
  if (results.length) return results.map((block) => ({ type: 'tool-result', toolUseId: block.tool_use_id!, text: resultText(block.content), isError: block.is_error === true }))
  const text = blocks.flatMap((block) => (block.type === 'text' && block.text ? [block.text] : [])).join('\n')
  return uuid && text ? [{ type: 'user-text', id: uuid, text }] : []
}

export function normalize(message: SDKMessage): ChatEvent[] {
  switch (message.type) {
    case 'assistant': {
      const events = assistantEvents(message.uuid, message.message?.content, message.parent_tool_use_id)
      return message.error ? [{ type: 'api-error', error: message.error }, ...events] : events
    }
    case 'user':
      if ('isSynthetic' in message && message.isSynthetic) return []
      return userEvents(message.uuid, message.message?.content)
    case 'stream_event': {
      const event = message.event
      if (message.parent_tool_use_id || event.type !== 'content_block_delta' || event.delta.type !== 'text_delta') return []
      return [{ type: 'text-delta', text: event.delta.text }]
    }
    case 'result': {
      const errorText = message.subtype === 'success' ? message.result : message.errors?.join('; ')
      return [{ type: 'turn-result', usage: usageOf(message), isError: message.is_error, ...(message.is_error && errorText ? { errorText } : {}) }]
    }
    case 'rate_limit_event': {
      const info = message.rate_limit_info
      const events: ChatEvent[] = [{ type: 'headroom', info }]
      if (info.status === 'rejected' && info.resetsAt) events.push({ type: 'retry-at', at: info.resetsAt * 1000 })
      return events
    }
    case 'system':
      if (message.subtype === 'init') return [{ type: 'session', sessionId: message.session_id, model: message.model }, ...(message.permissionMode ? [{ type: 'mode' as const, mode: message.permissionMode }] : [])]
      if (message.subtype === 'status') return message.permissionMode ? [{ type: 'mode', mode: message.permissionMode }] : []
      if (message.subtype === 'task_notification') return message.tool_use_id ? [{ type: 'subagent-stop', id: message.tool_use_id }] : []
      if (message.subtype === 'api_retry') return message.error === 'rate_limit' ? [{ type: 'retry-at', at: Date.now() + message.retry_delay_ms }] : []
      return quietSystem.has(message.subtype) ? [] : [{ type: 'other', label: `system:${message.subtype}` }]
    default:
      return quietTypes.has(message.type) ? [] : [{ type: 'other', label: String((message as { type?: unknown }).type) }]
  }
}
