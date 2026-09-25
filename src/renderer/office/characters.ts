import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { canvasTex, lighten } from './props'
import { activityAt, type Activity } from './lounge'
import { stepWalker, type Walker } from './nav'
import type { PoseName } from './pose'

export interface Blob {
  g: THREE.Group
  hips: THREE.Group
  legs: THREE.Group[]
  arms: THREE.Group[]
  hp: THREE.Group
  body: THREE.Mesh
  eyes: THREE.Mesh[]
  tex: THREE.Texture
  m: THREE.MeshStandardMaterial
}

interface Joints {
  legs: number
  a0: number
  a1: number
  z0: number
  z1: number
  head: number
  lean: number
  eye: number
  tilt: number
}

const pose: Record<PoseName, Joints> = {
  stand: { legs: 0, a0: 0.05, a1: 0.05, z0: -0.22, z1: 0.22, head: 0, lean: 0, eye: 1, tilt: 0 },
  sleep: { legs: -1.45, a0: -0.3, a1: -0.3, z0: -0.08, z1: 0.08, head: -0.2, lean: -0.18, eye: 0.05, tilt: 0.26 },
  type: { legs: -1.5, a0: -1.25, a1: -1.25, z0: 0.3, z1: -0.3, head: 0.08, lean: 0.07, eye: 1, tilt: 0 },
  lean: { legs: -1.3, a0: -3.3, a1: -3.3, z0: -0.6, z1: 0.6, head: -0.22, lean: -0.24, eye: 0.62, tilt: 0 },
  sit: { legs: -1.45, a0: -0.55, a1: -0.55, z0: 0.12, z1: -0.12, head: 0.12, lean: 0.08, eye: 0.85, tilt: 0 },
  lounge: { legs: -1.4, a0: -0.35, a1: -0.35, z0: -0.32, z1: 0.32, head: -0.16, lean: -0.16, eye: 0.7, tilt: 0.06 },
  wave: { legs: 0, a0: 0.05, a1: -0.25, z0: -0.28, z1: 2.55, head: -0.14, lean: -0.05, eye: 1.12, tilt: 0 },
  relax: { legs: 0, a0: 0.05, a1: -2.6, z0: -0.28, z1: 0.55, head: -0.2, lean: -0.06, eye: 0.7, tilt: 0 },
  run: { legs: 0, a0: -0.7, a1: -0.7, z0: -0.12, z1: 0.12, head: -0.04, lean: 0.14, eye: 1, tilt: 0 },
  wait: { legs: 0, a0: -0.42, a1: -0.42, z0: -0.1, z1: 0.1, head: -0.1, lean: -0.03, eye: 1, tilt: 0 },
  smoke: { legs: 0, a0: 0.3, a1: -0.95, z0: -0.72, z1: -0.3, head: -0.06, lean: -0.05, eye: 0.8, tilt: 0.06 },
}
export const seated: Record<Activity, Joints> = {
  read: { legs: -1.4, a0: -1.05, a1: -1.05, z0: 0.3, z1: -0.3, head: 0.2, lean: -0.1, eye: 0.72, tilt: 0 },
  sip: { legs: -1.4, a0: -0.35, a1: -1.85, z0: -0.32, z1: -0.5, head: -0.06, lean: -0.14, eye: 0.8, tilt: 0.04 },
  phone: { legs: -1.4, a0: -0.85, a1: -0.85, z0: 0.22, z1: -0.22, head: 0.32, lean: -0.08, eye: 0.8, tilt: 0 },
  gaze: { legs: -1.4, a0: -0.3, a1: -0.3, z0: -0.34, z1: 0.34, head: -0.36, lean: -0.2, eye: 0.95, tilt: -0.08 },
}

export const dozes: readonly Joints[] = [
  pose.sleep,
  { ...pose.sleep, tilt: -0.26 },
  { ...pose.sleep, head: 0.12, lean: -0.26, tilt: 0.08 },
]

const jointKeys = Object.keys(pose.stand) as (keyof Joints)[]

export interface Anim extends Joints {
  v: Record<string, number>
  y: number
  cyc: number
  turn: number
  gx: number
  gy: number
}

export interface Cig {
  stick: THREE.Group
  tip: THREE.MeshStandardMaterial
  puffs: { m: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; age: number; from: THREE.Vector3 }[]
  breath: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
}

export interface Mini {
  b: Blob
  s: number
  nb: number
  ba: number
  o: number
}

export interface Character {
  body: Blob
  walker: Walker
  anim: Anim
  ring: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  folder: THREE.Group
  held: number
  disc: THREE.Mesh
  proxy: THREE.Mesh
  minis: Mini[]
  cig?: Cig
  chipAt: THREE.Vector3
  ph: number
  nextBlink: number
  blinkAt: number
  gazeAt: number
  gtx: number
  gty: number
  born: number
  out: number
  rr: number
  props?: Partial<Record<Activity, THREE.Object3D>>
}

export interface Target {
  p: THREE.Vector3
  face: number | null
  pose: PoseName
  y: number
  home: boolean
  homeKind: 'desk' | 'gym' | 'none'
  parked: boolean
  needs: boolean
  folder: boolean
  subs: number
  doze?: number
  miniCentre?: THREE.Vector3
}

const ease = (u: number) => u * u * (3 - 2 * u)
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
function spring(a: Anim, k: 'y' | 'turn' | keyof Joints, to: number, dt: number, w: number) {
  const v = a.v[k] ?? 0
  a.v[k] = v + (w * w * (to - a[k]) - 2 * w * v) * dt
  a[k] += a.v[k] * dt
}

export type Kit = ReturnType<typeof createKit>

export function createKit(scene: THREE.Scene) {
  const eyeTex = (() => {
    const { x, t } = canvasTex(256, 128)
    x.fillStyle = '#fff'
    x.fillRect(0, 0, 256, 128)
    x.fillStyle = '#16181D'
    x.beginPath()
    x.ellipse(64, 68, 21, 23, 0, 0, Math.PI * 2)
    x.fill()
    x.fillStyle = '#fff'
    x.beginPath()
    x.arc(57, 58, 7, 0, Math.PI * 2)
    x.fill()
    x.globalAlpha = 0.9
    x.beginPath()
    x.arc(71, 78, 3.2, 0, Math.PI * 2)
    x.fill()
    t.wrapS = THREE.RepeatWrapping
    t.anisotropy = 4
    return t
  })()
  const profile = new THREE.SplineCurve([[0, 0], [0.15, 0.008], [0.24, 0.05], [0.285, 0.14], [0.278, 0.25], [0.235, 0.345], [0.16, 0.42], [0.07, 0.455], [0, 0.46]].map(([a, b]) => new THREE.Vector2(a, b)))
    .getPoints(24)
    .map((p) => new THREE.Vector2(Math.max(0, p.x), p.y))
  const geo = {
    body: new THREE.LatheGeometry(profile, 32),
    head: new THREE.SphereGeometry(0.34, 36, 26),
    eye: new THREE.SphereGeometry(0.1, 24, 16),
    blush: new THREE.SphereGeometry(0.05, 16, 10),
    arm: mergeGeometries([new THREE.CapsuleGeometry(0.05, 0.1, 4, 12).translate(0, -0.08, 0), new THREE.SphereGeometry(0.062, 16, 12).translate(0, -0.17, 0)]),
    leg: mergeGeometries([new THREE.CapsuleGeometry(0.064, 0.05, 4, 12).translate(0, -0.06, 0), new THREE.SphereGeometry(0.075, 16, 12).scale(1, 0.58, 1.35).translate(0, -0.13, 0.03)]),
  }
  const shared = new Map<string, THREE.Material>()
  const memo = <T extends THREE.Material>(k: string, f: () => T) => {
    if (!shared.has(k)) shared.set(k, f())
    return shared.get(k) as T
  }
  const ringTex = (() => {
    const { x, t } = canvasTex(256, 256)
    const g = x.createRadialGradient(128, 128, 30, 128, 128, 114)
    g.addColorStop(0, 'rgba(255,255,255,.04)')
    g.addColorStop(1, 'rgba(255,255,255,.26)')
    x.fillStyle = g
    x.beginPath()
    x.arc(128, 128, 114, 0, Math.PI * 2)
    x.fill()
    x.strokeStyle = '#fff'
    x.lineWidth = 19
    x.beginPath()
    x.arc(128, 128, 117, 0, Math.PI * 2)
    x.stroke()
    return t
  })()
  const discTex = (() => {
    const { x, t } = canvasTex(128, 128)
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 62)
    g.addColorStop(0, 'rgba(0,0,0,.5)')
    g.addColorStop(0.5, 'rgba(0,0,0,.2)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    x.fillStyle = g
    x.fillRect(0, 0, 128, 128)
    return t
  })()
  const ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)
  const discGeo = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2)
  const discM = new THREE.MeshBasicMaterial({ map: discTex, transparent: true, depthWrite: false, color: 0x1b2130 })
  const proxyGeo = new THREE.CylinderGeometry(0.36, 0.36, 1.3, 8).translate(0, 0.62, 0)
  const proxyM = new THREE.MeshBasicMaterial()
  const puffGeo = new THREE.SphereGeometry(0.05, 10, 8)
  const paperGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.17, 8)
  const emberGeo = new THREE.CylinderGeometry(0.021, 0.021, 0.025, 8)
  const puffM = () => new THREE.MeshBasicMaterial({ color: 0xaeb5bf, transparent: true, opacity: 0, depthWrite: false })

  function cig(c: Character): Cig {
    const stick = new THREE.Group()
    stick.position.set(0.03, -0.21, 0.03)
    stick.rotation.set(0, -0.5, -Math.PI / 2)
    const paper = new THREE.Mesh(paperGeo, memo('cig', () => new THREE.MeshStandardMaterial({ color: 0xf6f3ee, roughness: 0.8 })))
    paper.position.y = 0.06
    const tip = new THREE.MeshStandardMaterial({ color: 0x3a2a22, emissive: 0xff5a1f, emissiveIntensity: 0.6 })
    const ember = new THREE.Mesh(emberGeo, tip)
    ember.position.y = 0.155
    stick.add(paper, ember)
    c.body.arms[1]!.add(stick)
    const puffs = Array.from({ length: 5 }, (_, j) => ({ m: new THREE.Mesh(puffGeo, puffM()), age: j / 5, from: new THREE.Vector3() }))
    const breath = new THREE.Mesh(puffGeo, puffM())
    scene.add(breath, ...puffs.map((p) => p.m))
    return { stick, tip, puffs, breath }
  }
  const folderGeo = mergeGeometries([new THREE.BoxGeometry(0.46, 0.36, 0.022), new THREE.BoxGeometry(0.16, 0.05, 0.022).translate(-0.13, 0.2, 0)]).translate(0, 0.14, 0)
  const sheetGeo = new THREE.BoxGeometry(0.4, 0.3, 0.014).translate(0, 0.2, 0)
  const folderM = new THREE.MeshStandardMaterial({ color: 0xf2a922, roughness: 0.7 })
  const paperM = new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.8 })

  function part(g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D) {
    const o = new THREE.Mesh(g, m)
    o.receiveShadow = true
    p.add(o)
    return o
  }

  function blob(color: number, small = false): Blob {
    const m = small ? memo('mn' + color, () => new THREE.MeshStandardMaterial({ color, roughness: 0.6 })) : new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
    const g = new THREE.Group()
    scene.add(g)
    const hips = new THREE.Group()
    hips.position.y = 0.17
    g.add(hips)
    const legs = [-1, 1].map((s) => {
      const p = new THREE.Group()
      p.position.set(s * 0.1, 0, 0)
      part(geo.leg, m, p)
      hips.add(p)
      return p
    })
    const body = part(geo.body, m, hips)
    body.position.y = -0.07
    const hp = new THREE.Group()
    hp.position.y = 0.36
    hips.add(hp)
    const head = part(geo.head, m, hp)
    head.position.y = 0.27
    head.scale.set(1.04, 0.96, 1)
    const tex = small ? eyeTex : eyeTex.clone()
    const em = small ? memo('me', () => new THREE.MeshStandardMaterial({ map: eyeTex, roughness: 0.45 })) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 })
    const eyes = [-1, 1].map((s) => {
      const e = part(geo.eye, em, hp)
      e.position.set(s * 0.122, 0.3, 0.284)
      e.scale.set(1, 1.22, 0.5)
      return e
    })
    if (!small) {
      const bm = memo('bl' + color, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xff7f9a), 0.42), roughness: 0.6 }))
      for (const s of [-1, 1]) {
        const b = part(geo.blush, bm, hp)
        b.position.set(s * 0.205, 0.185, 0.255)
        b.scale.set(1.3, 0.6, 0.35)
        b.rotation.y = s * 0.6
      }
    }
    const arms = [-1, 1].map((s) => {
      const p = new THREE.Group()
      p.position.set(s * 0.27, 0.3, 0)
      part(geo.arm, m, p)
      hips.add(p)
      return p
    })
    return { g, hips, legs, arms, hp, body, eyes, tex, m }
  }

  function create(color: number, at: THREE.Vector3, walker: Walker, spawn: boolean, rnd: () => number): Character {
    const body = blob(color)
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false }))
    ring.renderOrder = 1
    const disc = new THREE.Mesh(discGeo, discM)
    scene.add(ring, disc)
    const proxy = new THREE.Mesh(proxyGeo, proxyM)
    proxy.visible = false
    body.g.add(proxy)
    body.g.position.copy(at)
    const folder = new THREE.Group()
    folder.add(new THREE.Mesh(sheetGeo, paperM), new THREE.Mesh(folderGeo, folderM))
    folder.position.set(0.5, 0.5, 0.08)
    folder.rotation.set(-0.35, -0.3, -0.12)
    folder.scale.setScalar(0.001)
    folder.visible = false
    body.hips.add(folder)
    return {
      body, walker, ring, disc, proxy, folder, held: 0, minis: [], chipAt: new THREE.Vector3(at.x, 1.42, at.z),
      anim: { v: {}, y: 0, cyc: 0, turn: 0, gx: 0, gy: 0, ...pose.stand },
      ph: rnd() * 6, nextBlink: 1 + rnd() * 3, blinkAt: -9, gazeAt: 0, gtx: 0, gty: 0, born: spawn ? 0 : 1, out: 0, rr: 0.4,
    }
  }

  const heldGeo = {
    read: new THREE.BoxGeometry(0.2, 0.15, 0.035),
    phone: new THREE.BoxGeometry(0.075, 0.13, 0.015),
    sip: new THREE.CylinderGeometry(0.04, 0.035, 0.08, 12),
  }
  const heldM = {
    read: new THREE.MeshStandardMaterial({ color: 0x9a7b62, roughness: 0.85 }),
    phone: new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.5 }),
    sip: new THREE.MeshStandardMaterial({ color: 0xf1ede6, roughness: 0.6 }),
  }
  const heldAt: Record<'read' | 'phone' | 'sip', [number, number, number, number]> = {
    read: [-0.12, -0.2, 0.06, 1.05],
    phone: [-0.1, -0.2, 0.05, 0.85],
    sip: [-0.02, -0.21, 0.02, 1.85],
  }

  function hold(c: Character, act: Activity | undefined) {
    for (const [k, o] of Object.entries(c.props ?? {})) o.visible = k === act
    if (!act || act === 'gaze' || c.props?.[act]) return
    const [x, y, z, rx] = heldAt[act]
    const o = new THREE.Mesh(heldGeo[act], heldM[act])
    o.position.set(x, y, z)
    o.rotation.x = rx
    o.castShadow = true
    c.body.arms[1]!.add(o)
    ;(c.props ??= {})[act] = o
  }

  function settle(c: Character, t: Target) {
    Object.assign(c.anim, pose[t.pose])
    c.anim.y = t.y
  }

  function tint(c: Character, color: number, dim: boolean) {
    c.body.m.color.set(color)
    if (dim) c.body.m.color.lerp(new THREE.Color(0xcbcfd5), 0.55)
  }

  function dispose(c: Character) {
    scene.remove(c.body.g, c.ring, c.disc)
    c.minis.forEach((m) => scene.remove(m.b.g))
    if (c.cig) {
      for (const m of [c.cig.breath, ...c.cig.puffs.map((p) => p.m)]) {
        scene.remove(m)
        m.material.dispose()
      }
      c.cig.tip.dispose()
    }
    c.body.m.dispose()
    c.body.tex.dispose()
    ;(c.body.eyes[0]!.material as THREE.Material).dispose()
    c.ring.material.dispose()
  }

  return { create, settle, tint, dispose, blob, cig, hold, colourMini: (color: number) => lighten(color, 0.4).getHex() }
}

export interface Frame {
  dt: number
  t: number
  motion: number
  faceCamera: (p: THREE.Vector3) => number
  route: (from: THREE.Vector3, to: THREE.Vector3) => THREE.Vector3[]
  looking: boolean
  dim: boolean
  gone: boolean
}

export function animate(c: Character, T: Target, kit: Kit, colour: number, f: Frame): boolean {
  const { dt, t, motion: am } = f
  const b = c.body
  const a = c.anim
  const w = c.walker
  const rising = w.path.length > 0 && a.y > 0.05
  const walking = stepWalker(w, T.p, dt, f.route, !rising)
  if (!w.path.length) w.face += wrap((T.face ?? f.faceCamera(w.pos)) - w.face) * (1 - Math.exp(-dt * 6))
  const name: PoseName = walking || rising ? 'stand' : T.pose
  const sat = name === 'lounge' && !T.folder && !w.path.length && w.pos.distanceTo(T.p) < 0.1
  const act = sat ? activityAt(t, c.ph) : undefined
  const J = act ? seated[act] : name === 'sleep' ? (dozes[T.doze ?? 0] ?? pose.sleep) : pose[name]
  if (act || c.props) kit.hold(c, act)
  const sdt = Math.min(dt, 0.033)
  spring(a, 'y', walking || rising ? 0 : T.y, sdt, 13)
  for (const k of jointKeys) spring(a, k, J[k], sdt, 9.5)
  let lo = 0, ao = 0, bob = 0, roll = 0
  if (walking) {
    a.cyc += dt * (3 + w.speed * 4.4)
    const s = Math.sin(a.cyc)
    lo = s * 0.6
    ao = -s * 0.5
    bob = Math.abs(Math.cos(a.cyc)) * 0.045
    roll = s * 0.06
  } else if (name === 'run') {
    a.cyc += dt * 13
    const s = Math.sin(a.cyc)
    lo = s * 0.95
    ao = -s * 0.9
    bob = Math.abs(Math.cos(a.cyc)) * 0.06
    roll = s * 0.04
  }
  lo *= am
  ao *= am
  bob *= am
  roll *= am
  if (f.gone && !w.path.length && !walking && w.pos.distanceTo(T.p) < 0.3) c.out = Math.min(1, c.out + dt * 2.6)
  if (c.born < 1) {
    c.born = Math.min(1, c.born + dt * 2.2)
    const u = c.born, k = 1.9
    b.g.scale.setScalar(Math.max(0.001, 1 + (k + 1) * Math.pow(u - 1, 3) + k * Math.pow(u - 1, 2)))
  } else if (c.out) b.g.scale.setScalar(Math.max(0.001, 1 - c.out * c.out))
  b.g.position.set(w.pos.x, a.y + bob, w.pos.z)
  b.g.rotation.y = w.face
  const home = !walking && !w.path.length && T.home
  const pu = T.needs && !f.gone ? 0.5 + 0.5 * Math.sin(t * 4.2) * am : 0
  const sc = Math.min(1, b.g.scale.x)
  c.rr += ((T.parked && !f.gone ? 0.36 : home ? (T.homeKind === 'desk' ? 0.95 : 0.72) : 0.42) - c.rr) * Math.min(1, dt * 5)
  c.ring.position.set(w.pos.x, 0.016, w.pos.z)
  c.ring.scale.setScalar(c.rr * (1 + pu * 0.06) * sc)
  c.ring.material.opacity = (T.parked ? 0.4 : T.needs ? 0.6 + 0.4 * pu : 0.92) * (f.dim ? 0.22 : 1) * (1 - c.out)
  c.disc.position.set(w.pos.x, 0.011, w.pos.z)
  c.disc.scale.setScalar(sc * (home ? 1.25 : 1))
  let moved = walking || c.born < 1 || c.out > 0
  const cy = a.y + 1.42 + (name === 'sleep' ? -0.28 : 0)
  if (Math.abs(c.chipAt.x - w.pos.x) + Math.abs(c.chipAt.z - w.pos.z) + Math.abs(c.chipAt.y - cy) > 0.004) {
    c.chipAt.set(w.pos.x, cy, w.pos.z)
    moved = true
  }
  b.legs[0]!.rotation.x = a.legs + lo
  b.legs[1]!.rotation.x = a.legs - lo
  const typ = name === 'type' ? Math.sin(t * 15 + c.ph) * 0.12 * am * (Math.sin(t * 0.9 + c.ph) > -0.4 ? 1 : 0) : 0
  const rub = name === 'relax' ? Math.sin(t * 3.2) * 0.18 * am : 0
  const puffAt = (t + c.ph * 1.7) % 6.5
  const drag = name === 'smoke' && puffAt < 1.6 ? Math.sin((puffAt / 1.6) * Math.PI) : 0
  b.arms[0]!.rotation.x = a.a0 + ao + typ
  b.arms[1]!.rotation.x = a.a1 - ao - typ + rub - drag * 1.5
  b.arms[0]!.rotation.z = a.z0
  b.arms[1]!.rotation.z = a.z1 + (name === 'wave' ? Math.sin(t * 9) * 0.35 * am : 0) - drag * 0.35
  c.held += ((T.folder && !f.gone && name !== 'sleep' && name !== 'smoke' ? 1 : 0) - c.held) * Math.min(1, dt * 6)
  c.folder.visible = c.held > 0.02
  if (c.folder.visible) {
    const lift = ease(c.held)
    b.arms[1]!.rotation.x += (-0.1 - b.arms[1]!.rotation.x) * lift
    b.arms[1]!.rotation.z += (2.5 + (name === 'wave' ? 0 : Math.sin(t * 2.4 + c.ph) * 0.1 * am) - b.arms[1]!.rotation.z) * lift
    c.folder.scale.setScalar(Math.max(0.001, lift))
    c.folder.position.y = 0.5 + Math.sin(t * 2.4 + c.ph) * 0.015 * am
  }
  b.hips.rotation.set(a.lean, name === 'lean' ? Math.sin(t * 0.8 + c.ph) * 0.06 * am : 0, roll)
  b.hips.position.y = 0.17 + (name === 'wave' ? Math.abs(Math.sin(t * 4.5)) * 0.06 * am : 0)
  const br = name === 'sleep' ? Math.sin(t * 1.3 + c.ph) * 0.035 * am : Math.sin(t * 2.1 + c.ph) * (name === 'lounge' ? 0.026 : 0.018) * am
  b.body.scale.set(1 - br * 0.5, 1 + br, 1 - br * 0.5)
  const look = f.looking && !walking && name !== 'sleep' ? clamp(wrap(f.faceCamera(w.pos) - w.face), -0.55, 0.55) * 0.75 : 0
  spring(a, 'turn', look, sdt, 6)
  const exhale = name === 'smoke' && puffAt > 1.6 && puffAt < 3.4 ? (puffAt - 1.6) / 1.8 : -1
  b.hp.rotation.set(a.head + (name === 'lounge' ? Math.sin(t * 0.5 + c.ph) * 0.04 * am : 0) + (name === 'type' ? Math.sin(t * 1.7 + c.ph) * 0.03 * am : 0) + drag * 0.08 - (exhale >= 0 ? Math.sin(exhale * Math.PI) * 0.14 : 0), a.turn, a.tilt)
  if (name === 'smoke' && !c.cig) c.cig = kit.cig(c)
  if (c.cig) smoke(c, name === 'smoke' && !f.gone, drag, exhale, dt, am)
  if (t >= c.nextBlink) {
    c.blinkAt = t
    c.nextBlink = t + (Math.random() < 0.15 ? 0.3 : 2 + Math.random() * 4)
  }
  const bu = (t - c.blinkAt) / 0.15
  const ey = 1.22 * a.eye * (1 - drag * 0.45) * (bu < 1 ? 1 - Math.sin(bu * Math.PI) * 0.92 : 1)
  b.eyes[0]!.scale.y = b.eyes[1]!.scale.y = ey
  if (t > c.gazeAt) {
    c.gazeAt = t + 1.2 + Math.random() * 2.6
    c.gtx = (Math.random() - 0.5) * 0.05
    c.gty = (Math.random() - 0.5) * 0.03
  }
  const gx = look ? 0 : c.gtx
  const gy = name === 'type' ? -0.012 : look ? 0 : c.gty
  a.gx += (gx - a.gx) * Math.min(1, dt * 12)
  a.gy += (gy - a.gy) * Math.min(1, dt * 12)
  b.tex.offset.set(-a.gx, a.gy)
  const n = !walking && !w.path.length && T.miniCentre ? T.subs : 0
  while (c.minis.length < n) {
    const m = kit.blob(kit.colourMini(colour), true)
    m.g.scale.setScalar(0.001)
    c.minis.push({ b: m, s: 0, nb: 1 + Math.random() * 3, ba: -9, o: c.minis.length * 2.1 })
  }
  const centre = T.miniCentre ?? w.pos
  c.minis.forEach((m, j) => {
    m.s += ((j < n ? 1 : 0) - m.s) * Math.min(1, dt * 4)
    m.o += ((j * Math.PI * 2) / Math.max(n, 1) - m.o) * Math.min(1, dt * 3)
    m.b.g.visible = m.s > 0.02
    if (!m.b.g.visible) return
    m.b.g.scale.setScalar(Math.max(0.001, m.s) * 0.42)
    const an = t * 0.5 * am + m.o + c.ph, rx = 1.3, rz = 1.05
    m.b.g.position.set(centre.x + Math.cos(an) * rx, 0, centre.z + Math.sin(an) * rz)
    m.b.g.rotation.y = Math.atan2(-Math.sin(an) * rx, Math.cos(an) * rz)
    const s = Math.sin(t * 10 + j)
    m.b.legs[0]!.rotation.x = s * 0.6 * am
    m.b.legs[1]!.rotation.x = -s * 0.6 * am
    m.b.arms[0]!.rotation.x = -s * 0.45 * am
    m.b.arms[1]!.rotation.x = s * 0.45 * am
    m.b.hips.position.y = 0.17 + Math.abs(Math.cos(t * 10 + j)) * 0.05 * am
    if (t >= m.nb) {
      m.ba = t
      m.nb = t + 2 + Math.random() * 4
    }
    const u = (t - m.ba) / 0.15
    m.b.eyes[0]!.scale.y = m.b.eyes[1]!.scale.y = 1.22 * (u < 1 ? 1 - Math.sin(u * Math.PI) * 0.92 : 1)
  })
  return moved
}

const tipAt = new THREE.Vector3()
const mouthAt = new THREE.Vector3()

function smoke(c: Character, on: boolean, drag: number, exhale: number, dt: number, am: number) {
  const k = c.cig!
  k.stick.visible = on
  k.tip.emissiveIntensity = 0.6 + drag * 2.4
  k.breath.visible = on && exhale >= 0
  for (const p of k.puffs) p.m.visible = on
  if (!on) return
  k.stick.children[1]!.getWorldPosition(tipAt)
  for (const p of k.puffs) {
    p.age += dt / 2.6
    if (p.age >= 1) {
      p.age -= 1
      p.from.copy(tipAt)
    }
    const u = p.age
    p.m.position.set(p.from.x + Math.sin(u * 5 + p.from.x * 9) * 0.05 * am, p.from.y + u * 0.9, p.from.z)
    p.m.scale.setScalar(0.4 + u * 2)
    p.m.material.opacity = p.from.lengthSq() ? 0.55 * Math.sin(u * Math.PI) : 0
  }
  if (exhale < 0) return
  c.body.hp.localToWorld(mouthAt.set(0, 0.17, 0.34))
  const fwd = c.walker.face
  k.breath.position.set(mouthAt.x + Math.sin(fwd) * exhale * 0.35, mouthAt.y + exhale * 0.3, mouthAt.z + Math.cos(fwd) * exhale * 0.35)
  k.breath.scale.setScalar(0.8 + exhale * 3.2)
  k.breath.material.opacity = 0.65 * Math.sin(exhale * Math.PI) * (1 - exhale * 0.4)
}
