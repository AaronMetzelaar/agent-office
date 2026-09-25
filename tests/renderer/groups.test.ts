import { describe, expect, it } from 'vitest'
import { doing, items, notice, summarize, type GroupItem } from '../../src/renderer/panels/chat/groups'
import type { ChatRow } from '../../src/shared/chat'
import { sessionRows } from '../fakes/session'

let seq = 0
const tool = (name: string, input: Record<string, unknown> = {}, result: { text: string; isError: boolean } | null = { text: 'ok', isError: false }, parentToolUseId?: string): ChatRow => ({
  kind: 'tool',
  id: `t${++seq}`,
  name,
  input,
  ...(result ? { result } : {}),
  ...(parentToolUseId ? { parentToolUseId } : {}),
})
const bash = (command: string, extra: Record<string, unknown> = {}, result?: { text: string; isError: boolean } | null) => tool('Bash', { command, ...extra }, result)
const text = (value: string): ChatRow => ({ kind: 'text', id: `m${++seq}`, text: value })
const finished = (summary: string, status = 'completed'): ChatRow => ({ kind: 'user', id: `u${++seq}`, text: `<task-notification>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>` })
const groups = (rows: ChatRow[]) => items(rows).filter((item): item is GroupItem => item.kind === 'group')

describe('tool group summaries', () => {
  it('counts commands and their failures', () => {
    expect(summarize([bash('ls'), bash('pwd')])).toBe('Ran 2 commands')
    expect(summarize([bash('a'), bash('b', {}, { text: 'boom', isError: true }), bash('c'), bash('d')])).toBe('Ran 4 commands (1 failed)')
  })

  it('joins mixed tools in order and counts files once each', () => {
    const rows = [tool('Read', { file_path: '/r/a.ts' }), tool('Read', { file_path: '/r/b.ts' }), tool('Read', { file_path: '/r/a.ts' }), tool('Read', { file_path: '/r/c.ts' }), bash('pnpm test'), bash('pnpm lint')]
    expect(summarize(rows)).toBe('Read 3 files, ran 2 commands')
    expect(summarize([tool('Edit', { file_path: '/r/a.ts' }), tool('MultiEdit', { file_path: '/r/a.ts' }), tool('Grep', { pattern: 'x' }), tool('Glob', { pattern: 'y' })])).toBe('Edited 1 file, searched 2 times')
    expect(summarize([tool('WebFetch', { url: 'https://a.example' }), tool('WebSearch', { query: 'vue' }), tool('mcp__linear__get_issue', { id: 'A-1' })])).toBe('Fetched 1 page, searched the web once, used get_issue')
  })

  it('uses a lone command’s own description', () => {
    expect(summarize([bash('pnpm install --frozen-lockfile', { description: 'Check lockfile drift' })])).toBe('Check lockfile drift')
    expect(summarize([bash('pnpm typecheck', { description: 'Typecheck the project' }, { text: 'error', isError: true })])).toBe('Typecheck the project (failed)')
    expect(summarize([bash('ls')])).toBe('Ran 1 command')
    expect(summarize([bash('ls', { description: 'List files' }), bash('pwd', { description: 'Show folder' })])).toBe('Ran 2 commands')
  })

  it('counts finished background commands from task notifications', () => {
    const rows = [bash('a', { run_in_background: true }), bash('b'), finished('Background command &quot;a&quot; completed (exit code 0)'), bash('c'), bash('d'), finished('Background command "e" failed', 'failed')]
    expect(summarize(rows)).toBe('Ran 4 commands, finished 2 background commands')
    expect(summarize([bash('a', { description: 'Watch CI' }), finished('Agent "x" completed')])).toBe('Ran 1 command, finished 1 background task')
    expect(notice(rows[2] as { text: string })).toEqual({ summary: 'Background command "a" completed (exit code 0)', failed: false, command: true })
    expect(notice(rows[5] as { text: string }).failed).toBe(true)
  })
})

describe('grouping rows', () => {
  it('folds each run of tool calls between prose into one group, keeping prose and notices apart', () => {
    const rows: ChatRow[] = [
      { kind: 'user', id: 'u', text: 'Fix it' },
      text('Looking.'),
      bash('ls'),
      { kind: 'other', id: 'o1', label: 'system:compact_boundary' },
      tool('Read', { file_path: '/r/a.ts' }),
      text('Found it.'),
      { kind: 'other', id: 'o2', label: 'Moved into the office. Your next message continues a copy.' },
      bash('pnpm test'),
    ]
    expect(items(rows).map((item) => (item.kind === 'group' ? item.summary : item.kind === 'row' ? item.row.kind : item.kind))).toEqual(['user', 'text', 'Ran 1 command, read 1 file', 'text', 'other', 'Ran 1 command'])
    expect(groups(rows)[0]!.rows.map((row) => row.id)).toContain('o1')
  })

  it('keeps a subagent as its own card, summarised the same way inside', () => {
    const agent = tool('Agent', { description: 'Find callers', subagent_type: 'Explore' }, null)
    const rows = [bash('ls'), agent, tool('Grep', { pattern: 'x' }, null, agent.id), tool('Read', { file_path: '/r/a.ts' }, null, agent.id), bash('pwd')]
    const list = items(rows)
    expect(list.map((item) => item.kind)).toEqual(['group', 'agent', 'group'])
    const card = list[1]!
    expect(card.kind === 'agent' && card.summary).toBe('Explore · Searched once, read 1 file')
    expect(card.kind === 'agent' && card.items.map((item) => item.kind === 'group' && item.summary)).toEqual(['Searched once, read 1 file'])
  })

  it('shows the call still running in a live group', () => {
    const rows = [bash('git status', {}, { text: '', isError: false }), bash('pnpm test', {}, null)]
    expect(doing(rows)).toEqual({ verb: 'Running', target: 'pnpm test' })
    expect(doing([tool('Read', { file_path: '/repo/src/a.ts' }, null)])).toEqual({ verb: 'Reading', target: 'a.ts' })
    expect(doing([tool('Frobnicate', {}, null)])).toEqual({ verb: 'Using', target: 'Frobnicate' })
    expect(doing([bash('ls')])).toBeUndefined()
  })

  it('turns the fixture session into six prose messages and quiet summaries', () => {
    const list = items(sessionRows)
    expect(list.filter((item) => item.kind === 'row' && item.row.kind === 'text')).toHaveLength(6)
    expect(list.flatMap((item) => (item.kind === 'group' ? [item.summary] : item.kind === 'agent' ? [item.summary] : []))).toEqual([
      'Ran 2 commands, read 2 files, searched once, fetched 1 page',
      'Read 1 file, searched once',
      'Explore · Searched once, read 2 files',
      'Find where the poll interval is configured',
      'Edited 2 files, ran 4 commands (1 failed), read 1 file',
      'Ran 4 commands, finished 1 background command',
      'Ran 3 commands',
    ])
  })
})

describe('artifacts', () => {
  const published = (path: string, url: string, version?: number) => tool('Artifact', { file_path: path }, { text: `Published ${path} at ${url}${version ? ` (Version ${version})` : ''}\n\nTo update: republish`, isError: false })

  it('shows each publish as its own card, marking republishes as updates', () => {
    const rows = [bash('ls'), published('/tmp/scratchpad/sales-report.html', 'https://claude.ai/artifact/a', 1), bash('pwd'), published('/tmp/scratchpad/sales-report.html', 'https://claude.ai/artifact/a'), published('/tmp/x/old.html', 'https://claude.ai/artifact/b', 3)]
    const cards = items(rows).flatMap((item) => (item.kind === 'artifact' ? [item.artifact] : []))
    expect(cards.map(({ title, edited }) => [title, edited])).toEqual([
      ['sales report', false],
      ['sales report', true],
      ['old', true],
    ])
    expect(groups(rows).map((group) => group.summary)).toEqual(['Ran 1 command', 'Ran 1 command'])
  })

  it('ignores failed publishes and other Artifact actions', () => {
    const rows = [tool('Artifact', { action: 'list' }, { text: 'Published nothing at https://claude.ai/artifact/z', isError: false }), tool('Artifact', { file_path: '/tmp/a.html' }, { text: 'Denied', isError: true })]
    expect(items(rows).some((item) => item.kind === 'artifact')).toBe(false)
  })
})
