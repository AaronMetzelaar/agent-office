import { Vector3 } from 'three'
import type { Bounds } from './layout'

const cell = 0.2
const n8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const

interface Blocker {
  x0: number
  z0: number
  x1: number
  z1: number
  pad: number
  owner?: string
  tag?: string
}

export type Nav = ReturnType<typeof createNav>

export function createNav() {
  const blockers: Blocker[] = []
  let gw = 1
  let gh = 1
  let gx = 0
  let gz = 0
  let grid = new Uint8Array(1)

  const cellOf = (x: number, z: number) => Math.min(gh - 1, Math.max(0, Math.floor((z - gz) / cell))) * gw + Math.min(gw - 1, Math.max(0, Math.floor((x - gx) / cell)))
  const cellPoint = (c: number) => new Vector3(gx + ((c % gw) + 0.5) * cell, 0, gz + (Math.floor(c / gw) + 0.5) * cell)

  function mark(x0: number, z0: number, x1: number, z1: number, pad: number) {
    const i0 = Math.max(0, Math.floor((x0 - pad - gx) / cell))
    const i1 = Math.min(gw - 1, Math.floor((x1 + pad - gx) / cell))
    const j0 = Math.max(0, Math.floor((z0 - pad - gz) / cell))
    const j1 = Math.min(gh - 1, Math.floor((z1 + pad - gz) / cell))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * gw + i] = 1
  }

  function nearFree(c: number): number {
    if (!grid[c]) return c
    const ci = c % gw
    const cj = Math.floor(c / gw)
    for (let r = 1; r < 30; r++) {
      let best = -1
      let bestDistance = Infinity
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
          const i = ci + di
          const j = cj + dj
          if (i < 0 || j < 0 || i >= gw || j >= gh) continue
          const next = j * gw + i
          const distance = di * di + dj * dj
          if (!grid[next] && distance < bestDistance) {
            bestDistance = distance
            best = next
          }
        }
      if (best >= 0) return best
    }
    return c
  }

  function clear(a: Vector3, b: Vector3): boolean {
    const steps = Math.ceil(a.distanceTo(b) / (cell * 0.5))
    for (let k = 1; k < steps; k++) {
      const t = k / steps
      if (grid[cellOf(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)]) return false
    }
    return true
  }

  return {
    block(x0: number, z0: number, x1: number, z1: number, pad = 0.3, owner?: string, tag?: string) {
      blockers.push({ x0, z0, x1, z1, pad, owner, tag })
    },
    unblock(tag: string) {
      for (let i = blockers.length - 1; i >= 0; i--) if (blockers[i]!.tag === tag) blockers.splice(i, 1)
    },
    rebuild(bounds: Bounds, offset: (owner: string) => readonly [number, number] | undefined) {
      gx = bounds.x0 - 0.6
      gz = bounds.z0 - 0.5
      gw = Math.ceil((bounds.x1 + 1.5 - gx) / cell)
      gh = Math.ceil((bounds.z1 + 0.9 - gz) / cell)
      grid = new Uint8Array(gw * gh)
      for (const b of blockers) {
        const [dx, dz] = b.owner === undefined ? [0, 0] : (offset(b.owner) ?? [])
        if (dx !== undefined && dz !== undefined) mark(b.x0 + dx, b.z0 + dz, b.x1 + dx, b.z1 + dz, b.pad)
      }
    },
    blocked: (x: number, z: number) => grid[cellOf(x, z)] === 1,
    route(from: Vector3, to: Vector3): Vector3[] {
      const start = nearFree(cellOf(from.x, from.z))
      const goal = nearFree(cellOf(to.x, to.z))
      const prev = new Int32Array(gw * gh).fill(-1)
      const open = [start]
      prev[start] = start
      for (let h = 0; h < open.length && prev[goal]! < 0; h++) {
        const c = open[h]!
        const ci = c % gw
        const cj = (c / gw) | 0
        for (const [di, dj] of n8) {
          const i = ci + di
          const j = cj + dj
          if (i < 0 || j < 0 || i >= gw || j >= gh) continue
          const next = j * gw + i
          if (grid[next] || prev[next]! >= 0) continue
          if (di && dj && (grid[cj * gw + i] || grid[j * gw + ci])) continue
          prev[next] = c
          open.push(next)
        }
      }
      if (prev[goal]! < 0) return [to.clone()]
      const cells: number[] = []
      for (let c = goal; c !== start; c = prev[c]!) cells.push(c)
      cells.push(start)
      cells.reverse()
      const points = cells.map(cellPoint)
      const out = [points[0]!]
      for (let i = 0; i < points.length - 1; ) {
        let j = points.length - 1
        while (j > i + 1 && !clear(points[i]!, points[j]!)) j--
        out.push(points[j]!)
        i = j
      }
      out.push(to.clone())
      return out
    },
  }
}

export interface Walker {
  pos: Vector3
  path: Vector3[]
  goal: Vector3 | null
  speed: number
  face: number
}

export const newWalker = (pos: Vector3): Walker => ({ pos: pos.clone(), path: [], goal: null, speed: 0, face: 0 })

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export function stepWalker(w: Walker, target: Vector3, dt: number, route: (from: Vector3, to: Vector3) => Vector3[], canMove: boolean): boolean {
  if (w.goal !== target) {
    w.goal = target
    w.path = w.pos.distanceTo(target) > 0.06 ? route(w.pos, target) : []
  }
  if (!w.path.length) {
    w.speed = 0
    w.pos.x += (target.x - w.pos.x) * Math.min(1, dt * 8)
    w.pos.z += (target.z - w.pos.z) * Math.min(1, dt * 8)
    return false
  }
  if (!canMove) return false
  const next = w.path[0]!
  const dx = next.x - w.pos.x
  const dz = next.z - w.pos.z
  const length = Math.hypot(dx, dz)
  let remaining = length
  for (let k = 1; k < w.path.length; k++) remaining += w.path[k]!.distanceTo(w.path[k - 1]!)
  const top = Math.min(remaining > 6 ? 2.6 : 2.0, 0.45 + remaining * 1.8)
  w.speed += (top - w.speed) * (1 - Math.exp(-dt * 5))
  const step = Math.min(length, w.speed * dt)
  if (length > 1e-4) {
    w.pos.x += (dx / length) * step
    w.pos.z += (dz / length) * step
    if (length > 0.03) w.face += wrap(Math.atan2(dx, dz) - w.face) * (1 - Math.exp(-dt * 10))
  }
  if (length - step < 0.02) w.path.shift()
  return w.path.length > 0
}
