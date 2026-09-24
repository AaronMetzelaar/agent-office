import { deptIds, deptNames, type DeptId } from '../../shared/office'

export { deptIds, isDeptId, type DeptId } from '../../shared/office'
export type SlotKind = 'desk' | 'gym'
export type Tier = 0 | 1 | 2 | 3
export type Shell = 'room' | 'gym' | 'yard'
export type Box = [x0: number, z0: number, x1: number, z1: number]

export interface DeptDef {
  id: DeptId
  name: string
  path: string
  accent: number
  shell: Shell
}

export const X0 = -13.5
export const ZF = 12.9
export const band = { x1: 3.9, z0: 9.1 }
export const aisle = 1.2
export const FZ = band.z0 - aisle
export const walkway = 2
const gap = 1
const yardGap = 0.5
const bandW = band.x1 - X0
const bandD = ZF - band.z0
const screenAspect = 1.6
const sinView = 0.755
const wallView = 1.7

export const depts: readonly DeptDef[] = [
  { id: 'mkt', name: deptNames.mkt, path: 'monorepo/frontend/marketplace', accent: 0x1b34ff, shell: 'room' },
  { id: 'adm', name: deptNames.adm, path: 'monorepo/frontend/admin', accent: 0xdb2777, shell: 'room' },
  { id: 'mob', name: deptNames.mob, path: 'monorepo/frontend/mobile', accent: 0x16a34a, shell: 'room' },
  { id: 'plat', name: deptNames.plat, path: 'services · api · workers · infra', accent: 0x7c3aed, shell: 'room' },
  { id: 'side', name: deptNames.side, path: '~/Documents/GitHub · outside', accent: 0xea580c, shell: 'yard' },
  { id: 'rev', name: deptNames.rev, path: 'your review requests', accent: 0x854d0e, shell: 'room' },
  { id: 'gym', name: deptNames.gym, path: 'research account', accent: 0x0d9488, shell: 'gym' },
]

export const dept = Object.fromEntries(depts.map((d) => [d.id, d])) as Record<DeptId, DeptDef>
export const kindOf = (id: DeptId): SlotKind => (id === 'gym' ? 'gym' : 'desk')

export const deskGrid = { cw: 3.2, cd: 2.6, left: 0.3, right: 0.3, back: 2, front: 1.3, side: 1.4 }
export const gymGrid = { cw: 2, cd: 2.4, left: 0.6, right: 1.2, back: 1.2, relax: 1.5, front: 0.5 }
export const yardGrid = { cw: 2.7, cd: 2.5, left: 0.4, right: 0.4, back: 1.6, front: 0.8, side: 1.6 }
export const loungeGrid = { pitchX: 1, pitchZ: 1.15, left: 0.5, right: 1.1, back: 0.7, front: 0.6 }

export type Demand = Partial<Record<DeptId, number>>

export function tierOf(id: DeptId, desks: number): Tier {
  if (desks <= 0) return 0
  if (id === 'gym') return desks <= 3 ? 1 : desks <= 8 ? 2 : 3
  return desks <= 3 ? 1 : desks <= 6 ? 2 : 3
}

export function gridOf(id: DeptId, desks: number): { cols: number; rows: number } {
  if (id === 'side') {
    if (desks <= 3) return { cols: Math.max(2, desks), rows: 1 }
    return desks <= 8 ? { cols: desks <= 6 ? 3 : 4, rows: 2 } : { cols: Math.max(4, Math.ceil(desks / 3)), rows: 3 }
  }
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
      d: g.back + rows * g.cd + g.relax + g.front,
      slots: cellOrder(id, desks).map(([c, r]) => [g.left + g.cw * (c + 0.5), g.back + g.cd * (r + 0.5)]),
    }
  }
  const g = id === 'side' ? yardGrid : deskGrid
  return {
    tier, cols, rows,
    w: g.left + cols * g.cw + (tier >= 2 ? g.side : 0) + g.right,
    d: g.back + rows * g.cd + g.front,
    slots: cellOrder(id, desks).map(([c, r]) => [g.left + g.cw * (c + 0.5), g.back + g.cd * (r + 0.5)]),
  }
}

export const minWidth = (id: DeptId, tier: Tier) => sectionOf(id, id === 'gym' ? [0, 1, 4, 9][tier]! : [0, 2, 4, 7][tier]!).w

export const gymRelaxZ = (rows: number) => gymGrid.back + rows * gymGrid.cd + gymGrid.relax / 2

export function gymCooler(k: number, w: number, rows: number): readonly [number, number] {
  const perLine = Math.max(1, Math.floor((w - 5.2) / 0.95) + 1)
  return [w - 1.3 - (k % perLine) * 0.95, gymRelaxZ(rows) + (Math.floor(k / perLine) % 2 ? 0.45 : -0.25)]
}

export const loungeRowsIn = (depth: number) => Math.max(1, Math.floor((depth - loungeGrid.back - loungeGrid.front) / loungeGrid.pitchZ + 1e-9) + 1)

export function loungeShape(seats: number, depth: number) {
  const g = loungeGrid
  const rows = loungeRowsIn(depth)
  const cols = Math.max(1, Math.ceil(seats / rows))
  return { rows, cols, w: g.left + cols * g.pitchX + g.right, d: g.back + (rows - 1) * g.pitchZ + g.front }
}

export function loungeSeat(i: number, rows: number): readonly [number, number] {
  const g = loungeGrid
  return [g.left + g.pitchX * (Math.floor(i / rows) + 0.5), g.back + g.pitchZ * (rows - 1 - (i % rows))]
}

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
  box: Box
  world: [number, number][]
}

export interface LoungeZone {
  shown: boolean
  seats: number
  rows: number
  cols: number
  box: Box
  world: [number, number][]
}

export type YardSide = 'left' | 'front'

export interface Floor {
  zones: Record<DeptId, Zone>
  lounge: LoungeZone
  yard?: YardSide
  bounds: Bounds
  frame: Bounds
}

interface Plan {
  rows: DeptId[][]
  loungeAt: number
  yard?: YardSide
  W: number
  D: number
  cost: number
}

const union = (a: Bounds, b?: Box): Bounds => (b ? { x0: Math.min(a.x0, b[0]), z0: Math.min(a.z0, b[1]), x1: Math.max(a.x1, b[2]), z1: Math.max(a.z1, b[3]) } : a)

export function yardBox(side: YardSide, w: number, d: number): Box {
  return side === 'left' ? [X0 - yardGap - w, ZF - d, X0 - yardGap, ZF] : [X0, ZF + yardGap, X0 + w, ZF + yardGap + d]
}

export function fitSize(frame: Bounds): number {
  const across = frame.x1 - frame.x0
  const up = (frame.z1 - frame.z0) * sinView + wallView
  return Math.max(across / screenAspect, up)
}

function compositions<T>(items: readonly T[]): T[][][] {
  if (!items.length) return [[]]
  const out: T[][][] = []
  for (let mask = 0; mask < 1 << (items.length - 1); mask++) {
    const rows: T[][] = [[items[0]!]]
    for (let i = 1; i < items.length; i++) {
      if (mask & (1 << (i - 1))) rows.push([items[i]!])
      else rows.at(-1)!.push(items[i]!)
    }
    out.push(rows)
  }
  return out
}

function plan(sections: Record<DeptId, Section>, inside: readonly DeptId[], standby: number, yard: Section | undefined): Plan {
  let best: Plan | undefined
  for (const rows of compositions(inside)) {
    const depth = rows.map((row) => Math.max(...row.map((id) => sections[id].d)))
    const natural = rows.map((row) => row.reduce((sum, id) => sum + sections[id].w, 0) + gap * (row.length - 1))
    for (const loungeAt of standby ? [-1, ...rows.keys()] : [-1]) {
      const lounge = (r: number) => (standby && loungeAt === r ? loungeShape(standby, r < 0 ? bandD : depth[r]!).w + (r < 0 ? 0 : gap) : 0)
      const W = Math.max(bandW + lounge(-1), ...natural.map((w, r) => w + lounge(r)))
      const D = depth.reduce((sum, d) => sum + d, 0) + Math.max(1, rows.length) * aisle + bandD
      const slack = standby && loungeAt < 0 ? 0 : W - bandW
      const empty = slack > walkway ? slack * bandD : 0
      const building: Bounds = { x0: X0, z0: ZF - D, x1: X0 + W, z1: ZF }
      for (const side of yard ? (['left', 'front'] as const) : [undefined]) {
        const fit = fitSize(union(building, side && yard ? yardBox(side, yard.w, yard.d) : undefined))
        const cost = W * D + 0.5 * screenAspect * fit * fit + 50 * empty
        if (!best || cost < best.cost - 1e-9) best = { rows, loungeAt, yard: side, W, D, cost }
      }
    }
  }
  return best!
}

export function layoutFloor(desks: Demand, standby = 0, prev?: Floor): Floor {
  const count = (id: DeptId) => Math.max(0, desks[id] ?? 0)
  const sections = Object.fromEntries(deptIds.map((id) => [id, sectionOf(id, count(id))])) as Record<DeptId, Section>
  const shown = (id: DeptId) => count(id) > 0
  const inside = depts.filter((d) => d.shell !== 'yard' && shown(d.id)).map((d) => d.id)
  const yard = shown('side') ? sections.side : undefined
  const { rows, loungeAt, yard: side, W, D } = plan(sections, inside, standby, yard)
  const boxes: Partial<Record<DeptId, Box>> = {}
  let loungeBox: Box | undefined
  let loungeRows = loungeShape(standby, bandD).rows
  let z = ZF - D
  rows.forEach((row, r) => {
    const depth = Math.max(...row.map((id) => sections[id].d))
    const widths = row.reduce((sum, id) => sum + sections[id].w, 0)
    const room = loungeAt === r ? loungeShape(standby, depth) : undefined
    const slack = W - widths - gap * (row.length - 1) - (room ? room.w + gap : 0)
    let x = X0
    for (const id of row) {
      const w = sections[id].w + (room ? 0 : (slack * sections[id].w) / widths)
      boxes[id] = [x, z, x + w, z + depth]
      x += w + gap
    }
    if (room) {
      loungeBox = [x, z, X0 + W, z + depth]
      loungeRows = room.rows
    }
    z += depth + aisle
  })
  if (standby && loungeAt < 0) loungeBox = [band.x1, band.z0, X0 + W, ZF]
  if (side && yard) boxes.side = yardBox(side, yard.w, yard.d)
  const zones = {} as Record<DeptId, Zone>
  for (const { id } of depts) {
    const box = boxes[id] ?? prev?.zones[id].box ?? [X0, FZ - sections[id].d, X0 + sections[id].w, FZ]
    zones[id] = { id, ...sections[id], shown: shown(id), desks: count(id), box, world: sections[id].slots.map(([x, sz]) => [box[0] + x, box[1] + sz]) }
  }
  const lbox = loungeBox ?? prev?.lounge.box ?? [band.x1, band.z0, band.x1 + loungeShape(1, bandD).w, ZF]
  const lounge: LoungeZone = {
    shown: standby > 0,
    seats: standby,
    rows: loungeRows,
    cols: Math.max(1, Math.ceil(standby / loungeRows)),
    box: lbox,
    world: Array.from({ length: standby }, (_, i) => {
      const [x, sz] = loungeSeat(i, loungeRows)
      return [lbox[0] + x, lbox[1] + sz] as [number, number]
    }),
  }
  const bounds: Bounds = { x0: X0, z0: ZF - D, x1: X0 + W, z1: ZF }
  return { zones, lounge, yard: side, bounds, frame: union(bounds, boxes.side) }
}

export function settle(current: Demand, seated: Demand, canRelayout: boolean, present: ReadonlySet<DeptId> = new Set()): { desks: Demand; pending: boolean } {
  const desks: Demand = {}
  let pending = false
  for (const { id } of depts) {
    const n = seated[id] ?? 0
    const want = n > 0 || present.has(id) ? n + 1 : 0
    desks[id] = canRelayout ? want : Math.max(current[id] ?? 0, n, present.has(id) ? 1 : 0)
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

export function assignSeats(prev: ReadonlyMap<string, number>, ids: readonly string[]): Map<string, number> {
  const used = new Set<number>()
  const out = new Map<string, number>()
  for (const id of ids) {
    const seat = prev.get(id)
    if (seat !== undefined && seat < ids.length && !used.has(seat)) {
      used.add(seat)
      out.set(id, seat)
    }
  }
  let next = 0
  for (const id of ids) {
    if (out.has(id)) continue
    while (used.has(next)) next++
    used.add(next)
    out.set(id, next)
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
export const cloakroom = { x0: -11.5, lockers: 12, pitch: 0.56, z: 9.55 }
export const bandArea = bandW * bandD
export const fixedParts: readonly Box[] = [
  [office.x0 - 0.3, office.z0 - 0.3, office.x1 + 0.3, ZF],
  [queueSpots.at(-1)![0] - 0.7, queueZ - 0.6, office.x0 - 0.3, queueZ + 0.6],
  [X0, 11.2, queueSpots.at(-1)![0] - 0.7, ZF],
  [cloakroom.x0, cloakroom.z - 0.19, cloakroom.x0 + cloakroom.lockers * cloakroom.pitch, cloakroom.z + 0.19],
]
