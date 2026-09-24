import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Blob, Kit } from './characters'
import { door } from './layout'
import { createTrips, tripTimes, type Job, type Phase } from './trips'

const park = new THREE.Vector3(-16.6, 0, 14.5)
const tail = new THREE.Vector3(-15.1, 0, 14.5)
const outside = new THREE.Vector3(door[0], 0, 13.7)
const inside = new THREE.Vector3(door[0], 0, door[1] - 0.25)
const crewColour = 0xffc21a
const around = [new THREE.Vector3(1.15, 0, 0.05), new THREE.Vector3(-1.15, 0, 0.05), new THREE.Vector3(0, 0, 0.95)]
const size = 0.72

interface Mover {
  b: Blob
  item: THREE.Group
  path: THREE.Vector3[]
  lens: number[]
  face: number
}

const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2)

function at(m: Mover, u: number, out: THREE.Vector3): THREE.Vector3 {
  const total = m.lens.at(-1)!
  let d = Math.max(0, Math.min(1, u)) * total
  for (let k = 1; k < m.path.length; k++) {
    const seg = m.lens[k]! - m.lens[k - 1]!
    if (d <= seg || k === m.path.length - 1) return out.lerpVectors(m.path[k - 1]!, m.path[k]!, seg ? Math.min(1, d / seg) : 1)
    d -= seg
  }
  return out.copy(m.path[0]!)
}

function build(scene: THREE.Scene, kit: Kit) {
  const mat = (color: number, roughness = 0.6) => new THREE.MeshStandardMaterial({ color, roughness })
  const parts = (list: [THREE.BufferGeometry, number, number, number][]) => mergeGeometries(list.map(([g, x, y, z]) => (g.index ? g.toNonIndexed() : g).translate(x, y, z)))
  const truck = new THREE.Group()
  const box = (w: number, h: number, d: number, r = 0.08) => new RoundedBoxGeometry(w, h, d, 2, r)
  const wheel = () => new THREE.CylinderGeometry(0.25, 0.25, 0.18, 10).rotateX(Math.PI / 2)
  truck.add(
    new THREE.Mesh(parts([[box(2, 1.35, 1.2), 0.4, 1.0, 0]]), mat(0xf6f6f4, 0.5)),
    new THREE.Mesh(parts([[box(0.85, 0.95, 1.12), -1.05, 0.78, 0], [box(2.02, 0.16, 1.22, 0.03), 0.4, 0.62, 0]]), mat(0x3b7bff, 0.5)),
    new THREE.Mesh(
      parts([
        [box(0.06, 0.38, 0.92, 0.02), -1.47, 1.0, 0],
        [box(3, 0.12, 1.16, 0.04), -0.1, 0.33, 0],
        ...[-0.95, 0.9].flatMap((x) => [-0.58, 0.58].map((z): [THREE.BufferGeometry, number, number, number] => [wheel(), x, 0.25, z])),
      ]),
      mat(0x2a2e36, 0.5),
    ),
  )
  const shade = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1b2130, transparent: true, opacity: 0.14, depthWrite: false }))
  shade.position.y = 0.012
  truck.add(shade)
  const denim = mat(0x3d5a9e, 0.8)
  const cap = mat(0xe0463c, 0.55)
  const pants = new THREE.CylinderGeometry(0.3, 0.235, 0.2, 12).translate(0, 0.03, 0)
  const bib = new THREE.BoxGeometry(0.24, 0.16, 0.05).translate(0, 0.17, 0.255)
  const dome = new THREE.SphereGeometry(0.36, 12, 6, 0, Math.PI * 2, 0, 0.95).scale(1.04, 0.96, 1).translate(0, 0.27, 0)
  const brim = new THREE.CylinderGeometry(0.19, 0.19, 0.025, 12).scale(1, 1, 1.25).rotateX(0.25).translate(0, 0.48, 0.3)
  const white = mat(0xf6f6f4, 0.45)
  const items = [
    () => [new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.04), white), new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.28, 0.01).translate(0, 0, 0.022), mat(0x1e232c, 0.3))],
    () => [new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.16, 10), mat(0xc9714b, 0.8)), new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6).translate(0, 0.2, 0), mat(0x3f9a55, 0.62))],
    () => [new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.34), mat(0xd6c3a0, 0.85))],
  ]
  const crew: Mover[] = around.map((_, k) => {
    const b = kit.blob(crewColour, true)
    b.g.scale.setScalar(size)
    b.hips.add(new THREE.Mesh(pants, denim), new THREE.Mesh(bib, denim))
    b.hp.add(new THREE.Mesh(dome, cap), new THREE.Mesh(brim, cap))
    const item = new THREE.Group()
    item.add(...items[k]!())
    item.position.set(0, 0.3, 0.36)
    b.hips.add(item)
    b.g.visible = false
    return { b, item, path: [tail.clone()], lens: [0], face: 0 }
  })
  const puff = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false })
  const puffs = Array.from({ length: 4 }, () => new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), puff))
  truck.visible = false
  for (const p of puffs) p.visible = false
  scene.add(truck, ...puffs)
  return { truck, crew, puffs, puff }
}

export function createMovers(scene: THREE.Scene, kit: Kit, route: (from: THREE.Vector3, to: THREE.Vector3) => THREE.Vector3[], deskAt: (job: Job) => THREE.Vector3 | undefined, motion: number) {
  const trips = createTrips()
  let rig: ReturnType<typeof build> | undefined
  let phase: Phase | undefined
  const p = new THREE.Vector3()
  const ahead = new THREE.Vector3()

  function plan(jobs: readonly Job[]) {
    for (const [k, m] of rig!.crew.entries()) {
      const centre = deskAt(jobs[k % jobs.length]!) ?? inside
      const goal = centre.clone().add(around[k]!)
      m.face = Math.atan2(centre.x - goal.x, centre.z - goal.z)
      m.path = [tail.clone().setZ(tail.z + (k - 1) * 0.4), outside, ...route(inside, goal)]
      m.lens = m.path.reduce<number[]>((acc, q, i) => [...acc, i ? acc[i - 1]! + q.distanceTo(m.path[i - 1]!) : 0], [])
    }
  }

  function pose(m: Mover, u: number, t: number, carry: boolean, walking: boolean) {
    const b = m.b
    at(m, u, p)
    at(m, u + (carry ? -0.02 : 0.02), ahead)
    if (walking && ahead.distanceToSquared(p) > 1e-6) b.g.rotation.y = Math.atan2(ahead.x - p.x, ahead.z - p.z)
    const s = walking ? Math.sin(t * 16) * motion : 0
    b.g.position.set(p.x, Math.abs(s) * 0.05, p.z)
    b.legs[0]!.rotation.x = s * 0.7
    b.legs[1]!.rotation.x = -s * 0.7
    b.arms[0]!.rotation.x = b.arms[1]!.rotation.x = carry ? -1.35 : -s * 0.6
    b.hips.rotation.x = 0
    m.item.visible = carry
  }

  function draw(t: number) {
    const trip = trips.trip
    if (!rig) return
    const on = !!trip
    rig.truck.visible = on
    if (!trip) {
      for (const m of rig.crew) m.b.g.visible = false
      for (const q of rig.puffs) q.visible = false
      return
    }
    const u = trip.t / tripTimes[trip.phase]
    const x = trip.phase === 'arrive' ? park.x - 14 * (1 - u) ** 3 : trip.phase === 'leave' ? park.x - 22 * u * u : park.x
    rig.truck.position.set(x, trip.phase === 'leave' ? Math.sin(u * 30) * 0.015 * motion : 0, park.z)
    rig.truck.rotation.z = trip.phase === 'leave' ? -0.04 * (1 - u) * motion : 0
    rig.crew.forEach((m, k) => {
      const b = m.b
      b.g.visible = trip.phase !== 'arrive' && trip.phase !== 'leave'
      if (!b.g.visible) return
      const lag = k * 0.08
      if (trip.phase === 'fetch') pose(m, easeInOut(Math.max(0, (u - lag) / (1 - lag))), t, false, u > lag && u < 1)
      else if (trip.phase === 'pickup') {
        pose(m, 1, t, u > 0.55, false)
        b.g.rotation.y = m.face
        b.hips.rotation.x = Math.sin(Math.min(1, u * 1.6) * Math.PI) * 0.55
      } else if (trip.phase === 'carry') pose(m, 1 - easeInOut(Math.max(0, (u - lag) / (1 - lag))), t, true, u > lag && u < 1)
      else {
        pose(m, 0, t, true, false)
        b.g.position.x -= u * 0.7
        b.g.position.y = Math.sin(u * Math.PI) * 0.35
        b.g.scale.setScalar(size * (1 - u * u))
      }
      if (trip.phase !== 'load') b.g.scale.setScalar(size)
    })
    const puffing = trip.phase === 'leave' && u < 0.7
    rig.puff.opacity = 0.8 * (1 - u / 0.7)
    rig.puffs.forEach((q, k) => {
      q.visible = puffing
      const v = u + k * 0.06
      q.position.set(park.x + 1.6 + v * (1.2 + k * 0.3), 0.3 + v * (0.5 + k * 0.15), park.z + (k - 1.5) * 0.18)
      q.scale.setScalar(0.6 + v * 3)
    })
  }

  return {
    trips,
    add(job: Job) {
      rig ??= build(scene, kit)
      trips.add(job)
    },
    step(dt: number, t: number): { picked: Job[]; cleared: Job[]; active: boolean } {
      if (!trips.trip) return { picked: [], cleared: [], active: false }
      const events = trips.step(dt)
      const now = trips.trip?.phase
      if (now === 'fetch' && phase !== 'fetch') plan(trips.trip!.jobs)
      phase = now
      draw(t)
      return { ...events, active: true }
    },
  }
}
