import { describe, expect, it } from 'vitest'
import type { ChatState } from '../../src/shared/chat'
import { band, bandArea, deptIds, depts, door, fitSize, fixedParts, FZ, layoutFloor, loungeGrid, loungeRowsIn, loungeSeat, loungeShape, minWidth, sectionOf, tierOf, walkway, X0, ZF, type Box, type Demand, type DeptId, type Floor } from '../../src/renderer/office/layout'
import { builtDesks, noSeating, reseat, type Sitter } from '../../src/renderer/office/seating'
import { spotFor } from '../../src/renderer/office/standby'
import { floorFixture } from '../../src/renderer/state/demo'

const inside = deptIds.filter((id) => id !== 'side')
const overlap = (a: readonly number[], b: readonly number[]) => a[0]! < b[2]! - 1e-9 && b[0]! < a[2]! - 1e-9 && a[1]! < b[3]! - 1e-9 && b[1]! < a[3]! - 1e-9
const agentsToDesks = (agents: Demand): Demand => Object.fromEntries(deptIds.map((id) => [id, agents[id] ? agents[id]! + 1 : 0]))
const shownOrder = (desks: Demand) => deptIds.filter((id) => layoutFloor(desks).zones[id].shown)
const atDesks = (agents: Demand, from = 0): Sitter[] => deptIds.flatMap((dept) => Array.from({ length: agents[dept] ?? 0 }, (_, i) => ({ id: `${dept}${i + from}`, dept, spot: 'desk' as const, parked: false, recent: true })))

function floorOf(agents: readonly { dept: DeptId; state: ChatState; parked?: boolean }[], recent: boolean) {
  const seating = reseat(noSeating, agents.map((a, i) => ({ id: `a${i}`, dept: a.dept, spot: spotFor({ ...a, parked: a.parked ?? false }, undefined, false), parked: a.parked ?? false, recent })), true)
  return { floor: layoutFloor(seating.size, seating.lounge), seating }
}

const fixture = floorOf(floorFixture.map(([dept, , state]) => ({ dept: dept as DeptId, state })), false)

function occupied(floor: Floor): Box[] {
  return [...inside.filter((id) => floor.zones[id].shown).map((id) => floor.zones[id].box), ...(floor.lounge.shown ? [floor.lounge.box] : []), ...fixedParts]
}

function largestEmptySquare(floor: Floor): number {
  const cell = 0.1
  const { x0, z0, x1, z1 } = floor.bounds
  const cols = Math.round((x1 - x0) / cell), rows = Math.round((z1 - z0) / cell)
  const boxes = occupied(floor)
  const run = new Array<number>(cols).fill(0)
  let best = 0
  for (let r = 0; r < rows; r++) {
    let diagonal = 0
    for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) * cell, z = z0 + (r + 0.5) * cell
      const empty = !boxes.some(([bx0, bz0, bx1, bz1]) => x > bx0 && x < bx1 && z > bz0 && z < bz1)
      const up = run[c]!
      run[c] = empty ? Math.min(up, c ? run[c - 1]! : 0, diagonal) + 1 : 0
      diagonal = up
      best = Math.max(best, run[c]!)
    }
  }
  return best * cell
}

const area = (b: { x0: number; z0: number; x1: number; z1: number }) => (b.x1 - b.x0) * (b.z1 - b.z0)
const loungeArea = (floor: Floor) => (floor.lounge.shown ? (loungeGrid.left + floor.lounge.cols * loungeGrid.pitchX + loungeGrid.right) * (loungeGrid.back + (floor.lounge.rows - 1) * loungeGrid.pitchZ + loungeGrid.front) : 0)
const natural = (floor: Floor) => inside.filter((id) => floor.zones[id].shown).reduce((sum, id) => sum + floor.zones[id].w * floor.zones[id].d, 0) + bandArea + loungeArea(floor)
const laidOut = (floor: Floor) => inside.filter((id) => floor.zones[id].shown).reduce((sum, id) => sum + area({ x0: floor.zones[id].box[0], z0: floor.zones[id].box[1], x1: floor.zones[id].box[2], z1: floor.zones[id].box[3] }), 0) + bandArea + (floor.lounge.shown ? area({ x0: floor.lounge.box[0], z0: floor.lounge.box[1], x1: floor.lounge.box[2], z1: floor.lounge.box[3] }) : 0)

const others: [string, Demand, number][] = [
  ['one working agent, nobody resting', { plat: 1 }, 0],
  ['two departments and a small lounge', { mkt: 2, plat: 1 }, 4],
  ['a busy day', { mkt: 3, plat: 3, mob: 1, rev: 1, gym: 2, side: 1 }, 8],
  ['every department', { mkt: 4, adm: 1, mob: 2, plat: 2, side: 2, rev: 1, gym: 3 }, 12],
  ['fifteen agents in Marketplace', { mkt: 15 }, 2],
  ['a full lounge', { gym: 1 }, 20],
]

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

  it('lays picnic tables in one row first, so a small playground stays shallow', () => {
    expect([1, 2, 3, 4].map((n) => [sectionOf('side', n).cols, sectionOf('side', n).rows])).toEqual([[2, 1], [2, 1], [3, 1], [3, 2]])
  })

  it('never moves an existing desk when the section grows, so only newcomers walk', () => {
    for (const id of ['mob', 'gym', 'side'] as DeptId[])
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

describe('packing Aaron’s floor', () => {
  it('gives desks to working, needs-you, stuck and done-unread chats, and sends the other 15 to the Lounge', () => {
    const { zones, lounge } = fixture.floor
    expect(inside.filter((id) => zones[id].shown)).toEqual(['mkt', 'plat', 'gym'])
    expect([zones.mkt.desks, zones.plat.desks, zones.gym.desks, zones.side.desks]).toEqual([2, 2, 2, 3])
    expect(lounge).toMatchObject({ shown: true, seats: 15 })
  })

  it('reserves a desk for every chat active in the last day after a relaunch', () => {
    const { zones, lounge } = floorOf(floorFixture.map(([dept, , state]) => ({ dept: dept as DeptId, state })), true).floor
    expect([zones.mkt.desks, zones.plat.desks, zones.gym.desks, zones.side.desks]).toEqual([5, 7, 9, 4])
    expect(lounge.seats).toBe(15)
  })

  it('fits the building within about 1.2× the area its sections and fixed parts need', () => {
    const { floor } = fixture
    expect(area(floor.bounds) / natural(floor)).toBeLessThan(1.22)
    expect(area(floor.bounds)).toBeLessThan(265)
  })

  it('leaves no empty floor bigger than a walkway', () => {
    expect(largestEmptySquare(fixture.floor)).toBeLessThanOrEqual(walkway + 0.05)
  })

  it('keeps sections, the Lounge and the fixed front from overlapping', () => {
    const boxes = occupied(fixture.floor)
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!, boxes[j]!), `${i}/${j}`).toBe(false)
  })

  it('puts Side projects outside the building by the entrance, and frames both about as tightly as the building alone', () => {
    const { floor } = fixture
    const yard = floor.zones.side.box
    expect(overlap(yard, [floor.bounds.x0, floor.bounds.z0, floor.bounds.x1, floor.bounds.z1])).toBe(false)
    const dx = Math.max(yard[0] - door[0], 0, door[0] - yard[2]), dz = Math.max(yard[1] - door[1], 0, door[1] - yard[3])
    expect(Math.hypot(dx, dz)).toBeLessThan(1)
    expect(fitSize(floor.frame)).toBeLessThanOrEqual(fitSize(floor.bounds) * 1.05)
  })
})

describe('packing other floors', () => {
  it.each(others)('%s: leaves no empty floor bigger than a walkway and no overlaps', (_name, desks, standby) => {
    const floor = layoutFloor(agentsToDesks(desks), standby)
    expect(largestEmptySquare(floor)).toBeLessThanOrEqual(walkway + 0.05)
    const boxes = occupied(floor)
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!, boxes[j]!)).toBe(false)
  })

  it.each(others)('%s: keeps walkways to about a fifth of the floor', (_name, desks, standby) => {
    const floor = layoutFloor(agentsToDesks(desks), standby)
    expect(area(floor.bounds) / laidOut(floor)).toBeLessThan(1.25)
  })

  it('packs a big single department within 1.2× its natural area', () => {
    const floor = layoutFloor(agentsToDesks({ mkt: 15 }), 2)
    expect(area(floor.bounds) / natural(floor)).toBeLessThan(1.2)
  })

  it.each(others)('%s: keeps the playground outside and the combined view compact', (_name, desks, standby) => {
    const floor = layoutFloor(agentsToDesks(desks), standby)
    if (floor.zones.side.shown) expect(overlap(floor.zones.side.box, [floor.bounds.x0, floor.bounds.z0, floor.bounds.x1, floor.bounds.z1])).toBe(false)
    expect(fitSize(floor.frame)).toBeLessThanOrEqual(fitSize(floor.bounds) * 1.35)
  })

  it('packs the shown sections in the fixed reading order: rows back to front, left to right', () => {
    for (const [, desks, standby] of others) {
      const { zones } = layoutFloor(agentsToDesks(desks), standby)
      const shown = inside.filter((id) => zones[id].shown)
      for (let i = 1; i < shown.length; i++) {
        const [a, b] = [zones[shown[i - 1]!].box, zones[shown[i]!].box]
        expect(b[1] > a[1] + 1e-9 || (Math.abs(b[1] - a[1]) < 1e-9 && b[0] > a[0])).toBe(true)
      }
    }
  })

  it('keeps the left wall, the front edge and the glass office where they are', () => {
    for (const [, desks, standby] of others) {
      const { bounds } = layoutFloor(agentsToDesks(desks), standby)
      expect(bounds.x0).toBe(X0)
      expect(bounds.z1).toBe(ZF)
      expect(bounds.x1).toBeGreaterThanOrEqual(band.x1 - 1e-9)
      expect(bounds.z0).toBeLessThanOrEqual(FZ)
    }
  })
})

describe('the Lounge', () => {
  it('gives every occupant its own seat, never overlapping, for 0 to 20 occupants', () => {
    for (const depth of [ZF - band.z0, 5.9, 8.5, 11.1]) {
      const rows = loungeRowsIn(depth)
      for (let n = 0; n <= 20; n++) {
        const shape = loungeShape(n, depth)
        const seats = Array.from({ length: n }, (_, i) => loungeSeat(i, rows))
        expect(shape.d).toBeLessThanOrEqual(depth + 1e-9)
        for (const [x, z] of seats) {
          expect(x - 0.4).toBeGreaterThan(0)
          expect(x + 0.4).toBeLessThan(shape.w)
          expect(z - 0.35).toBeGreaterThan(0)
          expect(z + 0.35).toBeLessThan(shape.d)
        }
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(Math.hypot(seats[i]![0] - seats[j]![0], seats[i]![1] - seats[j]![1])).toBeGreaterThanOrEqual(0.95)
      }
    }
  })

  it('places every seat inside the Lounge on the packed floor, clear of sections and the front', () => {
    for (let n = 0; n <= 20; n++) {
      const floor = layoutFloor(agentsToDesks({ mkt: 1, gym: 1 }), n)
      expect(floor.lounge.world).toHaveLength(n)
      expect(floor.lounge.shown).toBe(n > 0)
      const others = occupied(floor).filter((box) => box !== floor.lounge.box)
      for (const [x, z] of floor.lounge.world) {
        const [x0, z0, x1, z1] = floor.lounge.box
        expect(x > x0 && x < x1 && z > z0 && z < z1).toBe(true)
        expect(others.some(([bx0, bz0, bx1, bz1]) => x > bx0 && x < bx1 && z > bz0 && z < bz1)).toBe(false)
      }
    }
  })

  it('never moves a seated agent when the Lounge fills up', () => {
    const resting = (ids: string[]): Sitter[] => ids.map((id) => ({ id, dept: 'mob', spot: 'lounge', parked: false, recent: false }))
    const first = reseat(noSeating, resting(['a', 'b', 'c']), true)
    const next = reseat(first, resting(['a', 'b', 'c', 'd']), true)
    for (const id of ['a', 'b', 'c']) expect(next.seats.get(id)).toBe(first.seats.get(id))
    expect(new Set(next.seats.values()).size).toBe(4)
  })

  it('hides when nobody is resting', () => {
    expect(layoutFloor(agentsToDesks({ mkt: 1 }), 0).lounge.shown).toBe(false)
  })
})

describe('folding sections', () => {
  const everyone: Demand = { mkt: 3, adm: 1, mob: 2, plat: 2, side: 3, rev: 1, gym: 2 }

  it('shows a section only while it holds desks, and keeps the rest in the fixed order', () => {
    const all = reseat(noSeating, atDesks(everyone), true)
    const folded = reseat(all, atDesks({ ...everyone, adm: 0, rev: 0 }), true)
    const without = layoutFloor(folded.size)
    expect(without.zones.adm.shown).toBe(false)
    expect(without.zones.rev.shown).toBe(false)
    expect(shownOrder(folded.size)).toEqual(['mkt', 'mob', 'plat', 'side', 'gym'])
  })

  it('shows the gym for a done agent at the water cooler, with one free treadmill', () => {
    expect(reseat(noSeating, [{ id: 'g', dept: 'gym', spot: 'cooler', parked: false, recent: false }], true).size.gym).toBe(1)
  })

  it('unfolds PR reviews when a review agent starts, even while zoomed in', () => {
    const before = reseat(noSeating, atDesks({ mkt: 1 }), true)
    const back = reseat(before, atDesks({ mkt: 1, rev: 1 }), false)
    expect(back.size.rev).toBe(1)
    expect(layoutFloor(back.size).zones.rev.shown).toBe(true)
    expect(shownOrder(back.size)).toEqual(['mkt', 'rev'])
    expect(back.pending).toBe(true)
    expect(reseat(back, atDesks({ mkt: 1, rev: 1 }), true)).toMatchObject({ size: expect.objectContaining({ rev: 2 }), pending: false })
  })

  it('holds every shrink and fold while hovered or zoomed in, and applies it back at the overview', () => {
    const all = reseat(noSeating, atDesks(everyone), true)
    const hovering = reseat(all, atDesks({ ...everyone, adm: 0, mkt: 1 }), false)
    expect(hovering.pending).toBe(true)
    expect(hovering.size).toMatchObject({ adm: 2, mkt: 4 })
    expect(layoutFloor(hovering.size).zones.adm.shown).toBe(true)
    expect(layoutFloor(hovering.size).zones.mkt.w).toBe(layoutFloor(all.size).zones.mkt.w)
    const released = reseat(hovering, atDesks({ ...everyone, adm: 0, mkt: 1 }), true)
    expect(released).toMatchObject({ size: expect.objectContaining({ adm: 0 }), pending: false })
    expect(builtDesks(released, 'mkt')).toEqual([0, 1])
    expect(layoutFloor(released.size).zones.adm.shown).toBe(false)
    const next = reseat(released, [...atDesks({ ...everyone, adm: 0, mkt: 1 }), { id: 'late', dept: 'plat', spot: 'desk', parked: false, recent: true }], true)
    expect(next.size.mkt).toBe(2)
    expect(builtDesks(next, 'mkt')).toEqual([0, 1])
  })

  it('seats a newcomer while zoomed in without adding the next free desk until the overview', () => {
    const one = reseat(noSeating, atDesks({ mob: 1 }), true)
    const zoomed = reseat(one, atDesks({ mob: 2 }), false)
    expect(zoomed.size.mob).toBe(2)
    expect(zoomed.pending).toBe(true)
    expect(reseat(zoomed, atDesks({ mob: 2 }), true).size.mob).toBe(3)
  })

  it('lists PR reviews after Side projects and before the gym', () => {
    expect(depts.map((d) => d.id)).toEqual(['mkt', 'adm', 'mob', 'plat', 'side', 'rev', 'gym'])
    expect(depts.find((d) => d.id === 'rev')?.name).toBe('PR reviews')
  })
})

describe('desks', () => {
  it('never seats two agents at one desk, even with 15 agents in one department', () => {
    const seating = reseat(noSeating, atDesks({ mkt: 15 }), true)
    const floor = layoutFloor(seating.size)
    const spots = [...seating.desks.values()].map((d) => floor.zones.mkt.world[d.slot]!.join(','))
    expect(new Set(spots).size).toBe(15)
  })

  it('keeps each agent at its desk when others come and go', () => {
    const at = (ids: string[]): Sitter[] => ids.map((id) => ({ id, dept: 'mob', spot: 'desk', parked: false, recent: true }))
    const first = reseat(noSeating, at(['a', 'b', 'c']), true)
    const next = reseat(first, at(['c', 'd']), true)
    expect(next.desks.get('c')).toEqual(first.desks.get('c'))
    expect(next.desks.get('d')).toEqual(first.desks.get('a'))
  })
})
