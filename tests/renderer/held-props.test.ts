import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { cigAt, dragReach, errandProp, handProps, pose, rig, seated, standing, type HandProp } from '../../src/renderer/office/characters'

const outline = new THREE.SplineCurve(rig.profile.map(([a, b]) => new THREE.Vector2(a, b))).getPoints(48)
const bodyRadius = (y: number) => {
  for (let i = 1; i < outline.length; i++) {
    const a = outline[i - 1]!, b = outline[i]!
    if ((y - a.y) * (y - b.y) <= 0 && a.y !== b.y) return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)
  }
  return 0
}

interface Joints { a1: number; z1: number; head: number; tilt: number; lean: number }

function depth(j: Joints, place: (arm: THREE.Group) => THREE.Vector3[]) {
  const hips = new THREE.Group()
  hips.rotation.x = j.lean
  const arm = new THREE.Group()
  arm.position.set(rig.shoulder[0], rig.shoulder[1], 0)
  arm.rotation.set(j.a1, 0, j.z1)
  hips.add(arm)
  const hp = new THREE.Group()
  hp.position.y = rig.neck
  hp.rotation.set(j.head, 0, j.tilt)
  hips.add(hp)
  hips.updateMatrixWorld(true)
  const toHead = hp.matrixWorld.clone().invert()
  const toHips = hips.matrixWorld.clone().invert()
  let worst = -Infinity
  for (const p of place(arm)) {
    const inHips = p.clone().applyMatrix4(toHips)
    const r = bodyRadius(inHips.y - rig.body)
    worst = Math.max(worst, r - Math.hypot(inHips.x, inHips.z))
    const h = p.clone().applyMatrix4(toHead)
    const e = Math.hypot(h.x / (rig.headR * rig.headScale[0]), (h.y - rig.head) / (rig.headR * rig.headScale[1]), h.z / (rig.headR * rig.headScale[2]))
    worst = Math.max(worst, (1 - e) * rig.headR)
  }
  return worst
}

function corners(arm: THREE.Group, prop: HandProp) {
  const { size, at, rx } = handProps[prop]
  const o = new THREE.Object3D()
  o.position.set(...at)
  o.rotation.x = rx
  arm.add(o)
  o.updateMatrixWorld(true)
  const pts: THREE.Vector3[] = []
  for (const x of [-0.5, 0, 0.5]) for (const y of [-0.5, 0, 0.5]) for (const z of [-0.5, 0.5]) pts.push(o.localToWorld(new THREE.Vector3(x * size[0], y * size[1], z * size[2])))
  return pts
}

const along = (y: number) => (arm: THREE.Group) => {
  const o = new THREE.Object3D()
  o.position.set(...cigAt.at)
  o.rotation.set(...cigAt.rot)
  arm.add(o)
  o.updateMatrixWorld(true)
  return [-0.02, 0, 0.02].map((x) => o.localToWorld(new THREE.Vector3(x, y, 0)))
}

const clearance = 0.01

describe('held props stay outside the body and head', () => {
  for (const prop of ['read', 'phone', 'sip'] as const)
    it(`keeps the ${prop} prop clear while seated`, () => {
      expect(depth(seated[prop], (arm) => corners(arm, prop))).toBeLessThanOrEqual(-clearance)
    })

  for (const [errand, prop] of Object.entries(errandProp) as [keyof typeof standing, HandProp][])
    it(`keeps the ${prop} prop clear while on a ${errand} errand`, () => {
      expect(depth(standing[errand], (arm) => corners(arm, prop))).toBeLessThanOrEqual(-clearance)
    })

  it('keeps the hands out of the head during a stretch', () => {
    const hand = (arm: THREE.Group) => [arm.localToWorld(new THREE.Vector3(0, -0.17, 0))]
    const j = standing.stretch
    expect(depth(j, hand) + 0.062).toBeLessThanOrEqual(-clearance)
  })

  it('brings only the filter to the lips during a drag, never the rest of the cigarette', () => {
    const filter = cigAt.from - cigAt.paper / 2
    let peak = -Infinity
    for (let drag = 0; drag <= 1.001; drag += 0.1) {
      const j = { ...pose.smoke, a1: pose.smoke.a1 - drag * dragReach.x, z1: pose.smoke.z1 - drag * dragReach.z }
      for (const y of [cigAt.from, cigAt.from + cigAt.paper / 2, cigAt.ember]) expect(depth(j, along(y)), `drag ${drag.toFixed(1)} at ${y}`).toBeLessThanOrEqual(-clearance)
      peak = Math.max(peak, depth(j, along(filter)))
    }
    expect(peak).toBeLessThanOrEqual(0.02)
    expect(peak).toBeGreaterThan(-0.03)
  })
})
