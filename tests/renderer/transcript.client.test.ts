import { describe, expect, it } from 'vitest'
import { createRenderer, h, nextTick, shallowRef } from 'vue'
import Transcript from '../../src/renderer/panels/chat/Transcript.vue'
import type { ChatRow, ChatView } from '../../src/shared/chat'
import { sessionChat } from '../fakes/session'

type Node = { tag: string; text: string; props: Record<string, unknown>; children: Node[]; parent?: Node }

const node = (tag: string, text = ''): Node => ({ tag, text, props: {}, children: [] })
const detach = (child: Node) => {
  child.parent?.children.splice(child.parent.children.indexOf(child), 1)
  child.parent = undefined
}
const { createApp } = createRenderer<Node, Node>({
  createElement: (tag) => node(tag),
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText: (target, text) => void (target.text = text),
  setElementText: (target, text) => {
    target.children.forEach((child) => (child.parent = undefined))
    target.children = text ? [{ ...node('#text', text), parent: target }] : []
  },
  insert: (child, parent, anchor) => {
    detach(child)
    child.parent = parent
    const at = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(at === -1 ? parent.children.length : at, 0, child)
  },
  remove: detach,
  parentNode: (child) => child.parent ?? null,
  nextSibling: (child) => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
  patchProp: (el, key, _previous, next) => void (el.props[key] = next),
})

const textOf = (target: Node): string => (target.tag === '#comment' ? '' : target.tag === '#text' ? target.text : target.children.map(textOf).join(''))
const find = (target: Node, test: (candidate: Node) => boolean): Node[] => [...(test(target) ? [target] : []), ...target.children.flatMap((child) => find(child, test))]
const classes = (target: Node) => [target.props.class].flat(2).flatMap((value) => (typeof value === 'string' ? value.split(' ') : value && typeof value === 'object' ? Object.keys(value).filter((key) => (value as Record<string, unknown>)[key]) : []))
const byClass = (target: Node, name: string) => find(target, (candidate) => classes(candidate).includes(name))
const groupButtons = (root: Node) => root.children[0]!.children.filter((child) => classes(child).includes('tg')).map((group) => byClass(group, 'tgh')[0]!)
const click = async (target: Node) => {
  ;(target.props.onClick as () => void)()
  await nextTick()
}

function mount(chat: ChatView) {
  const current = shallowRef(chat)
  const root = node('root')
  createApp({ render: () => h(Transcript, { chat: current.value }) }).mount(root)
  return { root, update: (next: ChatView) => ((current.value = next), nextTick()) }
}

describe('transcript groups', () => {
  it('shows prose in full and each run of tool calls as one collapsed line', () => {
    const { root } = mount(sessionChat({ state: 'idle' }))
    const text = textOf(root)
    expect(byClass(root, 'ar')).toHaveLength(6)
    expect(text).toContain('The failure is a timeout waiting for /api/bids.')
    expect(text).toContain('Want me to open a PR?')
    expect(groupButtons(root).map((button) => textOf(button).replace('›', '').trim())).toEqual([
      'Ran 2 commands, read 2 files, searched once, fetched 1 page',
      'Read 1 file, searched once',
      'Find where the poll interval is configured',
      'Edited 2 files, ran 4 commands (1 failed), read 1 file',
      'Ran 4 commands, finished 1 background command',
      'Ran 3 commands',
    ])
    expect(groupButtons(root).every((button) => button.props['aria-expanded'] === false)).toBe(true)
    expect(byClass(root, 'tr')).toHaveLength(0)
    expect(byClass(root, 'sub')).toHaveLength(1)
  })

  it('expands a group on click into one line per call, keeping failed calls red', async () => {
    const { root } = mount(sessionChat({ state: 'idle' }))
    const group = groupButtons(root)[3]!
    await click(group)
    expect(group.props['aria-expanded']).toBe(true)
    const calls = byClass(root, 'tr')
    expect(calls).toHaveLength(9)
    const failed = calls.filter((call) => classes(call).includes('err'))
    expect(failed).toHaveLength(1)
    expect(textOf(failed[0]!)).toContain('pnpm typecheck')
    expect(textOf(failed[0]!)).toContain("Error: src/composables/useAuctionPoll.ts(42,7): error TS2322")
    expect(textOf(calls[0]!)).toContain('+3')
    expect(textOf(root)).toContain('The failure is a timeout waiting for /api/bids.')

    await click(group)
    expect(byClass(root, 'tr')).toHaveLength(0)
  })

  it('lists background task notices inside the group instead of as user bubbles', async () => {
    const { root } = mount(sessionChat({ state: 'idle' }))
    expect(byClass(root, 'ur').map(textOf)).toEqual(['The bid flow e2e test is flaky on CI. Can you find out why and fix it?', 'Yes, open a PR'])
    await click(groupButtons(root)[4]!)
    expect(byClass(root, 'nt').map(textOf)).toEqual(['Background command "Run the bid flow e2e test 20 times" completed (exit code 0)'])
  })

  it('shows the running call inline mid-turn, then collapses into its summary', async () => {
    const { root, update } = mount(sessionChat())
    const last = () => groupButtons(root).at(-1)!
    expect(textOf(last())).toContain('Running gh pr create --fill…')
    expect(byClass(root, 'spin')).toHaveLength(1)

    await update(sessionChat({ partial: 'The PR is open' }))
    expect(textOf(last())).toContain('Ran 3 commands')
    expect(byClass(root, 'spin')).toHaveLength(0)
  })

  it('renders HTML in an expanded tool result as inert text', async () => {
    const payload = '<img src=x onerror="window.office.resolveRequest()"><script>alert(1)</script>'
    const rows: ChatRow[] = [{ kind: 'tool', id: 't1', name: 'WebFetch', input: { url: 'https://evil.example/page' }, result: { text: payload, isError: false } }]
    const { root } = mount(sessionChat({ state: 'idle', rows }))
    await click(groupButtons(root)[0]!)
    expect(textOf(root)).toContain(payload)
    expect(find(root, (candidate) => candidate.tag === 'img' || candidate.tag === 'script')).toHaveLength(0)
  })
})
