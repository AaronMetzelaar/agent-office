import { describe, expect, it } from 'vitest'
import type { ChatState } from '../../src/shared/chat'
import type { DeptId } from '../../src/renderer/office/layout'
import { spotFor, type Spot } from '../../src/renderer/office/standby'

const spot = (state: ChatState, extra: { parked?: boolean; dept?: DeptId; prev?: Spot; open?: boolean; sent?: boolean } = {}) =>
  spotFor({ state, parked: extra.parked ?? false, dept: extra.dept ?? 'mkt' }, extra.prev, extra.open ?? false, extra.sent)

describe('where a chat rests', () => {
  it('keeps active and done-unread chats at their desk and sends read or idle chats to the Lounge', () => {
    expect(['starting', 'working', 'needs-you', 'stuck', 'done', 'idle'].map((state) => spot(state as ChatState))).toEqual(['desk', 'desk', 'desk', 'desk', 'desk', 'lounge'])
    expect(spot('done', { dept: 'gym' })).toBe('cooler')
    expect(spot('working', { dept: 'gym' })).toBe('desk')
    expect(spot('idle', { dept: 'gym' })).toBe('lounge')
  })

  it('lets parked chats doze in the Lounge, unless they are busy again', () => {
    expect(spot('idle', { parked: true })).toBe('lounge')
    expect(spot('done', { parked: true })).toBe('lounge')
    expect(spot('working', { parked: true })).toBe('desk')
  })

  it('never moves an agent while its chat is open, and walks it to the Lounge once Aaron leaves', () => {
    const read = spot('idle', { prev: 'desk', open: true })
    expect(read).toBe('desk')
    expect(spot('idle', { prev: read, open: true })).toBe('desk')
    expect(spot('idle', { prev: read, open: false })).toBe('lounge')
    expect(spot('idle', { dept: 'gym', prev: 'cooler', open: true })).toBe('cooler')
    expect(spot('idle', { prev: 'lounge', open: true })).toBe('lounge')
  })

  it('moves done, idle and stuck chats to the Lounge by hand, even while open, until they work again', () => {
    for (const state of ['done', 'idle', 'stuck'] as const) expect(spot(state, { prev: 'desk', open: true, sent: true })).toBe('lounge')
    expect(spot('done', { dept: 'gym', sent: true })).toBe('lounge')
    for (const state of ['working', 'needs-you', 'starting'] as const) expect(spot(state, { sent: true })).toBe('desk')
  })
})
