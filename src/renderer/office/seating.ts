import { deptIds, type Demand, type DeptId } from './layout'
import type { Spot } from './standby'

export interface Sitter {
  id: string
  dept: DeptId
  spot: Spot | 'gone'
  parked: boolean
  recent: boolean
}

export interface Desk {
  dept: DeptId
  slot: number
}

export interface Seating {
  desks: ReadonlyMap<string, Desk>
  seats: ReadonlyMap<string, number>
  size: Demand
  want: Demand
  lounge: number
  pending: boolean
}

export const noSeating: Seating = { desks: new Map(), seats: new Map(), size: {}, want: {}, lounge: 0, pending: false }

function holds(prev: Seating, a: Sitter): boolean {
  if (a.spot === 'desk') return true
  const had = prev.desks.get(a.id)
  if (had) return had.dept === a.dept && (a.spot === 'gone' || !a.parked)
  return a.spot !== 'gone' && !a.parked && a.recent && !prev.seats.has(a.id)
}

function lowestFree(used: Set<number>): number {
  let slot = 0
  while (used.has(slot)) slot++
  used.add(slot)
  return slot
}

export function reseat(prev: Seating, agents: readonly Sitter[], can: boolean, claims: ReadonlyMap<string, number> = new Map()): Seating & { repack: boolean } {
  const desks = new Map<string, Desk>()
  const size: Demand = {}
  const want: Demand = {}
  let pending = false
  for (const dept of deptIds) {
    const holders = agents.filter((a) => a.dept === dept && holds(prev, a))
    const cooler = agents.some((a) => a.dept === dept && a.spot === 'cooler')
    const base = holders.length || cooler ? holders.length + 1 : 0
    const kept = (a: Sitter) => (prev.desks.get(a.id)?.dept === dept ? prev.desks.get(a.id)!.slot : undefined)
    const same = holders.length === [...prev.desks.values()].filter((d) => d.dept === dept).length && holders.every((a) => kept(a) !== undefined)
    const present = holders.filter((a) => a.spot === 'desk').map((a) => (kept(a) ?? -1) + 1)
    want[dept] = Math.max(same && !(holders.length === 0 && base !== (prev.want[dept] ?? 0)) ? (prev.want[dept] ?? 0) : base, ...present)
    size[dept] = can ? want[dept] : Math.max(prev.size[dept] ?? 0, holders.length, cooler ? 1 : 0, ...present)
    pending ||= size[dept] !== want[dept]
    const used = new Set<number>()
    const later: Sitter[] = []
    for (const a of [...holders].sort((a, b) => Number(b.spot === 'desk') - Number(a.spot === 'desk'))) {
      const slot = kept(a)
      if (slot !== undefined && slot < size[dept]! && !used.has(slot)) {
        used.add(slot)
        desks.set(a.id, { dept, slot })
      } else later.push(a)
    }
    for (const a of later) {
      const claim = claims.get(a.id)
      const slot = claim !== undefined && claim < size[dept]! && !used.has(claim) ? (used.add(claim), claim) : lowestFree(used)
      desks.set(a.id, { dept, slot })
    }
  }
  const members = agents.filter((a) => a.spot !== 'gone')
  const seats = new Map<string, number>()
  const taken = new Set<number>()
  for (const a of members) {
    const seat = prev.seats.get(a.id)
    if (seat !== undefined && !taken.has(seat)) {
      taken.add(seat)
      seats.set(a.id, seat)
    }
  }
  for (const a of members) if (!seats.has(a.id)) seats.set(a.id, lowestFree(taken))
  const needed = Math.max(0, ...seats.values()) + (seats.size ? 1 : 0)
  const resized = deptIds.some((d) => (size[d] ?? 0) !== (prev.size[d] ?? 0))
  let lounge = Math.max(prev.lounge, needed)
  if (can && (resized || lounge !== prev.lounge)) {
    ;[...seats].sort((a, b) => a[1] - b[1]).forEach(([id], i) => seats.set(id, i))
    lounge = seats.size
  }
  return { desks, seats, size, want, lounge, pending, repack: resized || lounge !== prev.lounge }
}
