import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SubagentStrip from '../../src/renderer/panels/chat/SubagentStrip.vue'
import { emptyUsage, type ChatView } from '../../src/shared/chat'

const chat = (fields: Partial<ChatView>): ChatView => ({ id: 'c', accountId: 'main', cwd: '/x', title: 'c', archived: false, state: 'working', stateSince: 0, unread: false, activity: '', pending: [], pendingRequests: [], subagents: [], usage: emptyUsage(), partial: '', createdAt: 0, lastActivityAt: 0, rows: [], ...fields })
const render = (view: ChatView) => renderToString(createSSRApp({ render: () => h(SubagentStrip, { chat: view }) }))

describe('subagent strip', () => {
  it('stays hidden with no running subagents', async () => {
    expect(await render(chat({}))).not.toContain('running')
  })

  it('lists every running subagent with what it is doing now', async () => {
    const subagents = Array.from({ length: 6 }, (_, k) => ({ id: `a${k}`, description: `Scan ${k}`, startedAt: Date.now(), ...(k ? { activity: `Running sleep ${k}` } : {}) }))
    const html = await render(chat({ subagents }))
    expect(html).toContain('6 subagents running')
    expect(html.match(/<li/g)).toHaveLength(6)
    expect(html).toContain('Scan 5')
    expect(html).toContain('Running sleep 5')
    expect(html).toContain('Starting')
  })

  it('shows each subagent’s type, tool uses, tokens and runtime', async () => {
    const html = await render(chat({ subagents: [{ id: 'a', description: 'Scan', agentType: 'Explore', tools: 3, tokens: 12_345, startedAt: Date.now() - 65_000 }] }))
    expect(html).toContain('Explore · 3 tool uses · 12.3k tokens · 1m 5s')
  })
})
