import { describe, expect, it } from 'vitest'
import { items, type AgentItem } from '../../src/renderer/panels/chat/groups'
import { agentOutcome, agentStats, findAgent } from '../../src/renderer/panels/chat/subagents'
import type { ChatRow } from '../../src/shared/chat'

const foregroundResult = 'Found three callers.\n\nagentId: aaf55aca770591bc1 (use SendMessage with to: \'aaf55aca770591bc1\' to continue this agent)\n<usage>subagent_tokens: 49344\ntool_uses: 7\nduration_ms: 85436</usage>'
const launched = "Async agent launched successfully.\nagentId: aa2306c32260fefde (internal ID - do not mention to user.)\nThe agent is working in the background."
const notification = (id: string, status: string) =>
  `<task-notification>\n<task-id>aa2306c32260fefde</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n<summary>Agent "Scan" finished</summary>\n<result>All clear.</result>\n<usage><subagent_tokens>97606</subagent_tokens><tool_uses>40</tool_uses><duration_ms>488475</duration_ms></usage>\n</task-notification>`
const agent = (id: string, text?: string, isError = false): ChatRow => ({ kind: 'tool', id, name: 'Agent', input: { description: 'Scan', subagent_type: 'Explore' }, ...(text ? { result: { text, isError } } : {}) })
const agentItem = (rows: ChatRow[], id: string) => findAgent(items(rows), id) as AgentItem
const none = new Set<string>()

describe('subagent outcomes', () => {
  it('reads the final stats, agent id and report from a foreground result', () => {
    const item = agentItem([agent('a1', foregroundResult)], 'a1')
    expect(agentOutcome(item, none, item.note)).toEqual({ status: 'done', agentId: 'aaf55aca770591bc1', tokens: 49344, tools: 7, ms: 85436, report: 'Found three callers.' })
    expect(agentStats(agentOutcome(item, none))).toBe('7 tool uses · 49.3k tokens · 1m 25s')
  })

  it('keeps a background subagent running until its notification, then takes status and stats from it', () => {
    const rows = [agent('b1', launched)]
    expect(agentOutcome(agentItem(rows, 'b1'), new Set(['b1']))).toMatchObject({ status: 'running', agentId: 'aa2306c32260fefde' })
    expect(agentOutcome(agentItem(rows, 'b1'), new Set(['b1'])).report).toBeUndefined()

    const done = agentItem([...rows, { kind: 'user', id: 'n1', text: notification('b1', 'completed') }], 'b1')
    expect(agentOutcome(done, none, done.note)).toEqual({ status: 'done', agentId: 'aa2306c32260fefde', tokens: 97606, tools: 40, ms: 488475, report: 'All clear.' })

    const stopped = agentItem([...rows, { kind: 'user', id: 'n2', text: notification('b1', 'stopped') }], 'b1')
    expect(agentOutcome(stopped, none, stopped.note).status).toBe('stopped')
  })

  it('marks an errored result failed and a result-less one running', () => {
    expect(agentOutcome(agentItem([agent('c1', 'boom', true)], 'c1'), none).status).toBe('failed')
    expect(agentOutcome(agentItem([agent('c2')], 'c2'), none).status).toBe('running')
  })

  it('finds nested subagents', () => {
    const rows: ChatRow[] = [agent('p1', foregroundResult), { ...agent('k1', foregroundResult), parentToolUseId: 'p1' } as ChatRow]
    expect(findAgent(items(rows), 'k1')?.row.id).toBe('k1')
  })
})
