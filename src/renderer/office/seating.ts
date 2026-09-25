import { deptIds, type Demand, type DeptId } from './layout'
import type { Spot } from './standby'

export interface Sitter {
  id: string
  dept: DeptId
  spot: Spot | 'smoke' | 'gone'
  parked: boolean
  recent: boolean
}

export interface Desk {
  dept: DeptId
  slot: number
}

export interface Seating {
  desks: ReadonlyMap<string, Desk>
  free: Partial<Record<DeptId, number>>
  owed: ReadonlySet<DeptId>
  seats: ReadonlyMap<string, number>
  known: ReadonlySet<string>
  size: Demand
  lounge: number
  pending: boolean
}

export const noSeating: Seating = { desks: new Map(), free: {}, owed: new Set(), seats: new Map(), known: new Set(), size: {}, lounge: 0, pending: false }

export function builtDesks(s: Pick<Seating, 'desks' | 'free'>, dept: DeptId): number[] {
  const free = s.free[dept]
  return [...[...s.desks.values()].filter((d) => d.dept === dept).map((d) => d.slot), ...(free === undefined ? [] : [free])].sort((a, b) => a - b)
}

function holds(prev: Seating, a: Sitter): boolean {
  if (a.spot === 'desk') return true
  const had = prev.desks.get(a.id)
  if (had) return had.dept === a.dept && (a.spot === 'gone' || !a.parked)
  return a.spot !== 'gone' && !a.parked && a.recent && !prev.known.has(a.id)
}

function lowestFree(used: Set<number>): number {
  let slot = 0
  while (used.has(slot)) slot++
  used.add(slot)
  return slot
}

export function reseat(prev: Seating, agents: readonly Sitter[], can: boolean, claims: ReadonlyMap<string, number> = new Map()): Seating & { repack: boolean } {
  const occupants = agents.filter((a) => a.spot === 'lounge')
  const seats = new Map<string, number>()
  const chairs = new Set<number>()
  for (const a of occupants) {
    const seat = prev.seats.get(a.id)
    if (seat !== undefined && seat < prev.lounge && !chairs.has(seat)) {
      chairs.add(seat)
      seats.set(a.id, seat)
    }
  }
  for (const a of occupants) if (!seats.has(a.id)) seats.set(a.id, lowestFree(chairs))
  let lounge = Math.max(prev.lounge, ...[...seats.values()].map((seat) => seat + 1))
  const grew = lounge > prev.lounge

  const plans = deptIds.map((dept) => {
    const kept = (a: Sitter) => (prev.desks.get(a.id)?.dept === dept ? prev.desks.get(a.id)!.slot : undefined)
    const holders = agents.filter((a) => a.dept === dept && holds(prev, a))
    const staying = new Set(holders.filter((a) => kept(a) !== undefined).map((a) => a.id))
    return {
      dept,
      holders,
      kept,
      need: holders.length > 0 || agents.some((a) => a.dept === dept && a.spot === 'cooler'),
      added: holders.filter((a) => kept(a) === undefined),
      removed: [...prev.desks].filter(([id, d]) => d.dept === dept && !staying.has(id)).map(([, d]) => d.slot),
    }
  })
  const event = can && (grew || plans.some((p) => p.added.length || p.removed.length || prev.owed.has(p.dept)))

  const desks = new Map<string, Desk>()
  const free: Seating['free'] = {}
  const owed = new Set<DeptId>()
  const size: Demand = {}
  let pending = false
  for (const { dept, holders, kept, need, added, removed } of plans) {
    const before = builtDesks(prev, dept)
    const holey = (prev.size[dept] ?? 0) > before.length
    const compact = can && (added.length > 0 || removed.length > 0 || prev.owed.has(dept) || (need && !before.length) || (event && holey))
    if (compact) {
      const present = holders.filter((a) => a.spot === 'desk' && kept(a) !== undefined)
      const used = new Set(present.map((a) => kept(a)!))
      for (const a of present) desks.set(a.id, { dept, slot: kept(a)! })
      const want = need ? Math.max(holders.length + 1, ...[...used].map((slot) => slot + 1)) : 0
      for (const a of holders.filter((a) => !desks.has(a.id))) {
        const claim = claims.get(a.id)
        desks.set(a.id, { dept, slot: claim !== undefined && claim < want && !used.has(claim) ? (used.add(claim), claim) : lowestFree(used) })
      }
      if (need) free[dept] = lowestFree(used)
    } else {
      let open = need || !can ? prev.free[dept] : undefined
      const used = new Set(open === undefined ? [] : [open])
      for (const a of holders) {
        const slot = kept(a)
        if (slot === undefined) continue
        used.add(slot)
        desks.set(a.id, { dept, slot })
      }
      for (const a of added) {
        const claim = claims.get(a.id)
        const slot = claim !== undefined && (claim === open || !used.has(claim)) ? claim : (open ?? lowestFree(used))
        if (slot === open) open = undefined
        used.add(slot)
        desks.set(a.id, { dept, slot })
      }
      if (open !== undefined) free[dept] = open
      if (!can && (added.length || removed.length || prev.owed.has(dept))) owed.add(dept)
    }
    const built = builtDesks({ desks, free }, dept)
    size[dept] = Math.max(built.length ? built.at(-1)! + 1 : 0, can ? 0 : (prev.size[dept] ?? 0))
    pending ||= owed.has(dept)
  }

  if (event) {
    ;[...seats].sort((a, b) => a[1] - b[1]).forEach(([id], i) => seats.set(id, i))
    lounge = seats.size
  }
  const known = new Set(agents.filter((a) => a.spot !== 'gone').map((a) => a.id))
  const resized = deptIds.some((d) => (size[d] ?? 0) !== (prev.size[d] ?? 0))
  return { desks, free, owed, seats, known, size, lounge, pending, repack: resized || lounge !== prev.lounge }
}
