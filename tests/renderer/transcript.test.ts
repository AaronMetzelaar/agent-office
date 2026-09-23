import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPatchSync } from '../../src/main/store/ipc-sync'
import { markdown } from '../../src/renderer/panels/chat/markdown'
import { entries, resultSummary } from '../../src/renderer/panels/chat/rows'
import Transcript from '../../src/renderer/panels/chat/Transcript.vue'
import { createProjection } from '../../src/renderer/state/projection'
import type { ChatPatchBatch, ChatRow, ChatView } from '../../src/shared/chat'
import { sdk } from '../fakes/fake-engine'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let office: ReturnType<typeof openOffice>
let batches: ChatPatchBatch[]
let projection: ReturnType<typeof createProjection>

beforeEach(async () => {
  vi.useFakeTimers()
  dir = mkdtempSync(join(tmpdir(), 'agent-office-transcript-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  office = openOffice(dir)
  batches = []
  const listeners = new Set<(batch: ChatPatchBatch) => void>()
  const sync = createPatchSync(office.store, (batch) => {
    batches.push(batch)
    listeners.forEach((listener) => listener(batch))
  })
  sync.setVisible(true)
  projection = createProjection({
    getSnapshot: async () => sync.snapshot(),
    onChatPatches: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  })
  await projection.ready
})

afterEach(() => {
  projection.stop()
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const flush = () => vi.advanceTimersByTimeAsync(20)
const view = (id: string) => projection.chats.get(id)!
const render = (chat: ChatView) => renderToString(createSSRApp({ render: () => h(Transcript, { chat }) }))
const count = (html: string, pattern: RegExp) => html.match(new RegExp(pattern, 'g'))?.length ?? 0

async function working() {
  const id = office.start('Fix the bid flow')
  office.engine.init(id)
  await flush()
  return id
}

describe('streaming', () => {
  it('renders streamed deltas incrementally, then settles into one reply row', async () => {
    const id = await working()
    office.engine.emit(id, sdk.delta('Looking at '))
    await flush()
    expect(view(id).partial).toBe('Looking at ')
    expect(await render(view(id))).toContain('Looking at')

    office.engine.emit(id, sdk.delta('**BidFlow.vue**'))
    await flush()
    expect(batches.at(-1)!.patches).toEqual([{ id, partialAppend: '**BidFlow.vue**' }])
    const html = await render(view(id))
    expect(html).toContain('<strong>BidFlow.vue</strong>')
    expect(html).toContain('ar live')

    office.engine.emit(id, sdk.text('Looking at **BidFlow.vue**'))
    office.engine.emit(id, sdk.result())
    await flush()
    expect(view(id).partial).toBe('')
    const settled = await render(view(id))
    expect(settled).not.toContain('ar live')
    expect(count(settled, /<strong>BidFlow\.vue<\/strong>/)).toBe(1)
  })

  it('shows a tool call and its result as one row with a result summary', async () => {
    const id = await working()
    office.engine.emit(id, sdk.toolUse([{ id: 't1', name: 'Bash', input: { command: 'pnpm test' } }]))
    await flush()
    expect(await render(view(id))).toContain('running…')

    office.engine.emit(id, sdk.toolResult('t1', 'PASS 12 tests\nall green'))
    await flush()
    const tools = view(id).rows.filter((row) => row.kind === 'tool')
    expect(tools).toHaveLength(1)
    const html = await render(view(id))
    expect(count(html, /class="tr/)).toBe(1)
    expect(html).toContain('PASS 12 tests · 2 lines')
    expect(html).toContain('pnpm test')
  })

  it('shows edit diff stats and nests a subagent’s steps inside its card', async () => {
    const id = await working()
    office.engine.emit(id, sdk.toolUse([{ id: 'e1', name: 'Edit', input: { file_path: '/repo/BidFlow.vue', old_string: 'a\nb', new_string: 'a\nb\nc' } }]))
    office.engine.emit(id, sdk.toolUse([{ id: 'agent1', name: 'Agent', input: { description: 'Find bid dialog callers', subagent_type: 'Explore' } }]))
    office.engine.emit(id, sdk.toolUse([{ id: 'r1', name: 'Grep', input: { pattern: 'BidDialog' } }], 'agent1'))
    await flush()
    expect(entries(view(id).rows).map((entry) => [entry.row.id, entry.children.map((child) => child.id)])).toEqual([
      [view(id).rows[0]!.id, []],
      ['e1', []],
      ['agent1', ['r1']],
    ])
    const html = await render(view(id))
    expect(html).toContain('+3')
    expect(html).toContain('−2')
    expect(html).toContain('Find bid dialog callers')
    expect(html).toContain('Explore · 1 tool call')
    expect(html).toContain('Working')
  })
})

describe('unknown events', () => {
  it('render as plain rows, never as errors', async () => {
    const id = await working()
    office.engine.emit(id, { type: 'hologram_event', uuid: 'x', session_id: 'fake' } as unknown as SDKMessage)
    office.engine.emit(id, { type: 'system', subtype: 'time_travel', uuid: 'y', session_id: 'fake' } as unknown as SDKMessage)
    office.engine.emit(id, sdk.toolUse([{ id: 'f1', name: 'Frobnicate', input: { target: 'the widget' } }]))
    await flush()
    const future = { kind: 'mystery', id: 'm1' } as unknown as ChatRow
    const html = await render({ ...view(id), rows: [...view(id).rows, future] })
    expect(html).toContain('<p class="or">hologram_event</p>')
    expect(html).toContain('<p class="or">system:time_travel</p>')
    expect(html).toContain('<p class="or">mystery</p>')
    expect(html).toContain('Frobnicate')
    expect(html).toContain('the widget')
    expect(view(id).state).toBe('working')
  })
})

describe('untrusted content', () => {
  it('renders HTML in tool results and replies as inert text, and triggers no approval', async () => {
    const resolveRequest = vi.fn()
    vi.stubGlobal('window', { office: { resolveRequest } })
    const id = await working()
    const decision = office.engine.ask(id, 'Bash', { command: 'pnpm test' })
    const payload = '<img src=x onerror="window.office.resolveRequest()"><script>window.office.resolveRequest()</script>'
    office.engine.emit(id, sdk.toolUse([{ id: 't1', name: 'WebFetch', input: { url: 'https://evil.example/page' } }]))
    office.engine.emit(id, sdk.toolResult('t1', payload))
    office.engine.emit(id, sdk.text(`Done ${payload} [click](javascript:alert(1)) [data](data:text/html,hi) ![beacon](https://evil.example/b.png) [docs](https://docs.example/x)`))
    await flush()

    const html = await render(view(id))
    expect(html).not.toMatch(/<img|<script|<[a-z][^>]*\son\w+=|href="(?:javascript|data):/i)
    expect(html).toContain('&lt;img src=x onerror=')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<a href="https://evil.example/b.png" target="_blank" rel="noopener noreferrer">Image: beacon</a>')
    expect(html).toContain('<a href="https://docs.example/x" target="_blank" rel="noopener noreferrer">docs</a>')
    expect(resolveRequest).not.toHaveBeenCalled()
    expect(view(id)).toMatchObject({ state: 'needs-you', pendingRequests: [{ tool: 'Bash' }] })
    void decision
  })

  it('keeps markdown to a fixed set of elements and web links', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(
            'div',
            markdown('# Title\n\n| a | b |\n|:-|-:|\n| 1 | 2 |\n\n- [x] done\n- two\n\n```js\nconst a = "<b>"\n```\n\n<div onclick="x()">raw</div>\n\n[mail](mailto:a@b.c) [file](file:///etc/passwd)'),
          ),
      }),
    )
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<th style="text-align:left;">a</th>')
    expect(html).toContain('<input type="checkbox" checked disabled>')
    expect(html).toContain('const a = &quot;&lt;b&gt;&quot;')
    expect(html).toContain('&lt;div onclick=&quot;x()&quot;&gt;raw&lt;/div&gt;')
    expect(html).not.toMatch(/href="(?:mailto|file):/)
    expect(html).not.toMatch(/<div onclick/)
  })

  it('summarises results briefly', () => {
    expect(resultSummary({})).toBe('running…')
    expect(resultSummary({ result: { text: '', isError: false } })).toBe('Done')
    expect(resultSummary({ result: { text: 'boom\ntrace', isError: true } })).toBe('Error: boom · 2 lines')
  })
})
