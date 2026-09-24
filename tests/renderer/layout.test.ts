import { describe, expect, it } from 'vitest'
import { assignDesks, deptIds, depts, FZ, layoutFloor, minRight, minWidth, sectionOf, settle, tierOf, X0, ZF, type Demand, type DeptId } from '../../src/renderer/office/layout'

const shownOrder = (desks: Demand) => {
  const { zones } = layoutFloor(desks)
  return deptIds.filter((id) => zones[id].shown)
}

const overlap = (a: readonly number[], b: readonly number[]) => a[0]! < b[2]! && b[0]! < a[2]! && a[1]! < b[3]! && b[1]! < a[3]!
const agentsToDesks = (agents: Demand) => settle({}, agents, true).desks

describe('section size follows its agents', () => {
  it('gives each section its occupied desks plus one free desk, in a compact grid that grows in steps', () => {
    expect(agentsToDesks({ mkt: 1, gym: 3 })).toMatchObject({ mkt: 2, gym: 4, adm: 0 })
    const sizes = [1, 2, 3, 4, 5, 6, 7, 9, 10, 12].map((desks) => {
      const { cols, rows, w, d, tier } = sectionOf('mkt', desks)
      return { desks, cols, rows, w: +w.toFixed(1), d: +d.toFixed(1), tier }
    })
    expect(sizes).toEqual([
      { desks: 1, cols: 2, rows: 1, w: 7, d: 5.9, tier: 1 },
      { desks: 2, cols: 2, rows: 1, w: 7, d: 5.9, tier: 1 },
      { desks: 3, cols: 2, rows: 2, w: 7, d: 8.5, tier: 1 },
      { desks: 4, cols: 2, rows: 2, w: 8.4, d: 8.5, tier: 2 },
      { desks: 5, cols: 3, rows: 2, w: 11.6, d: 8.5, tier: 2 },
      { desks: 6, cols: 3, rows: 2, w: 11.6, d: 8.5, tier: 2 },
      { desks: 7, cols: 3, rows: 3, w: 11.6, d: 11.1, tier: 3 },
      { desks: 9, cols: 3, rows: 3, w: 11.6, d: 11.1, tier: 3 },
      { desks: 10, cols: 4, rows: 3, w: 14.8, d: 11.1, tier: 3 },
      { desks: 12, cols: 4, rows: 3, w: 14.8, d: 11.1, tier: 3 },
    ])
    for (let n = 1; n < 16; n++) {
      const [a, b] = [sectionOf('side', n), sectionOf('side', n + 1)]
      expect(b.w).toBeGreaterThanOrEqual(a.w)
      expect(b.d).toBeGreaterThanOrEqual(a.d)
    }
  })

  it('never moves an existing desk when the section grows, so only newcomers walk', () => {
    for (const id of ['mob', 'gym'] as DeptId[])
      for (let n = 1; n < 15; n++) expect(sectionOf(id, n + 1).slots.slice(0, n)).toEqual(sectionOf(id, n).slots)
  })

  it('keeps every desk inside its section with room between desks, and the gym on treadmills', () => {
    for (const id of deptIds)
      for (const n of [1, 2, 5, 12]) {
        const { slots, w, d } = sectionOf(id, n)
        expect(slots).toHaveLength(n)
        for (const [x, z] of slots) {
          expect(x - 0.8).toBeGreaterThan(0)
          expect(x + 1.2).toBeLessThan(w)
          expect(z - 1).toBeGreaterThan(0)
          expect(z + 1).toBeLessThan(d)
        }
        for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) expect(Math.hypot(slots[i]![0] - slots[j]![0], slots[i]![1] - slots[j]![1])).toBeGreaterThan(1.9)
      }
  })

  it('picks the props tier from the desk count, and a section never shrinks below its tier’s footprint', () => {
    expect([1, 3, 4, 6, 7, 20].map((n) => tierOf('mkt', n))).toEqual([1, 1, 2, 2, 3, 3])
    expect([0, 3, 4, 8, 9].map((n) => tierOf('gym', n))).toEqual([0, 1, 2, 2, 3])
    for (const id of deptIds)
      for (let n = 1; n < 16; n++) {
        const section = sectionOf(id, n)
        expect(section.w).toBeGreaterThanOrEqual(minWidth(id, section.tier))
      }
  })
})

describe('the building fits its sections', () => {
  it('keeps one agent in a small section and a small building', () => {
    const one = layoutFloor(agentsToDesks({ mkt: 1 }))
    expect(one.zones.mkt.box).toEqual([X0, FZ - 5.9, X0 + 7, FZ].map((v) => expect.closeTo(v, 5)))
    expect(one.bounds).toEqual({ x0: X0, z0: expect.closeTo(FZ - 5.9, 5), x1: minRight, z1: ZF })
    const busy = layoutFloor(agentsToDesks({ mkt: 9, mob: 3, plat: 5, side: 2, rev: 1, gym: 5 }))
    expect(busy.bounds.x1).toBeGreaterThan(one.bounds.x1 + 15)
    expect(busy.bounds.z0).toBeLessThan(one.bounds.z0 - 10)
  })

  it('packs the shown sections in the fixed order: Marketplace, Admin and Mobile at the back, then Backend, Side projects, PR reviews and the gym at the front', () => {
    const floor = layoutFloor(agentsToDesks({ mkt: 2, mob: 1, plat: 1, side: 2, rev: 1, gym: 2 }))
    const { mkt, mob, plat, side, rev, gym } = floor.zones
    expect(mob.box[0]).toBeCloseTo(mkt.box[2] + 1)
    expect(side.box[0]).toBeCloseTo(plat.box[2] + 1)
    expect(rev.box[0]).toBeCloseTo(side.box[2] + 1)
    expect(mkt.box[1]).toBeCloseTo(floor.bounds.z0)
    expect(rev.box[3]).toBeCloseTo(FZ)
    expect(mkt.box[3]).toBeLessThan(rev.box[1])
    expect(gym.box[0]).toBeCloseTo(rev.box[2] + 1)
    expect(gym.box[3]).toBeCloseTo(FZ)
    expect(floor.bounds.x1).toBeCloseTo(Math.max(mob.box[2], gym.box[2]))
    const boxes = deptIds.filter((id) => floor.zones[id].shown).map((id) => floor.zones[id].box)
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!, boxes[j]!)).toBe(false)
    for (const id of deptIds) for (const [x, z] of floor.zones[id].world) expect(x > floor.zones[id].box[0] && x < floor.zones[id].box[2] && z > floor.zones[id].box[1] && z < floor.zones[id].box[3]).toBe(true)
  })

  it('lists PR reviews after Side projects and before the gym', () => {
    expect(depts.map((d) => d.id)).toEqual(['mkt', 'adm', 'mob', 'plat', 'side', 'rev', 'gym'])
    expect(depts.find((d) => d.id === 'rev')?.name).toBe('PR reviews')
  })

  it('grows the back of the building for a busy gym, and keeps the front band fixed', () => {
    const floor = layoutFloor(agentsToDesks({ gym: 12 }))
    expect(floor.zones.gym.box[0]).toBe(X0)
    expect(floor.bounds.z0).toBeCloseTo(FZ - floor.zones.gym.d)
    expect(floor.bounds.z1).toBe(ZF)
  })
})

describe('folding sections', () => {
  const everyone: Demand = { mkt: 3, adm: 1, mob: 2, plat: 2, side: 3, rev: 1, gym: 2 }

  it('shows a section only while it has active agents, and closes the others up in the fixed order', () => {
    const folded = settle(agentsToDesks(everyone), { ...everyone, adm: 0, rev: 0 }, true).desks
    const without = layoutFloor(folded)
    const all = layoutFloor(agentsToDesks(everyone))
    expect(without.zones.adm.shown).toBe(false)
    expect(without.zones.rev.shown).toBe(false)
    expect(shownOrder(folded)).toEqual(['mkt', 'mob', 'plat', 'side', 'gym'])
    expect(without.zones.mob.box[0]).toBeLessThan(all.zones.mob.box[0])
    expect(without.bounds.x1).toBeLessThan(all.bounds.x1)
  })

  it('unfolds PR reviews when a review agent starts, even while zoomed in', () => {
    const before = agentsToDesks({ mkt: 1 })
    const back = settle(before, { mkt: 1, rev: 1 }, false)
    expect(back.desks.rev).toBe(1)
    expect(layoutFloor(back.desks).zones.rev.shown).toBe(true)
    expect(shownOrder(back.desks)).toEqual(['mkt', 'rev'])
    expect(back.pending).toBe(true)
    expect(settle(back.desks, { mkt: 1, rev: 1 }, true)).toEqual({ desks: expect.objectContaining({ rev: 2 }), pending: false })
  })

  it('holds every shrink and fold while hovered or zoomed in, and applies it back at the overview', () => {
    const desks = agentsToDesks(everyone)
    const hovering = settle(desks, { ...everyone, adm: 0, mkt: 1 }, false)
    expect(hovering.pending).toBe(true)
    expect(hovering.desks).toMatchObject({ adm: 2, mkt: 4 })
    expect(layoutFloor(hovering.desks).zones.adm.shown).toBe(true)
    expect(layoutFloor(hovering.desks).zones.mkt.w).toBe(layoutFloor(desks).zones.mkt.w)
    const released = settle(hovering.desks, { ...everyone, adm: 0, mkt: 1 }, true)
    expect(released).toEqual({ desks: expect.objectContaining({ adm: 0, mkt: 2 }), pending: false })
    expect(layoutFloor(released.desks).zones.adm.shown).toBe(false)
  })

  it('seats a newcomer while zoomed in without adding the next free desk until the overview', () => {
    const desks = agentsToDesks({ mob: 1 })
    const zoomed = settle(desks, { mob: 2 }, false)
    expect(zoomed.desks.mob).toBe(2)
    expect(zoomed.pending).toBe(true)
    expect(settle(zoomed.desks, { mob: 2 }, true).desks.mob).toBe(3)
  })
})

describe('desks', () => {
  it('never seats two agents at one desk, even with 15 agents in one department', () => {
    const agents = Array.from({ length: 15 }, (_, i) => ({ id: `a${i}`, dept: 'mkt' as DeptId }))
    const floor = layoutFloor({ mkt: 16 })
    const desks = assignDesks(new Map(), agents, () => 16)
    const spots = [...desks.values()].map((i) => floor.zones.mkt.world[i]!.join(','))
    expect(new Set(spots).size).toBe(15)
  })

  it('keeps each agent at its desk when others come and go', () => {
    const first = assignDesks(new Map(), [{ id: 'a', dept: 'mob' }, { id: 'b', dept: 'mob' }, { id: 'c', dept: 'mob' }], () => 4)
    const next = assignDesks(first, [{ id: 'c', dept: 'mob' }, { id: 'd', dept: 'mob' }], () => 3)
    expect(next.get('c')).toBe(first.get('c'))
    expect(next.get('d')).toBe(first.get('a'))
  })
})
