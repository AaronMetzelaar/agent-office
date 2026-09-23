import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { errorReason, normalize } from '../../src/main/sessions/normalize'
import { sdk } from '../fakes/fake-engine'

const raw = (fields: Record<string, unknown>) => ({ uuid: 'u1', session_id: 's', ...fields }) as unknown as SDKMessage

describe('normalize', () => {
  it('maps init to the session id and model', () => {
    expect(normalize(sdk.init('sess-1', 'claude-opus-5-5'))).toEqual([{ type: 'session', sessionId: 'sess-1', model: 'claude-opus-5-5' }])
  })

  it('streams top-level text deltas and ignores other stream events', () => {
    expect(normalize(sdk.delta('Hel'))).toEqual([{ type: 'text-delta', text: 'Hel' }])
    expect(normalize(raw({ type: 'stream_event', parent_tool_use_id: 'agent-1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } }))).toEqual([])
    expect(normalize(raw({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start' } }))).toEqual([])
  })

  it('maps parallel tool calls in one message to tool uses in order', () => {
    const events = normalize(
      sdk.toolUse([
        { id: 't1', name: 'Read', input: { file_path: '/repo/a.ts' } },
        { id: 't2', name: 'Grep', input: { pattern: 'bid' } },
      ]),
    )
    expect(events.map((event) => event.type === 'tool-use' && event.id)).toEqual(['t1', 't2'])
  })

  it('starts a subagent from an Agent call and attaches its work by parent_tool_use_id', () => {
    expect(normalize(sdk.toolUse([{ id: 'agent-1', name: 'Agent', input: { description: 'Explore bids', run_in_background: true } }]))).toEqual([
      { type: 'tool-use', id: 'agent-1', name: 'Agent', input: { description: 'Explore bids', run_in_background: true } },
      { type: 'subagent-start', id: 'agent-1', description: 'Explore bids', background: true },
    ])
    expect(normalize(sdk.toolUse([{ id: 't9', name: 'Read', input: {} }], 'agent-1'))).toEqual([{ type: 'tool-use', id: 't9', name: 'Read', input: {}, parentToolUseId: 'agent-1' }])
    expect(normalize(sdk.taskNotification('agent-1'))).toEqual([{ type: 'subagent-stop', id: 'agent-1' }])
  })

  it('maps tool results, joining block content and keeping the error flag', () => {
    expect(normalize(sdk.toolResult('t1', [{ type: 'text', text: 'line 1' }, { type: 'image' }], true))).toEqual([
      { type: 'tool-result', toolUseId: 't1', text: 'line 1\n[image]', isError: true },
    ])
  })

  it('sums usage across models on a turn result and keeps the error text', () => {
    const result = raw({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'done',
      total_cost_usd: 0.42,
      modelUsage: {
        opus: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 1000, cacheCreationInputTokens: 10 },
        haiku: { inputTokens: 5, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      },
    })
    expect(normalize(result)).toEqual([
      { type: 'turn-result', isError: false, usage: { inputTokens: 105, outputTokens: 51, cacheReadTokens: 1000, cacheWriteTokens: 10, costUsd: 0.42 } },
    ])
    expect(normalize(sdk.errorResult('API Error: 529 overloaded'))).toEqual([expect.objectContaining({ type: 'turn-result', isError: true, errorText: 'API Error: 529 overloaded' })])
  })

  it('turns rate limit events into headroom plus a retry time when rejected', () => {
    const info = { status: 'rejected' as const, rateLimitType: 'five_hour' as const, resetsAt: 1_790_000_000 }
    expect(normalize(sdk.rateLimit(info))).toEqual([
      { type: 'headroom', info },
      { type: 'retry-at', at: 1_790_000_000_000 },
    ])
    const retry = normalize(raw({ type: 'system', subtype: 'api_retry', error: 'rate_limit', retry_delay_ms: 30_000 }))
    expect(retry).toEqual([{ type: 'retry-at', at: expect.any(Number) }])
  })

  it('marks typed assistant errors', () => {
    expect(normalize(sdk.apiError('authentication_failed'))).toEqual([{ type: 'api-error', error: 'authentication_failed' }])
  })

  it('reads user text from transcripts but skips synthetic prompts', () => {
    expect(normalize(raw({ type: 'user', message: { role: 'user', content: 'Fix the bid flow' } }))).toEqual([{ type: 'user-text', id: 'u1', text: 'Fix the bid flow' }])
    expect(normalize(raw({ type: 'user', isSynthetic: true, message: { role: 'user', content: 'hook output' } }))).toEqual([])
  })

  it('turns unknown message types into a generic event and never throws', () => {
    expect(normalize(raw({ type: 'hologram_projection' }))).toEqual([{ type: 'other', label: 'hologram_projection' }])
    expect(normalize(raw({ type: 'system', subtype: 'compact_boundary' }))).toEqual([{ type: 'other', label: 'system:compact_boundary' }])
    expect(normalize(raw({ type: 'system', subtype: 'hook_started' }))).toEqual([])
    expect(normalize(raw({ type: 'tool_progress' }))).toEqual([])
    expect(normalize(raw({ type: 'assistant', parent_tool_use_id: null, message: { content: 'not blocks' } }))).toEqual([])
  })
})

describe('errorReason', () => {
  it.each([
    ['Failed to authenticate. API Error: 401 OAuth access token is invalid', 'needs-login'],
    ['authentication_failed', 'needs-login'],
    ['rate_limit: You’ve hit your usage limit', 'rate-limited'],
    ['API Error: 429 Too Many Requests', 'rate-limited'],
    ['Claude Code returned an error result: [ede_diagnostic] result_type=user', undefined],
    ['Claude Code process exited with code 1', undefined],
  ])('%s → %s', (text, reason) => {
    expect(errorReason(new Error(text))).toBe(reason)
  })
})
