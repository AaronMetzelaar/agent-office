import { PerspectiveCamera, Vector3 } from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { ZC, ZF } from './layout'

export const VIEW = new Vector3(0.22, 1.18, 1).normalize()

export interface Region {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function fitPoints(right: number): Vector3[] {
  const R = right + 0.25
  const points: Vector3[] = []
  for (const x of [-13.75, R]) for (const z of [-8.75, ZF + 0.25]) points.push(new Vector3(x, -0.33, z), new Vector3(x, 0, z))
  points.push(new Vector3(-13.75, 2.62, -8.75), new Vector3(R, 2.62, -8.75), new Vector3(-13.75, 2.62, ZF + 0.25), new Vector3(R, 0.92, ZF + 0.25))
  return points
}

export function applyRegion(camera: PerspectiveCamera, region: Region, w: number, h: number) {
  camera.aspect = w / h
  camera.setViewOffset(w, h, w / 2 - (region.x0 + region.x1) / 2, h / 2 - (region.y0 + region.y1) / 2, w, h)
  camera.updateProjectionMatrix()
}

export function fitOverview(camera: PerspectiveCamera, region: Region, w: number, h: number, right: number): { target: Vector3; distance: number } {
  const fc = camera.clone()
  const target = new Vector3((right - 13.5) / 2, 0.3, ZC)
  const p = new Vector3()
  const points = fitPoints(right)
  const pad = 8
  const cx = (region.x0 + region.x1) / 2
  const cy = (region.y0 + region.y1) / 2
  const box = (d: number) => {
    fc.position.copy(target).addScaledVector(VIEW, d)
    fc.lookAt(target)
    fc.updateMatrixWorld()
    let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity
    for (const q of points) {
      p.copy(q).project(fc)
      const sx = ((p.x + 1) / 2) * w, sy = ((1 - p.y) / 2) * h
      a = Math.min(a, sx)
      c = Math.max(c, sx)
      b = Math.min(b, sy)
      e = Math.max(e, sy)
    }
    return [a, b, c, e] as const
  }
  let distance = 40
  for (let it = 0; it < 5; it++) {
    let lo = 3, hi = 260
    for (let k = 0; k < 28; k++) {
      const m = (lo + hi) / 2
      const [a, b, c, e] = box(m)
      if (c - a <= region.x1 - region.x0 - 2 * pad && e - b <= region.y1 - region.y0 - 2 * pad) hi = m
      else lo = m
    }
    distance = hi
    const [a, b, c, e] = box(distance)
    const upp = (2 * distance * Math.tan((fc.fov * Math.PI) / 360)) / h
    target.addScaledVector(new Vector3().setFromMatrixColumn(fc.matrixWorld, 0), ((a + c) / 2 - cx) * upp).addScaledVector(new Vector3().setFromMatrixColumn(fc.matrixWorld, 1), -((b + e) / 2 - cy) * upp)
  }
  return { target, distance }
}

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)

interface Tween {
  u: number
  dur: number
  t0: Vector3
  d0: number
  r0: Vector3
  getT: () => Vector3
  d1: number
  r1: Vector3
}

export type Rig = ReturnType<typeof createRig>

export function createRig(camera: PerspectiveCamera, controls: OrbitControls, reduce: boolean) {
  const rig = {
    overview: { target: new Vector3(), distance: 40 },
    atOverview: true,
    follow: undefined as (() => Vector3) | undefined,
    tween: undefined as Tween | undefined,
    layout(region: Region, w: number, h: number, right: number) {
      applyRegion(camera, region, w, h)
      rig.overview = fitOverview(camera, region, w, h, right)
      controls.maxDistance = rig.overview.distance * 1.6
    },
    flyTo(getT: () => Vector3, distance: number, dir?: Vector3, dur = 1) {
      const off = camera.position.clone().sub(controls.target)
      rig.tween = { u: 0, dur: reduce ? 0.01 : dur, t0: controls.target.clone(), d0: off.length(), r0: off.clone().normalize(), getT, d1: distance, r1: (dir ?? off).clone().normalize() }
    },
    goOverview(snap: boolean) {
      rig.atOverview = true
      rig.follow = undefined
      if (!snap) return rig.flyTo(() => rig.overview.target, rig.overview.distance, VIEW, 0.85)
      rig.tween = undefined
      controls.target.copy(rig.overview.target)
      camera.position.copy(rig.overview.target).addScaledVector(VIEW, rig.overview.distance)
      controls.update()
    },
    zoomDistance(region: Region, h: number) {
      return Math.min(Math.max(4.4 / ((2 * Math.tan((camera.fov * Math.PI) / 360) * (region.y1 - region.y0)) / h), 7), rig.overview.distance * 0.6)
    },
    zoomed: () => camera.position.distanceTo(controls.target) < rig.overview.distance * 0.62,
    step(dt: number) {
      const tw = rig.tween
      if (tw) {
        tw.u = Math.min(1, tw.u + dt / tw.dur)
        const e = ease(tw.u)
        controls.target.lerpVectors(tw.t0, tw.getT(), e)
        const r = tw.r0.clone().lerp(tw.r1, e).normalize()
        camera.position.copy(controls.target).addScaledVector(r, tw.d0 + (tw.d1 - tw.d0) * e)
        if (tw.u >= 1) rig.tween = undefined
      } else if (rig.follow) {
        const dv = rig.follow().sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 4))
        controls.target.add(dv)
        camera.position.add(dv)
      }
    },
  }
  controls.addEventListener('start', () => {
    rig.tween = undefined
    rig.follow = undefined
    rig.atOverview = false
  })
  return rig
}

export function createCamera() {
  return new PerspectiveCamera(24, innerWidth / innerHeight, 0.5, 220)
}
