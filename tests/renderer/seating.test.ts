import { describe, expect, it } from 'vitest'
import type { ChatState } from '../../src/shared/chat'
import { layoutFloor, type DeptId } from '../../src/renderer/office/layout'
import { builtDesks, noSeating, reseat, type Seating, type Sitter } from '../../src/renderer/office/seating'
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
const without = (chats: Chat[], ...ids: string[]) => chats.filter((c) => !ids.includes(c.id))
const newcomer: Chat = { id: 'new', dept: 'adm', state: 'working' }

const team: Chat[] = [
  { id: 'a', dept: 'mkt', state: 'working' },
  { id: 'b', dept: 'mkt', state: 'working' },
  { id: 'c', dept: 'mkt', state: 'idle' },
  { id: 'd', dept: 'plat', state: 'working' },
  { id: 'e', dept: 'gym', state: 'working' },
]

describe('re-packing the floor', () => {
  it('re-packs only when a desk or a Lounge chair is added or a desk is removed; other state changes leave the layout identical', () => {
    const first = step(noSeating, team)
    expect(first.lounge).toBe(1)
    const before = floorOf(first)
    const changes: Chat[][] = [
      set(team, 'a', { state: 'needs-you' }),
      set(team, 'b', { state: 'stuck' }),
      set(team, 'e', { state: 'done' }),
      set(team, 'c', { state: 'working' }),
      set(set(team, 'c', { state: 'working' }), 'd', { state: 'done', sent: true }),
      set(set(team, 'c', { state: 'working' }), 'd', { state: 'working' }),
      set(set(team, 'c', { state: 'working' }), 'a', { state: 'idle' }),
    ]
    let prev = first
    for (const chats of changes) {
      const next = step(prev, chats)
      expect(next.repack).toBe(false)
      expect(next.size).toEqual(first.size)
      expect(floorOf(next)).toEqual(before)
      prev = next
    }
    const crowded = step(prev, set(team, 'a', { state: 'idle' }))
    expect(crowded).toMatchObject({ repack: true, lounge: 2, size: first.size })
    expect(step(prev, [...changes.at(-1)!, newcomer]).repack).toBe(true)
  })

  it('keeps the section size while its agents rest, and only a desk add closes the gap a released desk leaves', () => {
    const first = step(noSeating, team)
    const resting = step(first, set(team, 'a', { state: 'idle' }))
    expect(resting.size.mkt).toBe(4)
    expect([...resting.desks.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    const parked = step(resting, set(set(team, 'a', { state: 'idle', parked: true }), 'c', { state: 'idle' }))
    expect(parked.desks.has('a')).toBe(false)
    expect(builtDesks(parked, 'mkt')).toEqual([1, 2, 3])
    expect(parked).toMatchObject({ repack: false, size: expect.objectContaining({ mkt: 4 }) })
    const later = step(parked, [...set(team, 'a', { state: 'idle', parked: true }), newcomer])
    expect(later).toMatchObject({ repack: true, size: expect.objectContaining({ mkt: 3 }) })
    expect(later.desks.get('b')).toEqual(parked.desks.get('b'))
  })
})

describe('reserved desks', () => {
  it('keeps the desk of a chat that walks to the Lounge, and walks it back to that desk', () => {
    const first = step(noSeating, team)
    const away = step(first, set(team, 'b', { state: 'idle' }))
    expect(away.desks.get('b')).toEqual(first.desks.get('b'))
    const withNewcomer = [...set(team, 'b', { state: 'idle' }), { id: 'f', dept: 'mkt', state: 'working' } as Chat]
    const joined = step(away, withNewcomer)
    expect(joined.desks.get('f')).not.toEqual(first.desks.get('b'))
    const back = step(joined, set(withNewcomer, 'b', { state: 'working' }))
    expect(back.desks.get('b')).toEqual(joined.desks.get('b'))
    expect(back.repack).toBe(false)
  })

  it('releases the desk when the chat parks or is archived by any path, and nobody else moves', () => {
    const first = step(noSeating, team)
    const parked = step(first, set(team, 'c', { parked: true }))
    expect(parked.desks.has('c')).toBe(false)
    const archived = step(first, without(team, 'c'))
    expect(archived.desks.has('c')).toBe(false)
    for (const next of [parked, archived]) {
      expect(builtDesks(next, 'mkt')).not.toContain(first.desks.get('c')!.slot)
      expect(next.desks.get('a')).toEqual(first.desks.get('a'))
      expect(next.desks.get('b')).toEqual(first.desks.get('b'))
      expect(next.free.mkt).toBe(first.free.mkt)
    }
  })

  it('holds a finished chat’s desk while the movers work, then removes that desk itself and leaves the free desk where it is', () => {
    const first = step(noSeating, team)
    const leaving = step(first, set(team, 'b', { gone: true }))
    expect(leaving).toMatchObject({ repack: false, size: first.size })
    expect(leaving.desks.get('b')).toEqual(first.desks.get('b'))
    const cleared = step(leaving, without(team, 'b'))
    expect(builtDesks(cleared, 'mkt')).toEqual(builtDesks(first, 'mkt').filter((slot) => slot !== first.desks.get('b')!.slot))
    expect(cleared.free.mkt).toBe(first.free.mkt)
    const next = step(cleared, [...without(team, 'b'), newcomer])
    expect(builtDesks(next, 'mkt')).toEqual([0, 1, 2])
    expect(next.desks.get('a')).toEqual(first.desks.get('a'))
  })

  it('never moves a seated agent when desks go, and renumbers only reservations of agents who are away', () => {
    const five: Chat[] = ['p', 'q', 'r', 's', 't'].map((id) => ({ id, dept: 'mob', state: 'working' }))
    const first = step(noSeating, five)
    const slots = Object.fromEntries([...first.desks].map(([id, d]) => [id, d.slot]))
    const rest = set(set(five, 't', { state: 'idle' }), 'q', { state: 'idle' })
    const removed = step(step(first, rest), without(rest, 'p', 'r'))
    for (const id of ['q', 's', 't']) expect(removed.desks.get(id)!.slot).toBe(slots[id])
    const compacted = step(removed, [...without(rest, 'p', 'r'), newcomer])
    expect(compacted.size.mob).toBe(4)
    expect(compacted.desks.get('s')!.slot).toBe(slots.s)
    expect(new Set([...compacted.desks.values()].filter((d) => d.dept === 'mob').map((d) => d.slot)).size).toBe(3)
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
    expect([...relaunch.seats.keys()].sort()).toEqual(['dozing', 'fresh', 'old'])
  })
})

describe('Lounge chairs', () => {
  const quiet = (ids: string[], recent = false): Chat[] => ids.map((id) => ({ id, dept: 'mob', state: 'idle', recent }))
  const reserved = (ids: string[]) => quiet(ids, true)

  it('gives chairs only to occupants, keeps each occupant in its chair, and leaves a chair empty when someone leaves', () => {
    const first = step(noSeating, reserved(['a', 'b', 'c']))
    expect(first.lounge).toBe(3)
    const gap = step(first, set(reserved(['a', 'b', 'c']), 'b', { state: 'working' }))
    expect(gap).toMatchObject({ repack: false, lounge: 3 })
    expect(gap.seats.has('b')).toBe(false)
    for (const id of ['a', 'c']) expect(gap.seats.get(id)).toBe(first.seats.get(id))
  })

  it('lets an arriving agent take a free chair, and grows the Lounge by one chair when every chair is taken', () => {
    const first = step(noSeating, reserved(['a', 'b', 'c']))
    const gap = step(first, set(reserved(['a', 'b', 'c']), 'b', { state: 'working' }))
    const filled = step(gap, [...set(reserved(['a', 'b', 'c']), 'b', { state: 'working' }), ...quiet(['d'])])
    expect(filled.seats.get('d')).toBe(first.seats.get('b'))
    expect(filled.repack).toBe(false)
    const grown = step(filled, [...reserved(['a', 'b', 'c']), ...quiet(['d'])])
    expect(grown).toMatchObject({ repack: true, lounge: 4 })
    for (const id of ['a', 'c', 'd']) expect(grown.seats.get(id)).toBe(filled.seats.get(id))
  })

  it('grows at once while held, and drops empty chairs only at the next desk re-pack', () => {
    const first = step(noSeating, quiet(['a', 'b', 'c']))
    const held = step(first, quiet(['a', 'b', 'c', 'd']), false)
    expect(held).toMatchObject({ repack: true, lounge: 4 })
    const empty = step(held, without(quiet(['a', 'b', 'c', 'd']), 'a', 'b'))
    expect(empty).toMatchObject({ repack: false, lounge: 4 })
    const repacked = step(empty, [...without(quiet(['a', 'b', 'c', 'd']), 'a', 'b'), newcomer])
    expect(repacked).toMatchObject({ repack: true, lounge: 2 })
    expect([...repacked.seats.values()].sort()).toEqual([0, 1])
  })
})
