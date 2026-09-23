import { describe, expect, it } from 'vitest'
import { assignDesks, capacityOf, deptIds, layoutFloor, settle, type Demand, type DeptId } from '../../src/renderer/office/layout'

const shownOrder = (demand: Demand) => {
  const { zones } = layoutFloor(demand)
  return deptIds.filter((id) => zones[id].shown)
}

const overlap = (a: number[], b: number[]) => a[0]! < b[2]! && b[0]! < a[2]! && a[1]! < b[3]! && b[1]! < a[3]!

describe('adaptive floor', () => {
  const everyone: Demand = { mkt: 3, adm: 1, mob: 2, plat: 2, side: 3, gym: 2 }

  it('shows only departments with active agents, packed in the fixed order', () => {
    const { zones } = layoutFloor({ mkt: 3, mob: 2, plat: 1, side: 2, gym: 1 })
    expect(zones.adm.shown).toBe(false)
    expect(zones.mob.box[0]).toBeCloseTo(zones.mkt.box[2] + 1)
    expect(zones.side.box[0]).toBeCloseTo(zones.plat.box[2] + 1)
    expect(zones.gym.box[0]).toBeCloseTo(Math.max(zones.mob.box[2], zones.side.box[2]))
  })

  it('folds Admin away when its last agent is parked, and brings it back before a new agent walks in', () => {
    const withAdmin = layoutFloor(everyone)
    const current: Demand = everyone
    const folded = settle(current, { ...everyone, adm: 0 }, true).demand
    const without = layoutFloor(folded)
    expect(without.zones.adm.shown).toBe(false)
    expect(shownOrder(folded)).toEqual(['mkt', 'mob', 'plat', 'side', 'gym'])
    expect(without.zones.mob.box[0]).toBeLessThan(withAdmin.zones.mob.box[0])
    expect(without.right).toBeLessThan(withAdmin.right)

    const back = settle(folded, { ...folded, adm: 1 }, false)
    expect(back.pending).toBe(false)
    expect(layoutFloor(back.demand).zones.adm.shown).toBe(true)
    expect(shownOrder(back.demand)).toEqual(['mkt', 'adm', 'mob', 'plat', 'side', 'gym'])
  })

  it('waits to fold while hovered or zoomed in, then folds once it may', () => {
    const hovering = settle(everyone, { ...everyone, adm: 0 }, false)
    expect(hovering.pending).toBe(true)
    expect(layoutFloor(hovering.demand).zones.adm.shown).toBe(true)
    const released = settle(hovering.demand, { ...everyone, adm: 0 }, true)
    expect(released.pending).toBe(false)
    expect(layoutFloor(released.demand).zones.adm.shown).toBe(false)
  })

  it('does not treat a count change inside the same footprint as a pending re-layout', () => {
    expect(settle({ mkt: 3 }, { mkt: 2 }, false)).toEqual({ demand: expect.objectContaining({ mkt: 2 }), pending: false })
  })
})

describe('department growth', () => {
  it('grows a full department by a desk column and pushes its neighbours along without overlap', () => {
    const base = layoutFloor({ mkt: 4, adm: 1, mob: 2, gym: 1 })
    const grown = layoutFloor({ mkt: 5, adm: 1, mob: 2, gym: 1 })
    expect(grown.zones.mkt.slots).toHaveLength(capacityOf('mkt', 5))
    expect(grown.zones.mkt.width).toBeGreaterThan(base.zones.mkt.width)
    expect(grown.zones.adm.box[0]).toBeCloseTo(grown.zones.mkt.box[2] + 1)
    expect(grown.zones.mob.box[0]).toBeGreaterThan(base.zones.mob.box[0])
    expect(grown.right).toBeGreaterThan(base.right)
    const shown = deptIds.filter((id) => grown.zones[id].shown).map((id) => grown.zones[id].box)
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) expect(overlap(shown[i]!, shown[j]!)).toBe(false)
  })

  it('never seats two agents at one desk, even with 15 agents in one department', () => {
    const agents = Array.from({ length: 15 }, (_, i) => ({ id: `a${i}`, dept: 'mkt' as DeptId }))
    const floor = layoutFloor({ mkt: 15 })
    const desks = assignDesks(new Map(), agents, (id) => capacityOf(id, 15))
    const slots = [...desks.values()]
    expect(new Set(slots).size).toBe(15)
    const spots = slots.map((i) => floor.zones.mkt.slots[i]!.join(','))
    expect(new Set(spots).size).toBe(15)
    for (const [x, z] of slots.map((i) => floor.zones.mkt.slots[i]!)) {
      expect(x).toBeGreaterThan(floor.zones.mkt.box[0])
      expect(x).toBeLessThan(floor.zones.mkt.box[2])
      expect(z).toBeGreaterThan(floor.zones.mkt.box[1])
    }
  })

  it('keeps each agent at its desk when others come and go', () => {
    const first = assignDesks(new Map(), [{ id: 'a', dept: 'mob' }, { id: 'b', dept: 'mob' }, { id: 'c', dept: 'mob' }], (id) => capacityOf(id, 3))
    const next = assignDesks(first, [{ id: 'c', dept: 'mob' }, { id: 'd', dept: 'mob' }], (id) => capacityOf(id, 2))
    expect(next.get('c')).toBe(first.get('c'))
    expect(next.get('d')).toBe(first.get('a'))
  })
})
