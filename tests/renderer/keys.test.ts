import { describe, expect, it } from 'vitest'
import { keyAction, type KeyContext } from '../../src/renderer/state/keys'

const card = (id: string, extra: Partial<NonNullable<KeyContext['card']>> = {}) => ({ id, tool: 'Bash', dangerous: false, alwaysAllow: true, ...extra })
const queue: KeyContext['queue'] = [{ chatId: 'crashed', requests: [] }, { chatId: 'a', requests: [card('ra')] }, { chatId: 'b', requests: [card('rb')] }, { requests: [] }]

describe('keys', () => {
  it('with no chat open, 1 opens the first queued request card instead of deciding, and a second press allows it', () => {
    expect(keyAction('1', { queue })).toEqual({ kind: 'open', chatId: 'a' })
    expect(keyAction('1', { open: 'a', queue, card: card('ra') })).toEqual({ kind: 'decide', requestId: 'ra', decision: { kind: 'allow' } })
  })

  it('2 always-allows only when the card offers it, and 3 denies', () => {
    expect(keyAction('2', { open: 'a', queue, card: card('ra') })).toEqual({ kind: 'decide', requestId: 'ra', decision: { kind: 'always' } })
    expect(keyAction('2', { open: 'a', queue, card: card('ra', { alwaysAllow: false }) })).toBeUndefined()
    expect(keyAction('3', { open: 'a', queue, card: card('ra') })).toEqual({ kind: 'decide', requestId: 'ra', decision: { kind: 'deny' } })
  })

  it('a dangerous request ignores 1, 2 and 3', () => {
    for (const key of ['1', '2', '3']) expect(keyAction(key, { open: 'a', queue, card: card('ra', { dangerous: true }) })).toBeUndefined()
  })

  it('a question leaves the number keys to its own options', () => {
    for (const key of ['1', '2', '3']) expect(keyAction(key, { open: 'a', queue, card: card('ra', { tool: 'AskUserQuestion' }) })).toBeUndefined()
  })

  it('an open chat without a card, or an empty queue, ignores the answer keys', () => {
    expect(keyAction('1', { open: 'idle', queue })).toBeUndefined()
    expect(keyAction('1', { queue: [] })).toBeUndefined()
  })

  it('j and k step through the queue and stop at either end', () => {
    expect(keyAction('j', { queue })).toEqual({ kind: 'open', chatId: 'crashed' })
    expect(keyAction('k', { queue })).toEqual({ kind: 'open', chatId: 'b' })
    expect(keyAction('j', { open: 'crashed', queue })).toEqual({ kind: 'open', chatId: 'a' })
    expect(keyAction('k', { open: 'b', queue })).toEqual({ kind: 'open', chatId: 'a' })
    expect(keyAction('j', { open: 'b', queue })).toBeUndefined()
    expect(keyAction('k', { open: 'crashed', queue })).toBeUndefined()
    expect(keyAction('j', { open: 'somewhere-else', queue })).toEqual({ kind: 'open', chatId: 'crashed' })
    expect(keyAction('x', { queue })).toBeUndefined()
  })
})
