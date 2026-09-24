import { describe, expect, it, vi } from 'vitest'
import { createRenderer, h, nextTick, shallowRef } from 'vue'
import CommandPicker from '../../src/renderer/panels/chat/CommandPicker.vue'
import { groupCommands } from '../../src/renderer/panels/chat/commands'
import type { CommandEntry } from '../../src/shared/commands'

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

const entries: CommandEntry[] = [
  { name: 'compact', description: 'Clear history but keep a summary', argumentHint: '<instructions>', kind: 'builtin' },
  { name: 'mws-pr', description: 'Open a pull request', argumentHint: '', kind: 'skill' },
  { name: 'deploy', description: 'Ship it', argumentHint: '[env]', kind: 'command' },
]

function mount(query: string, active = 0) {
  const state = shallowRef({ query, active })
  const choose = vi.fn()
  const browse = vi.fn()
  const hover = vi.fn()
  const root = node('root')
  createApp({
    render: () => h(CommandPicker, { groups: groupCommands(entries, state.value.query, ['deploy']), active: state.value.active, note: 'from last session', browse: true, onChoose: choose, onBrowse: browse, onHover: hover }),
  }).mount(root)
  return { root, choose, browse, hover, set: (next: { query: string; active: number }) => ((state.value = next), nextTick()) }
}

describe('command picker', () => {
  it('shows each entry’s name, argument hint and description under its group, recent first', () => {
    const { root } = mount('')
    expect(byClass(root, 'cmdg').map(textOf)).toEqual(['Recently used', 'Skills', 'Built-in commands'])
    expect(byClass(root, 'cmdn').map(textOf)).toEqual(['/deploy[env]', '/mws-pr', '/compact<instructions>'])
    expect(byClass(root, 'cmdd').map(textOf)).toEqual(['Ship it', 'Open a pull request', 'Clear history but keep a summary'])
    expect(textOf(root)).toContain('from last session')
  })

  it('marks the active entry and follows it as it moves', async () => {
    const picker = mount('', 1)
    expect(byClass(picker.root, 'on').map(textOf)).toEqual(['/mws-prOpen a pull request'])
    await picker.set({ query: 'comp', active: 0 })
    expect(byClass(picker.root, 'cmdr')).toHaveLength(1)
    expect(byClass(picker.root, 'on')[0]!.props['aria-selected']).toBe(true)
  })

  it('chooses on click, reports hover, and offers Browse all', () => {
    const { root, choose, browse, hover } = mount('')
    const rows = byClass(root, 'cmdr')
    ;(rows[2]!.props.onClick as () => void)()
    expect(choose).toHaveBeenCalledWith(entries[0])
    ;(rows[1]!.props.onMousemove as () => void)()
    expect(hover).toHaveBeenCalledWith(1)
    ;(byClass(root, 'cmdb')[0]!.props.onClick as () => void)()
    expect(browse).toHaveBeenCalled()
  })

  it('says so when nothing matches', async () => {
    const picker = mount('zzz')
    expect(textOf(picker.root)).toContain('No command or skill matches.')
  })
})
