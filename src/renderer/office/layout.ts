import { deptIds, deptNames, type DeptId } from '../../shared/office'

export { deptIds, isDeptId, type DeptId } from '../../shared/office'
export type SlotKind = 'desk' | 'gym'
export type Tier = 0 | 1 | 2 | 3

export interface DeptDef {
  id: DeptId
  name: string
  path: string
  accent: number
  row: 'n' | 's' | 'g'
}

export const X0 = -13.5
export const FZ = 7.9
export const ZF = 12.9
export const minRight = 4.5
const gap = 1
const aisle = 1.2
const minDepth = 3

export const depts: readonly DeptDef[] = [
  { id: 'mkt', name: deptNames.mkt, path: 'monorepo/frontend/marketplace', accent: 0x1b34ff, row: 'n' },
  { id: 'adm', name: deptNames.adm, path: 'monorepo/frontend/admin', accent: 0xdb2777, row: 'n' },
  { id: 'mob', name: deptNames.mob, path: 'monorepo/frontend/mobile', accent: 0x16a34a, row: 'n' },
  { id: 'plat', name: deptNames.plat, path: 'services · api · workers · infra', accent: 0x7c3aed, row: 's' },
  { id: 'side', name: deptNames.side, path: '~/Documents/GitHub', accent: 0xea580c, row: 's' },
  { id: 'rev', name: deptNames.rev, path: 'your review requests', accent: 0x854d0e, row: 's' },
  { id: 'gym', name: deptNames.gym, path: 'research account', accent: 0x0d9488, row: 'g' },
]

export const dept = Object.fromEntries(depts.map((d) => [d.id, d])) as Record<DeptId, DeptDef>
export const kindOf = (id: DeptId): SlotKind => (id === 'gym' ? 'gym' : 'desk')

export const deskGrid = { cw: 3.2, cd: 2.6, left: 0.3, right: 0.3, back: 2, front: 1.3, side: 1.4 }
export const gymGrid = { cw: 2, cd: 2.4, left: 0.6, right: 1.2, back: 1.2, bench: 1.3, relax: 1.5, front: 0.5 }

export type Demand = Partial<Record<DeptId, number>>

export function tierOf(id: DeptId, desks: number): Tier {
  if (desks <= 0) return 0
  if (id === 'gym') return desks <= 3 ? 1 : desks <= 8 ? 2 : 3
  return desks <= 3 ? 1 : desks <= 6 ? 2 : 3
}

export function gridOf(id: DeptId, desks: number): { cols: number; rows: number } {
  if (id === 'gym') {
    if (desks <= 3) return { cols: 3, rows: 1 }
    return desks <= 8 ? { cols: desks <= 6 ? 3 : 4, rows: 2 } : { cols: Math.max(4, Math.ceil(desks / 3)), rows: 3 }
  }
  if (desks <= 4) return { cols: 2, rows: desks <= 2 ? 1 : 2 }
  return desks <= 6 ? { cols: 3, rows: 2 } : { cols: Math.max(3, Math.ceil(desks / 3)), rows: 3 }
}

function cellOrder(id: DeptId, desks: number): [number, number][] {
  const cells: [number, number][] = []
  const seen = new Set<string>()
  for (let n = 1; cells.length < desks; n++) {
    const { cols, rows } = gridOf(id, n)
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (seen.has(`${c},${r}`)) continue
        seen.add(`${c},${r}`)
        cells.push([c, r])
      }
  }
  return cells.slice(0, desks)
}

export interface Section {
  tier: Tier
  cols: number
  rows: number
  w: number
  d: number
  slots: [number, number][]
}

export function sectionOf(id: DeptId, desks: number): Section {
  const tier = tierOf(id, desks)
  const { cols, rows } = gridOf(id, Math.max(1, desks))
  if (id === 'gym') {
    const g = gymGrid
    return {
      tier, cols, rows,
      w: g.left + cols * g.cw + g.right,
      d: g.back + rows * g.cd + g.bench + g.relax + g.front,
      slots: cellOrder(id, desks).map(([c, r]) => [g.left + g.cw * (c + 0.5), g.back + g.cd * (r + 0.5)]),
    }
  }
  const g = deskGrid
  return {
    tier, cols, rows,
    w: g.left + cols * g.cw + (tier >= 2 ? g.side : 0) + g.right,
    d: g.back + rows * g.cd + g.front,
    slots: cellOrder(id, desks).map(([c, r]) => [g.left + g.cw * (c + 0.5), g.back + g.cd * (r + 0.5)]),
  }
}

export const minWidth = (id: DeptId, tier: Tier) => sectionOf(id, id === 'gym' ? [0, 1, 4, 9][tier]! : [0, 2, 4, 7][tier]!).w

export const gymBenchZ = (rows: number) => gymGrid.back + rows * gymGrid.cd + gymGrid.bench / 2
export const gymRelaxZ = (rows: number) => gymGrid.back + rows * gymGrid.cd + gymGrid.bench + gymGrid.relax / 2
export const gymBench = (i: number, rows: number) => [gymGrid.left + 0.35 + i * 0.7, gymBenchZ(rows)] as const
export const gymRelax = (i: number, w: number, rows: number) => [w - 1.1 - i * 0.62, gymRelaxZ(rows)] as const
export const benchSeats = 4

export interface Bounds {
  x0: number
  z0: number
  x1: number
  z1: number
}

export interface Zone extends Section {
  id: DeptId
  shown: boolean
  desks: number
  box: [number, number, number, number]
  world: [number, number][]
}

export interface Floor {
  zones: Record<DeptId, Zone>
  bounds: Bounds
}

const rows = { n: ['mkt', 'adm', 'mob'], s: ['plat', 'side', 'rev', 'gym'] } as const satisfies Record<string, readonly DeptId[]>

export function layoutFloor(desks: Demand, prev?: Floor): Floor {
  const count = (id: DeptId) => Math.max(0, desks[id] ?? 0)
  const sections = Object.fromEntries(deptIds.map((id) => [id, sectionOf(id, count(id))])) as Record<DeptId, Section>
  const shown = (id: DeptId) => count(id) > 0
  const depth = (ids: readonly DeptId[]) => Math.max(0, ...ids.filter(shown).map((id) => sections[id].d))
  const dN = depth(rows.n), dS = depth(rows.s)
  const z0 = FZ - Math.max(minDepth, dN + dS + (dN && dS ? aisle : 0))
  const boxes: Partial<Record<DeptId, [number, number, number, number]>> = {}
  const ends: number[] = []
  for (const [row, ids] of Object.entries(rows)) {
    let x = X0
    for (const id of ids) {
      if (!shown(id)) continue
      boxes[id] = row === 'n' ? [x, z0, x + sections[id].w, z0 + dN] : [x, FZ - dS, x + sections[id].w, FZ]
      x += sections[id].w + gap
    }
    if (x > X0) ends.push(x - gap)
  }
  const zones = {} as Record<DeptId, Zone>
  for (const { id } of depts) {
    const box = boxes[id] ?? prev?.zones[id].box ?? [X0, z0, X0 + sections[id].w, z0 + sections[id].d]
    zones[id] = { id, ...sections[id], shown: shown(id), desks: count(id), box, world: sections[id].slots.map(([x, z]) => [box[0] + x, box[1] + z]) }
  }
  return { zones, bounds: { x0: X0, z0, x1: Math.max(minRight, ...ends), z1: ZF } }
}

export function settle(current: Demand, agents: Demand, canRelayout: boolean): { desks: Demand; pending: boolean } {
  const desks: Demand = {}
  let pending = false
  for (const { id } of depts) {
    const seated = agents[id] ?? 0
    const want = seated > 0 ? seated + 1 : 0
    desks[id] = canRelayout ? want : Math.max(current[id] ?? 0, seated)
    pending ||= desks[id] !== want
  }
  return { desks, pending }
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

export const office = { x0: -3.3, x1: 3.1, z0: 9.4, z1: 12.6, h: 2.3, d0: 10.85, d1: 11.95 }
export const queueZ = 11.4
export const queueSpots = [-4.3, -5.7, -7.1, -8.5, -9.9].map((x) => [x, queueZ] as const)
export const door = [-12.2, 12.75] as const
export const lounge = Array.from({ length: 16 }, (_, i) => [-10.6 + (i % 8) * 0.75, 9.3 + Math.floor(i / 8) * 0.9] as const)
export const parkedZone = { name: 'Parked', sign: [-13.25, 10.9] as const, box: [-13.4, 8.6, -5.4, 10.9] as const }
