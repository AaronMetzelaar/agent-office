export const deptIds = ['mkt', 'adm', 'mob', 'plat', 'side', 'gym'] as const
export type DeptId = (typeof deptIds)[number]
export type SlotKind = 'desk' | 'gym'

export interface DeptDef {
  id: DeptId
  name: string
  path: string
  accent: number
  row: 'n' | 's' | 'g'
  box: readonly [number, number, number, number]
  sign: readonly [number, number]
  slots: readonly (readonly [number, number])[]
  growRows: readonly number[]
  pitch: number
}

export const ZF = 12.9
export const ZL = ZF + 8.5
export const ZC = (ZF - 8.5) / 2
export const MZ = -0.45
export const FZ = 8.2
const AX0 = -5.1
const AX1 = -4.1
const gap = 1

export const depts: readonly DeptDef[] = [
  { id: 'mkt', name: 'Marketplace', path: 'monorepo/frontend/marketplace', accent: 0x1b34ff, row: 'n', box: [-13.5, -8.5, AX0, MZ], sign: [-13.25, MZ], slots: [[-10.9, -5.5], [-7.1, -5.5], [-10.9, -2.9], [-7.1, -2.9]], growRows: [-5.5, -2.9], pitch: 3.8 },
  { id: 'adm', name: 'Admin', path: 'monorepo/frontend/admin', accent: 0xdb2777, row: 'n', box: [AX1, -8.5, AX1 + 3.8, MZ], sign: [AX1 + 0.25, MZ], slots: [[AX1 + 1.4, -5.5], [AX1 + 1.4, -2.9]], growRows: [-5.5, -2.9], pitch: 3.8 },
  { id: 'mob', name: 'Mobile', path: 'monorepo/frontend/mobile', accent: 0x16a34a, row: 'n', box: [AX1, -8.5, 4.5, MZ], sign: [AX1 + 0.25, MZ], slots: [[-2.3, -5.5], [1.5, -5.5], [-2.3, -2.9]], growRows: [-5.5, -2.9], pitch: 3.8 },
  { id: 'plat', name: 'Backend / infra', path: 'services · api · workers · infra', accent: 0x7c3aed, row: 's', box: [-13.5, MZ, AX0, FZ], sign: [-13.25, FZ], slots: [[-10.9, 2.7], [-7.1, 2.7], [-10.9, 5.4]], growRows: [2.7, 5.4], pitch: 3.8 },
  { id: 'side', name: 'Side projects', path: '~/Documents/GitHub', accent: 0xea580c, row: 's', box: [AX1, MZ, 4.5, FZ], sign: [AX1 + 0.25, FZ], slots: [[-2.3, 2.7], [1.5, 2.7], [-2.3, 5.4], [1.5, 5.4]], growRows: [2.7, 5.4], pitch: 3.8 },
  { id: 'gym', name: 'Research gym', path: 'research account', accent: 0x0d9488, row: 'g', box: [4.5, -8.5, 13.5, 8.5], sign: [6.55, 8.5], slots: [[6.1, -6.1], [8.1, -6.1], [10.1, -6.1], [12.1, -6.1]], growRows: [-6.1], pitch: 2 },
]

export const dept = Object.fromEntries(depts.map((d) => [d.id, d])) as Record<DeptId, DeptDef>
export const kindOf = (id: DeptId): SlotKind => (id === 'gym' ? 'gym' : 'desk')
export const isDeptId = (value: unknown): value is DeptId => deptIds.includes(value as DeptId)

export type Demand = Partial<Record<DeptId, number>>

export function columnsFor(id: DeptId, desks: number): number {
  const d = dept[id]
  return Math.max(0, Math.ceil((desks - d.slots.length) / d.growRows.length))
}

export const capacityOf = (id: DeptId, desks: number) => dept[id].slots.length + columnsFor(id, desks) * dept[id].growRows.length

export function baseSlots(id: DeptId, desks: number): [number, number][] {
  const d = dept[id]
  const slots = d.slots.map(([x, z]) => [x, z] as [number, number])
  for (let c = 0; c < columnsFor(id, desks); c++) for (const z of d.growRows) slots.push([d.box[2] + d.pitch * (c + 0.5), z])
  return slots
}

export const widthOf = (id: DeptId, desks: number) => dept[id].box[2] - dept[id].box[0] + columnsFor(id, desks) * dept[id].pitch

export interface Zone {
  id: DeptId
  shown: boolean
  ox: number
  width: number
  box: [number, number, number, number]
  slots: [number, number][]
}

export interface Floor {
  zones: Record<DeptId, Zone>
  right: number
}

const rows = { n: ['mkt', 'adm', 'mob'], s: ['plat', 'side'] } as const satisfies Record<string, readonly DeptId[]>

export function layoutFloor(demand: Demand, prevOx: Partial<Record<DeptId, number>> = {}): Floor {
  const ox: Partial<Record<DeptId, number>> = {}
  const shown = (id: DeptId) => (demand[id] ?? 0) > 0
  const ends: number[] = []
  for (const row of Object.values(rows)) {
    let x = -13.5
    for (const id of row) {
      if (!shown(id)) continue
      ox[id] = x - dept[id].box[0]
      x += widthOf(id, demand[id]!) + gap
    }
    ends.push(x - gap)
  }
  const gx = Math.max(...ends, 4.5)
  if (shown('gym')) ox.gym = gx - dept.gym.box[0]
  const right = shown('gym') ? gx + widthOf('gym', demand.gym!) : gx
  const zones = {} as Record<DeptId, Zone>
  for (const d of depts) {
    const desks = demand[d.id] ?? 0
    const offset = ox[d.id] ?? prevOx[d.id] ?? 0
    const width = widthOf(d.id, desks)
    zones[d.id] = {
      id: d.id,
      shown: shown(d.id),
      ox: offset,
      width,
      box: [d.box[0] + offset, d.box[1], d.box[0] + offset + width, d.box[3]],
      slots: baseSlots(d.id, desks).map(([x, z]) => [x + offset, z]),
    }
  }
  return { zones, right }
}

const footprint = (id: DeptId, desks: number) => (desks > 0 ? columnsFor(id, desks) : -1)

export function settle(current: Demand, wanted: Demand, canFold: boolean): { demand: Demand; pending: boolean } {
  const demand: Demand = {}
  let pending = false
  for (const { id } of depts) {
    const now = current[id] ?? 0
    const want = wanted[id] ?? 0
    const keep = footprint(id, want) < footprint(id, now) && !canFold
    demand[id] = keep ? Math.max(now, want) : want
    pending ||= keep
  }
  return { demand, pending }
}

export function assignDesks(prev: ReadonlyMap<string, number>, agents: readonly { id: string; dept: DeptId }[], capacity: (id: DeptId) => number): Map<string, number> {
  const taken = new Map<DeptId, Set<number>>(deptIds.map((id) => [id, new Set()]))
  const out = new Map<string, number>()
  const later: { id: string; dept: DeptId }[] = []
  for (const agent of agents) {
    const slot = prev.get(agent.id)
    const used = taken.get(agent.dept)!
    if (slot !== undefined && slot < capacity(agent.dept) && !used.has(slot)) {
      used.add(slot)
      out.set(agent.id, slot)
    } else later.push(agent)
  }
  for (const agent of later) {
    const used = taken.get(agent.dept)!
    let slot = 0
    while (used.has(slot)) slot++
    used.add(slot)
    out.set(agent.id, slot)
  }
  return out
}

export function anchorsFor(kind: SlotKind, x: number, z: number) {
  return kind === 'gym'
    ? { seat: [x, z - 0.1] as const, stand: [x + 1, z + 0.8] as const, chip: [x, 1.25, z - 0.1] as const }
    : { seat: [x, z - 0.68] as const, stand: [x + 1.14, z + 0.02] as const, chip: [x, 1.05, z - 0.68] as const }
}

export const gymBench = (i: number) => [6.15 + i * 0.7, -3.0] as const
export const gymRelax = (i: number) => [11.9 - i * 0.62, 2.5] as const
export const benchSeats = 4

export const office = { x0: -3.3, x1: 3.1, z0: 9.4, z1: 12.6, h: 2.3, d0: 10.85, d1: 11.95 }
export const queueZ = 11.4
export const queueSpots = [-4.3, -5.7, -7.1, -8.5, -9.9].map((x) => [x, queueZ] as const)
export const door = [-12.2, 12.75] as const
export const lounge = Array.from({ length: 16 }, (_, i) => [-10.6 + (i % 8) * 0.75, 9.3 + Math.floor(i / 8) * 0.9] as const)
export const parkedZone = { name: 'Parked', sign: [-13.25, 10.9] as const, box: [-13.4, 8.6, -5.4, 10.9] as const }
