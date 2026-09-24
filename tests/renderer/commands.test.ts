import { describe, expect, it } from 'vitest'
import { groupCommands, insertCommand, pickerKey, rememberCommand, score, slashTrigger } from '../../src/renderer/panels/chat/commands'
import type { CommandEntry, CommandKind } from '../../src/shared/commands'

const entry = (name: string, kind: CommandKind = 'skill', description = ''): CommandEntry => ({ name, description, argumentHint: '', kind })
const entries = [entry('compact', 'builtin', 'Compact the chat'), entry('clear', 'builtin'), entry('mws-pr'), entry('mws-verify'), entry('pr-comment-rundown'), entry('deploy', 'command'), entry('codex:rescue', 'plugin', 'Hand a task to Codex')]
const names = (groups: ReturnType<typeof groupCommands>) => groups.map((group) => `${group.label}: ${group.entries.map((item) => item.name).join(' ')}`)

describe('slash trigger', () => {
  it('opens at the start of the message or after whitespace', () => {
    expect(slashTrigger('/', 1)).toEqual({ start: 0, end: 1, query: '' })
    expect(slashTrigger('/mws', 4)).toEqual({ start: 0, end: 4, query: 'mws' })
    expect(slashTrigger('run\n/co', 7)).toEqual({ start: 4, end: 7, query: 'co' })
    expect(slashTrigger('then /codex:re', 14)).toEqual({ start: 5, end: 14, query: 'codex:re' })
  })

  it('stays shut inside paths, after a finished command, and away from the caret', () => {
    expect(slashTrigger('src/app', 4)).toBeUndefined()
    expect(slashTrigger('/Users/aaron', 12)).toBeUndefined()
    expect(slashTrigger('/compact ', 9)).toBeUndefined()
    expect(slashTrigger('/compact now', 12)).toBeUndefined()
    expect(slashTrigger('', 0)).toBeUndefined()
  })

  it('spans the whole word the caret sits in', () => {
    expect(slashTrigger('/comp later', 3)).toEqual({ start: 0, end: 5, query: 'co' })
  })
})

describe('insertion', () => {
  it('replaces the typed command with /name and a space, keeping the rest', () => {
    expect(insertCommand('/co', 'compact', { start: 0, end: 3 })).toEqual({ text: '/compact ', caret: 9 })
    expect(insertCommand('run /mw then', 'mws-pr', { start: 4, end: 7 })).toEqual({ text: 'run /mws-pr then', caret: 12 })
  })

  it('adds a space before the command when inserted mid-word from Browse all', () => {
    expect(insertCommand('fix it', 'mws-pr', { start: 6, end: 6 })).toEqual({ text: 'fix it /mws-pr ', caret: 15 })
    expect(insertCommand('', 'clear', { start: 0, end: 0 })).toEqual({ text: '/clear ', caret: 7 })
  })
})

describe('fuzzy filter and grouping', () => {
  it('ranks prefix over word start over substring over subsequence over description', () => {
    const q = 'pr'
    expect(score(entry('pr-comment-rundown'), q)).toBeGreaterThan(score(entry('mws-pr'), q))
    expect(score(entry('mws-pr'), q)).toBeGreaterThan(score(entry('improve'), q))
    expect(score(entry('improve'), q)).toBeGreaterThan(score(entry('pxr'), q))
    expect(score(entry('pxr'), q)).toBeGreaterThan(score(entry('zzz', 'skill', 'makes a pr'), q))
    expect(score(entry('zzz'), q)).toBe(0)
  })

  it('groups skills, custom commands, plugin skills and built-ins, with recent entries first, when nothing is typed', () => {
    expect(names(groupCommands(entries, '', ['compact', 'mws-verify']))).toEqual([
      'Recently used: compact mws-verify',
      'Skills: mws-pr pr-comment-rundown',
      'Custom commands: deploy',
      'Plugin skills: codex:rescue',
      'Built-in commands: clear',
    ])
  })

  it('puts the group with the best match first while typing, and floats recent entries within a group', () => {
    expect(names(groupCommands(entries, 'co', []))).toEqual(['Built-in commands: compact', 'Plugin skills: codex:rescue', 'Skills: pr-comment-rundown'])
    expect(names(groupCommands(entries, 'mws', ['mws-verify']))).toEqual(['Skills: mws-verify mws-pr'])
    expect(names(groupCommands(entries, 'codex', []))).toEqual(['Plugin skills: codex:rescue'])
    expect(groupCommands(entries, 'qqq', [])).toEqual([])
  })

  it('caps the list and stays quick with hundreds of entries', () => {
    const many = Array.from({ length: 400 }, (_, index) => entry(`skill-${index}`, index % 2 ? 'skill' : 'command', `does thing ${index}`))
    const started = performance.now()
    for (let round = 0; round < 50; round++) groupCommands(many, 'sk1', ['skill-10'], 60)
    expect((performance.now() - started) / 50).toBeLessThan(5)
    expect(groupCommands(many, '', [], 60).flatMap((group) => group.entries)).toHaveLength(60)
  })
})

describe('keyboard', () => {
  it('moves with up and down, wrapping, chooses with Enter or Tab, and closes with Esc', () => {
    expect(pickerKey({ key: 'ArrowDown' }, 0, 3)).toEqual({ kind: 'move', index: 1 })
    expect(pickerKey({ key: 'ArrowDown' }, 2, 3)).toEqual({ kind: 'move', index: 0 })
    expect(pickerKey({ key: 'ArrowUp' }, 0, 3)).toEqual({ kind: 'move', index: 2 })
    expect(pickerKey({ key: 'Enter' }, 1, 3)).toEqual({ kind: 'choose' })
    expect(pickerKey({ key: 'Tab' }, 1, 3)).toEqual({ kind: 'choose' })
    expect(pickerKey({ key: 'Escape' }, 1, 3)).toEqual({ kind: 'close' })
  })

  it('leaves typing, modified keys and an empty list alone', () => {
    expect(pickerKey({ key: 'a' }, 0, 3)).toBeUndefined()
    expect(pickerKey({ key: 'Enter', metaKey: true }, 0, 3)).toBeUndefined()
    expect(pickerKey({ key: 'Enter', shiftKey: true }, 0, 3)).toBeUndefined()
    expect(pickerKey({ key: 'Enter' }, 0, 0)).toBeUndefined()
    expect(pickerKey({ key: 'Escape' }, 0, 0)).toEqual({ kind: 'close' })
  })
})

describe('recently used', () => {
  it('moves the chosen entry to the front and keeps eight', () => {
    const recent = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    expect(rememberCommand('c', recent)).toEqual(['c', 'a', 'b', 'd', 'e', 'f', 'g', 'h'])
    expect(rememberCommand('z', recent)).toEqual(['z', 'a', 'b', 'c', 'd', 'e', 'f', 'g'])
  })
})
