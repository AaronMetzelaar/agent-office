import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { maxRows } from '../../shared/chat'
import { normalize, type ChatEvent } from './normalize'

export async function readHistory(sessionId: string, { skip = 0, limit = maxRows } = {}): Promise<{ events: ChatEvent[]; more: boolean }> {
  const { getSessionMessages } = await import('@anthropic-ai/claude-agent-sdk')
  const messages = await getSessionMessages(sessionId)
  const end = Math.max(0, messages.length - skip)
  const start = Math.max(0, end - limit)
  const events = messages.slice(start, end).flatMap((message) => normalize(message as unknown as SDKMessage))
  return { events, more: start > 0 }
}
