import { describe, expect, it } from 'vitest'
import type { ChatState } from '../../src/shared/chat'
import { layoutFloor, type DeptId } from '../../src/renderer/office/layout'
import { noSeating, reseat, type Seating, type Sitter } from '../../src/renderer/office/seating'
import { spotFor } from '../../src/renderer/office/standby'

interface Chat {
  id: string
  dept: DeptId
  state: ChatState
  parked?: boolean
  recent?: boolean
  sent?: boolean
  gone?: boolean
}

const sitters = (chats: readonly Chat[]): Sitter[] =>
  chats.map((c) => ({ id: c.id, dept: c.dept, spot: c.gone ? 'gone' : spotFor({ state: c.state, parked: !!c.parked, dept: c.dept }, undefined, false, c.sent), parked: !!c.parked, recent: c.recent ?? true }))
const step = (prev: Seating, chats: readonly Chat[], can = true) => reseat(prev, sitters(chats), can)
const floorOf = (s: Seating) => layoutFloor(s.size, s.lounge)
const set = (chats: Chat[], id: string, fields: Partial<Chat>) => chats.map((c) => (c.id === id ? { ...c, ...fields } : c))

const team: Chat[] = [
  { id: 'a', dept: 'mkt', state: 'working' },
  { id: 'b', dept: 'mkt', state: 'working' },
  { id: 'c', dept: 'mkt', state: 'done' },
  { id: 'd', dept: 'plat', state: 'working' },
  { id: 'e', dept: 'gym', state: 'working' },
]

describe('re-packing the floor', () => {
  it('re-packs only when a desk is added or removed; a state change leaves the layout identical', () => {
    const first = step(noSeating, team)
    const before = floorOf(first)
    const changes: Chat[][] = [
      set(team, 'c', { state: 'idle' }),
      set(team, 'a', { state: 'needs-you' }),
      set(team, 'b', { state: 'stuck' }),
      set(team, 'e', { state: 'done' }),
      set(team, 'd', { state: 'done', sent: true }),
      set(team, 'a', { state: 'idle' }),
    ]
    let prev = first
    for (const chats of changes) {
      const next = step(prev, chats)
      expect(next.repack).toBe(false)
      expect(next.size).toEqual(first.size)
      expect(next.lounge).toBe(first.lounge)
      expect(floorOf(next)).toEqual(before)
      prev = next
    }
    expect(step(prev, [...team, { id: 'f', dept: 'adm', state: 'working' }]).repack).toBe(true)
    expect(step(prev, team.filter((c) => c.id !== 'd'))).toMatchObject({ repack: true, size: expect.objectContaining({ plat: 0 }) })
  })

  it('keeps the section size while its agents rest, and re-packs once a reserved desk is released', () => {
    const first = step(noSeating, team)
    const resting = step(first, set(set(team, 'a', { state: 'idle' }), 'b', { state: 'idle' }))
    expect(resting.size.mkt).toBe(4)
    expect([...resting.desks.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    const parked = step(resting, set(set(set(team, 'a', { state: 'idle', parked: true }), 'b', { state: 'idle' }), 'c', { state: 'idle' }))
    expect(parked).toMatchObject({ repack: true, size: expect.objectContaining({ mkt: 3 }) })
    expect(parked.desks.has('a')).toBe(false)
  })
})

describe('reserved desks', () => {
  it('keeps the desk of a chat that walks to the Lounge, shown as away, and walks it back to that desk', () => {
    const first = step(noSeating, team)
    const away = step(first, set(team, 'b', { state: 'idle' }))
    expect(away.desks.get('b')).toEqual(first.desks.get('b'))
    const newcomer = step(away, [...set(team, 'b', { state: 'idle' }), { id: 'f', dept: 'mkt', state: 'working' }])
    expect(newcomer.desks.get('f')).not.toEqual(first.desks.get('b'))
    const back = step(newcomer, [...team, { id: 'f', dept: 'mkt', state: 'working' }])
    expect(back.desks.get('b')).toEqual(first.desks.get('b'))
    expect(back.repack).toBe(false)
  })

  it('releases the desk when the chat parks or is archived by any path, with no movers', () => {
    const first = step(noSeating, team)
    const resting = step(first, set(team, 'c', { state: 'idle' }))
    const parked = step(resting, set(team, 'c', { state: 'idle', parked: true }))
    expect(parked.desks.has('c')).toBe(false)
    expect(parked.size.mkt).toBe(3)
    const archived = step(resting, team.filter((c) => c.id !== 'c'))
    expect(archived.desks.has('c')).toBe(false)
    expect(archived.size.mkt).toBe(3)
    expect(archived.desks.get('a')).toEqual(first.desks.get('a'))
    expect(archived.desks.get('b')).toEqual(first.desks.get('b'))
  })

  it('holds a finished chat’s desk while the movers work, then removes it', () => {
    const first = step(noSeating, team)
    const leaving = step(first, set(team, 'b', { state: 'idle', gone: true }))
    expect(leaving).toMatchObject({ repack: false, size: first.size })
    expect(leaving.desks.get('b')).toEqual(first.desks.get('b'))
    expect(leaving.seats.has('b')).toBe(false)
    const cleared = step(leaving, team.filter((c) => c.id !== 'b'))
    expect(cleared).toMatchObject({ repack: true, size: expect.objectContaining({ mkt: 3 }) })
    expect(cleared.desks.get('a')).toEqual(first.desks.get('a'))
    expect(cleared.desks.get('c')).toEqual(first.desks.get('c'))
  })

  it('never moves a seated agent when a desk is removed, and moves only reservations of agents who are away', () => {
    const five: Chat[] = ['p', 'q', 'r', 's', 't'].map((id) => ({ id, dept: 'mob', state: 'working' }))
    const first = step(noSeating, five)
    const slots = Object.fromEntries([...first.desks].map(([id, d]) => [id, d.slot]))
    const mixed = step(first, set(set(five, 't', { state: 'idle' }), 'q', { state: 'idle' }))
    const removed = step(mixed, set(set(five, 't', { state: 'idle' }), 'q', { state: 'idle' }).filter((c) => c.id !== 'p' && c.id !== 'r'))
    expect(removed.size.mob).toBe(4)
    expect(removed.desks.get('s')!.slot).toBe(slots.s)
    expect(removed.desks.get('t')!.slot).toBeLessThan(4)
    expect(new Set([...removed.desks.values()].map((d) => d.slot)).size).toBe(3)
  })

  it('on relaunch reserves desks for idle chats active in the last day, and seats older ones in the Lounge with no desk', () => {
    const relaunch = step(noSeating, [
      { id: 'w', dept: 'plat', state: 'working' },
      { id: 'fresh', dept: 'plat', state: 'idle', recent: true },
      { id: 'old', dept: 'plat', state: 'idle', recent: false },
      { id: 'dozing', dept: 'plat', state: 'idle', parked: true, recent: false },
    ])
    expect([...relaunch.desks.keys()].sort()).toEqual(['fresh', 'w'])
    expect(relaunch.size.plat).toBe(3)
    expect(relaunch.seats.size).toBe(4)
  })
})

describe('Lounge seats', () => {
  it('gives every chat its own stable armchair, so resting and waking never moves anyone else', () => {
    const first = step(noSeating, team)
    const seats = new Map(first.seats)
    let prev = first
    for (const chats of [set(team, 'a', { state: 'idle' }), set(set(team, 'a', { state: 'idle' }), 'c', { state: 'idle' }), set(team, 'c', { state: 'idle' }), team]) {
      prev = step(prev, chats)
      expect(prev.seats).toEqual(seats)
    }
  })

  it('lets a newcomer take a free armchair without moving anyone, and closes gaps only when the floor re-packs', () => {
    const first = step(noSeating, team.map((c) => ({ ...c, state: 'idle' as const, recent: false })))
    const quiet = team.map((c) => ({ ...c, state: 'idle' as const, recent: false }))
    const gap = step(first, quiet.filter((c) => c.id !== 'b'))
    expect(gap.repack).toBe(false)
    for (const id of ['a', 'c', 'd', 'e']) expect(gap.seats.get(id)).toBe(first.seats.get(id))
    const filled = step(gap, [...quiet.filter((c) => c.id !== 'b'), { id: 'g', dept: 'mob', state: 'idle', recent: false }])
    expect(filled.seats.get('g')).toBe(first.seats.get('b'))
    expect(filled.repack).toBe(false)
    const grown = step(filled, [...quiet, { id: 'g', dept: 'mob', state: 'idle', recent: false }])
    expect(grown).toMatchObject({ repack: true, lounge: 6 })
  })
})
