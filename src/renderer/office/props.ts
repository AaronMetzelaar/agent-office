import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { anchorsFor, benchSeats, depts, door, FZ, gymBench, gymRelax, kindOf, lounge as loungeSpots, MZ, office as OF, queueSpots, queueZ, ZC, ZF, ZL, type DeptDef, type DeptId, type SlotKind } from './layout'
import type { Nav } from './nav'

type V3 = THREE.Vector3
const V3 = THREE.Vector3

export interface CanvasTex {
  c: HTMLCanvasElement
  x: CanvasRenderingContext2D
  t: THREE.CanvasTexture
}

export interface Slot {
  dept: DeptId
  i: number
  kind: SlotKind
  bx: number
  bz: number
  g: THREE.Group
  seat: V3
  stand: V3
  bench: V3
  relax: V3
  chip: V3
  mini: V3
  screen: CanvasTex
  plate?: { tex: CanvasTex; mesh: THREE.Mesh }
  belt?: THREE.Texture
  lines: { ind: number; len: number; acc: boolean }[]
  scroll: number
}

export interface DeptScene {
  def: DeptDef
  g: THREE.Group
  gi: THREE.Group
  shell: THREE.Group
  extra: THREE.Group
  tint: THREE.MeshStandardMaterial
  tintLo: THREE.Color
  tintHi: THREE.Color
  slots: Slot[]
  width: number
  cx: number
  cz: number
}

export const hexCss = (h: number) => '#' + h.toString(16).padStart(6, '0')
export const lighten = (h: number, a: number) => new THREE.Color(h).lerp(new THREE.Color(0xffffff), a)
const q2 = (v: number) => Math.round(v * 100) / 100
const rr = (x: CanvasRenderingContext2D, X: number, Y: number, w: number, h: number, r: number) => {
  x.beginPath()
  x.roundRect(X, Y, w, h, r)
}

export function canvasTex(w: number, h: number): CanvasTex {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return { c, x: c.getContext('2d')!, t }
}

const kits = [
  ['#D7263D', '#FFFFFF', '', '', '#FFFFFF', '9'],
  ['#FFFFFF', '#1B4DB1', 'vs', '#1B4DB1', '#1B4DB1', '10'],
  ['#16181D', '#16181D', 'vs', '#F4F4F4', '#E53935', '7'],
  ['#7FC4EC', '#0E2A55', '', '', '#0E2A55', '4'],
  ['#F6C90E', '#16181D', '', '', '#16181D', '11'],
  ['#1E8E4E', '#1E8E4E', 'hoops', '#FFFFFF', '#FFFFFF', '8'],
  ['#6D1A36', '#8CC8EA', '', '', '#F2D16B', '23'],
  ['#FFFFFF', '#FFFFFF', 'sash', '#D7263D', '#16181D', '1'],
] as const
const shirtShape = [[0.36, 1], [0.15, 0.95], [0, 0.77], [0.11, 0.6], [0.22, 0.67], [0.22, 0], [0.78, 0], [0.78, 0.67], [0.89, 0.6], [1, 0.77], [0.85, 0.95], [0.64, 1]] as const

export type Office = ReturnType<typeof buildOffice>

export function buildOffice(scene: THREE.Scene, nav: Nav) {
  let seed = 20260923
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const memo = new Map<string, unknown>()
  const once = <T>(k: string, f: () => T): T => {
    if (!memo.has(k)) memo.set(k, f())
    return memo.get(k) as T
  }
  const M = (c: number, r = 0.6, m = 0) =>
    once(`m${c}_${r}_${m}`, () => {
      const x = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m })
      x.userData.bake = 1
      return x
    })
  const RB = (w: number, h: number, d: number, r = 0.03, s = 2) => once(`rb${w}_${h}_${d}_${r}_${s}`, () => new RoundedBoxGeometry(w, h, d, s, r))
  const BX = (w: number, h: number, d: number) => once(`bx${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d))
  const CY = (a: number, b: number, h: number, n = 20) => once(`cy${a}_${b}_${h}_${n}`, () => new THREE.CylinderGeometry(a, b, h, n))
  const SP = (r: number, w = 16, h = 12) => once(`sp${r}_${w}_${h}`, () => new THREE.SphereGeometry(r, w, h))
  const TO = (r: number, t: number) => once(`to${r}_${t}`, () => new THREE.TorusGeometry(r, t, 8, 20))
  const bakeM = <T extends THREE.Material>(m: T) => {
    m.userData.bake = 1
    return m
  }
  const mat = {
    wall: M(0xf4f3f0, 0.95), cap: M(0xdcdad5, 0.9), slab: M(0xe6e4df, 0.8), base: M(0xe2e0db, 0.7), wood: M(0xcda274, 0.55), woodD: M(0xa9804f, 0.6),
    white: M(0xf6f6f4, 0.45), offw: M(0xeae9e5, 0.6), paper: M(0xfbfbf9, 0.8), dark: M(0x2a2e36, 0.4), frame: M(0x3a3f48, 0.45), metal: M(0xbcc1c8, 0.32, 0.6),
    black: M(0x25282e, 0.55), chair: M(0x4a5260, 0.85), fabric: M(0x93a0ae, 0.95), fabric2: M(0xa3afbc, 0.95), leafA: M(0x3f9a55, 0.62), leafB: M(0x2e7d45, 0.66),
    leafC: M(0x5db36b, 0.6), snake: M(0x2f6b43, 0.6), snakeL: M(0x7fa85a, 0.6), sage: M(0x8db59a, 0.7), trunk: M(0x7a5a3e, 0.8), soil: M(0x3b2f28, 1), pot: M(0xefece6, 0.7),
    potD: M(0x3a3f47, 0.6), terra: M(0xc9714b, 0.8), screenOff: M(0x1e232c, 0.3), mat1: M(0x2dd4bf, 0.85), mat2: M(0xa78bfa, 0.85), mat3: M(0xfb923c, 0.85),
    teal: M(0x1f8a7e, 0.6), red: M(0xe0463c, 0.5), kraft: M(0xd6c3a0, 0.85), doormat: M(0x50565f, 1), lounge: M(0xe6dfd3, 1),
  }
  const leaves = [mat.leafA, mat.leafB, mat.leafC]
  const glassM = new THREE.MeshStandardMaterial({ color: 0xdceaff, roughness: 0.1, transparent: true, opacity: 0.2, depthWrite: false })

  const root = new THREE.Group()
  scene.add(root)
  let cur: THREE.Object3D = root
  let owner: DeptId | undefined
  let tag: string | undefined

  function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, p: THREE.Object3D = cur) {
    const o = new THREE.Mesh(g, m)
    o.position.set(x, y, z)
    o.castShadow = o.receiveShadow = true
    p.add(o)
    return o
  }
  const ms = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, p: THREE.Object3D = cur) => {
    const o = mesh(g, m, x, y, z, p)
    o.castShadow = false
    return o
  }
  function grp(x = 0, z = 0, ry = 0, p: THREE.Object3D = cur) {
    const g = new THREE.Group()
    g.position.set(x, 0, z)
    g.rotation.y = ry
    p.add(g)
    return g
  }
  function plane(w: number, h: number, m: THREE.Material, x: number, y: number, z: number, p: THREE.Object3D = cur) {
    const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m)
    o.position.set(x, y, z)
    p.add(o)
    return o
  }
  const block = (x0: number, z0: number, x1: number, z1: number, pad = 0.3) => nav.block(x0, z0, x1, z1, pad, owner, tag)
  const blockAt = (x: number, z: number, hx: number, hz: number, pad?: number) => block(x - hx, z - hz, x + hx, z + hz, pad)

  function concreteTex() {
    const CH = Math.round((1536 * ZL) / 27)
    const { x, t } = canvasTex(1536, CH)
    x.fillStyle = '#DEDDD9'
    x.fillRect(0, 0, 1536, CH)
    for (let i = 0; i < 280; i++) {
      const px = rnd() * 1536, py = rnd() * CH, r = 30 + rnd() * 190, g = x.createRadialGradient(px, py, 0, px, py, r), l = rnd() < 0.5
      g.addColorStop(0, l ? 'rgba(255,255,255,.09)' : 'rgba(110,104,96,.05)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      x.fillStyle = g
      x.fillRect(px - r, py - r, r * 2, r * 2)
    }
    const im = x.getImageData(0, 0, 1536, CH), d = im.data
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 8
      d[i]! += n
      d[i + 1]! += n
      d[i + 2]! += n
    }
    x.putImageData(im, 0, 0)
    x.fillStyle = 'rgba(150,145,137,.3)'
    for (let k = 1; k < 6; k++) x.fillRect(Math.round(k * 256) - 1, 0, 2, CH)
    for (let k = 1; k < 5; k++) x.fillRect(0, Math.round((k * CH) / 5) - 1, 1536, 2)
    t.wrapS = THREE.RepeatWrapping
    return t
  }
  function rubberTex() {
    const { x, t } = canvasTex(512, 968)
    const tw = 512 / 9, th = 968 / 17
    for (let j = 0; j < 17; j++)
      for (let i = 0; i < 9; i++) {
        const v = 150 + Math.floor(rnd() * 7)
        x.fillStyle = `rgb(${v - 8},${v},${v + 8})`
        x.fillRect(i * tw, j * th, tw + 1, th + 1)
      }
    for (let k = 0; k < 9000; k++) {
      x.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)'
      x.fillRect(rnd() * 512, rnd() * 968, 1.3, 1.3)
    }
    x.fillStyle = 'rgba(70,78,88,.3)'
    for (let i = 0; i <= 9; i++) x.fillRect(Math.round(i * tw) - 1, 0, 2, 968)
    for (let j = 0; j <= 17; j++) x.fillRect(0, Math.round(j * th) - 1, 512, 2)
    return t
  }
  function poolTex() {
    const { x, t } = canvasTex(256, 1024)
    const P = ZL / 10, X = (v: number) => ((v + 13.5) / 4) * 256, Z = (v: number) => ((v + 8.5) / ZL) * 1024, sx = 1.2, sz = -0.53
    x.filter = 'blur(5px)'
    x.fillStyle = '#fff'
    for (let k = 0; k < 10; k++) {
      const za = -8.5 + k * P + 0.1, zb = za + P - 0.2, ya = 0.9, yb = 2.2
      x.beginPath()
      x.moveTo(X(-13.5 + ya * sx), Z(za + ya * sz))
      x.lineTo(X(-13.5 + ya * sx), Z(zb + ya * sz))
      x.lineTo(X(-13.5 + yb * sx), Z(zb + yb * sz))
      x.lineTo(X(-13.5 + yb * sx), Z(za + yb * sz))
      x.closePath()
      x.fill()
    }
    return t
  }
  function carpetTex() {
    const { x, t } = canvasTex(512, 512)
    x.fillStyle = '#fff'
    x.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 16000; i++) {
      const v = rnd() < 0.5 ? 0 : 255
      x.fillStyle = `rgba(${v},${v},${v},${0.03 + rnd() * 0.05})`
      x.fillRect(rnd() * 512, rnd() * 512, 1.6, 1.6)
    }
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(4, 4)
    return t
  }

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(27, ZL), new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.9 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.z = ZC
  floor.receiveShadow = true
  root.add(floor)
  const floorMap = (floor.material as THREE.MeshStandardMaterial).map!
  const shellG = [0, 1, 2].map(() => grp(0, 0, 0, root))
  mesh(BX(1, 0.32, ZL + 0.3), mat.slab, 0, -0.165, ZC, shellG[0])
  mesh(BX(1, 2.6, 0.22), mat.wall, 0, 1.3, -8.61, shellG[1])
  mesh(BX(1, 0.012, 0.22), mat.cap, 0, 2.606, -8.61, shellG[1])
  mesh(BX(1, 0.07, 0.014), mat.base, 0, 0.035, -8.493, shellG[1])
  mesh(BX(0.22, 0.9, ZL + 0.44), mat.wall, 0, 0.45, ZC, shellG[2])
  mesh(BX(0.22, 0.012, ZL + 0.44), mat.cap, 0, 0.906, ZC, shellG[2])
  const pool = plane(4, ZL, new THREE.MeshBasicMaterial({ map: poolTex(), color: 0xffe7c2, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }), -11.5, 0.012, ZC, root)
  pool.rotation.x = -Math.PI / 2
  const WL = -13.61
  mesh(BX(0.22, 0.85, ZL + 0.44), mat.wall, WL, 0.425, ZC)
  mesh(BX(0.22, 0.35, ZL + 0.44), mat.wall, WL, 2.425, ZC)
  mesh(BX(0.22, 0.012, ZL + 0.44), mat.cap, WL, 2.606, ZC)
  for (let k = 0; k <= 10; k++) mesh(BX(0.2, 1.4, 0.07), mat.frame, WL, 1.55, -8.5 + (k * ZL) / 10)
  mesh(BX(0.2, 0.05, ZL), mat.frame, WL, 2.23, ZC)
  mesh(BX(0.32, 0.04, ZL + 0.1), mat.white, WL + 0.1, 0.87, ZC)
  plane(ZL, 1.4, glassM, WL, 1.55, ZC).rotation.y = Math.PI / 2
  mesh(RB(1.3, 0.016, 0.7, 0.008), mat.doormat, door[0], 0.008, 12.45).castShadow = false

  const carpet = carpetTex()

  function wall(x0: number, z0: number, x1: number, z1: number) {
    const w = Math.max(x1 - x0, 0.07), d = Math.max(z1 - z0, 0.07), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
    mesh(BX(w, 0.58, d), mat.white, cx, 0.29, cz)
    mesh(BX(w + 0.05, 0.035, d + 0.05), mat.wood, cx, 0.597, cz)
    block(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 0.15)
  }
  function trough(x0: number, x1: number, z: number) {
    const cx = (x0 + x1) / 2, w = x1 - x0
    mesh(RB(w, 0.46, 0.32, 0.03), mat.wood, cx, 0.23, z)
    mesh(BX(w - 0.06, 0.02, 0.26), mat.soil, cx, 0.455, z)
    for (let k = 0; k < 7; k++) mesh(SP(0.13, 10, 8), leaves[k % 3]!, x0 + 0.12 + (k * (w - 0.24)) / 6, 0.52 + (k % 2) * 0.05, z + (k % 2 ? 0.05 : -0.05)).scale.set(1, 0.72, 0.9)
    block(x0, z - 0.16, x1, z + 0.16, 0.15)
  }
  function pot(g: THREE.Object3D, r: number, h: number, m: THREE.Material) {
    mesh(CY(r, q2(r * 0.78), h, 24), m, 0, h / 2, 0, g)
    mesh(CY(q2(r * 0.9), q2(r * 0.9), 0.02, 20), mat.soil, 0, h - 0.015, 0, g)
  }
  function leafy(x: number, z: number, s = 1) {
    const g = grp(x, z, rnd() * 6)
    g.scale.setScalar(s)
    pot(g, 0.2, 0.4, mat.pot)
    mesh(CY(0.016, 0.022, 1.05, 6), mat.trunk, 0, 0.9, 0, g)
    for (let k = 0; k < 18; k++) {
      const a = k * 2.39996, h = 0.62 + k * 0.052, l = mesh(SP(0.13, 10, 8), leaves[k % 3]!, Math.cos(a) * 0.1, h, Math.sin(a) * 0.1, g)
      l.scale.set(1, 0.14, 0.62)
      l.rotation.set(0, -a, 0.3 + rnd() * 0.4)
    }
    blockAt(x, z, 0.22 * s, 0.22 * s)
  }
  function lily(x: number, z: number, s = 1, dark = false) {
    const g = grp(x, z, rnd() * 6)
    g.scale.setScalar(s)
    pot(g, 0.18, 0.3, dark ? mat.potD : mat.pot)
    for (let k = 0; k < 16; k++) {
      const a = k * 2.39996, tl = 0.45 + (k % 4) * 0.24, len = q2(0.25 + rnd() * 0.07)
      const l = mesh(SP(len, 10, 8), k % 2 ? mat.leafA : mat.leafB, Math.cos(a) * len * 0.8 * Math.cos(tl), 0.3 + len * 0.8 * Math.sin(tl), Math.sin(a) * len * 0.8 * Math.cos(tl), g)
      l.scale.set(1, 0.12, 0.38)
      l.rotation.set(0, -a, tl)
    }
    blockAt(x, z, 0.3 * s, 0.3 * s)
  }
  function snake(x: number, z: number, s = 1) {
    const g = grp(x, z, rnd() * 6)
    g.scale.setScalar(s)
    pot(g, 0.16, 0.34, mat.potD)
    for (let k = 0; k < 8; k++) {
      const a = k * 2.39996, h = q2(0.5 + rnd() * 0.35), l = mesh(CY(0.002, 0.045, h, 5), k % 3 ? mat.snake : mat.snakeL, Math.cos(a) * 0.06, 0.32 + h / 2, Math.sin(a) * 0.06, g)
      l.scale.set(1, 1, 0.35)
      l.rotation.set(Math.sin(a) * 0.16, -a, Math.cos(a) * 0.16)
    }
    blockAt(x, z, 0.2 * s, 0.2 * s)
  }
  function succ(x: number, y: number, z: number, p: THREE.Object3D = cur) {
    const g = new THREE.Group()
    g.position.set(x, y, z)
    p.add(g)
    mesh(CY(0.05, 0.04, 0.07, 14), mat.terra, 0, 0.035, 0, g)
    for (let k = 0; k < 9; k++) {
      const a = k * 2.39996, r = k < 6 ? 0.034 : 0.01, l = mesh(SP(0.028, 8, 6), mat.sage, Math.cos(a) * r, 0.08 + (k < 6 ? 0 : 0.014), Math.sin(a) * r, g)
      l.scale.set(0.7, 0.55, 1.4)
      l.rotation.y = Math.PI / 2 - a
    }
  }
  function sofa(x: number, z: number) {
    const g = grp(x, z)
    mesh(RB(2.1, 0.3, 0.85, 0.08), mat.fabric, 0, 0.25, 0, g)
    mesh(RB(2.1, 0.52, 0.24, 0.1), mat.fabric, 0, 0.56, -0.31, g)
    for (const sx of [-1, 1]) mesh(RB(0.2, 0.48, 0.85, 0.08), mat.fabric, sx * 0.95, 0.36, 0, g)
    for (const sx of [-0.43, 0.43]) mesh(RB(0.86, 0.13, 0.62, 0.06), mat.fabric2, sx, 0.45, 0.07, g)
    mesh(RB(0.4, 0.34, 0.12, 0.06), M(0xf2c14e, 0.9), -0.55, 0.63, -0.13, g).rotation.set(-0.25, 0, 0.12)
    mesh(RB(0.36, 0.3, 0.11, 0.05), M(0x3b7bff, 0.9), 0.62, 0.61, -0.14, g).rotation.set(-0.22, 0, -0.1)
    for (const sx of [-0.95, 0.95]) for (const sz of [-0.35, 0.35]) mesh(CY(0.025, 0.02, 0.1, 8), mat.woodD, sx, 0.05, sz, g)
    blockAt(x, z, 1.05, 0.43)
  }
  function coffee(x: number, z: number) {
    const g = grp(x, z)
    mesh(RB(1.1, 0.04, 0.56, 0.02), mat.wood, 0, 0.38, 0, g)
    for (const sx of [-0.48, 0.48]) for (const sz of [-0.22, 0.22]) mesh(CY(0.018, 0.015, 0.36, 8), mat.woodD, sx, 0.18, sz, g)
    succ(0.3, 0.4, 0, g)
    mesh(BX(0.3, 0.012, 0.22), M(0xeee6d8, 0.8), -0.22, 0.406, 0.02, g).rotation.y = 0.2
    mesh(BX(0.28, 0.012, 0.2), M(0x1b34ff, 0.7), -0.2, 0.418, 0, g).rotation.y = -0.1
    blockAt(x, z, 0.55, 0.28)
  }
  function printer(x: number, z: number, ry: number) {
    const g = grp(x, z, ry)
    mesh(RB(1.0, 0.62, 0.5, 0.03), mat.wood, 0, 0.31, 0, g)
    mesh(BX(0.006, 0.5, 0.006), mat.woodD, 0, 0.31, 0.251, g)
    for (const sx of [-0.06, 0.06]) mesh(CY(0.012, 0.012, 0.03, 8), mat.metal, sx, 0.45, 0.255, g).rotation.x = Math.PI / 2
    mesh(RB(0.58, 0.26, 0.44, 0.04), mat.offw, 0, 0.75, 0, g)
    mesh(RB(0.5, 0.02, 0.28, 0.008), mat.dark, 0, 0.885, -0.04, g)
    mesh(BX(0.3, 0.008, 0.22), mat.paper, 0, 0.81, 0.23, g)
    mesh(RB(0.14, 0.03, 0.08, 0.01), mat.dark, 0.18, 0.89, 0.16, g)
    mesh(SP(0.008, 6, 4), M(0x22c55e, 0.3), 0.24, 0.906, 0.16, g)
  }
  function cooler(x: number, z: number, ry = 0) {
    const g = grp(x, z, ry)
    mesh(RB(0.34, 0.95, 0.34, 0.04), mat.white, 0, 0.475, 0, g)
    mesh(RB(0.22, 0.2, 0.02, 0.01), mat.dark, 0, 0.7, 0.168, g)
    mesh(SP(0.022, 8, 6), M(0x3b7bff, 0.4), -0.05, 0.73, 0.18, g)
    mesh(SP(0.022, 8, 6), M(0xe0463c, 0.4), 0.05, 0.73, 0.18, g)
    mesh(RB(0.2, 0.02, 0.08, 0.008), mat.metal, 0, 0.6, 0.19, g)
    const bm = new THREE.MeshStandardMaterial({ color: 0x8cc4f0, roughness: 0.15, transparent: true, opacity: 0.62, depthWrite: false })
    mesh(CY(0.14, 0.14, 0.36, 24), bm, 0, 1.16, 0, g).castShadow = false
    mesh(CY(0.05, 0.05, 0.07, 12), bm, 0, 0.96, 0, g).castShadow = false
    mesh(CY(0.145, 0.145, 0.02, 24), M(0x3b7bff, 0.4), 0, 1.33, 0, g)
    blockAt(x, z, 0.2, 0.2)
  }
  function bench(x: number, z: number) {
    const g = grp(x, z)
    mesh(RB(2.8, 0.09, 0.42, 0.04), mat.teal, 0, 0.445, 0, g)
    for (const sx of [-1.25, 1.25]) mesh(RB(0.06, 0.4, 0.36, 0.02), mat.metal, sx, 0.2, 0, g)
    block(x - 1.4, z - 0.21, x + 1.4, z + 0.21)
  }
  function rack(x: number, z: number) {
    const g = grp(x, z)
    for (const y of [0.42, 0.78]) mesh(RB(0.46, 0.05, 1.7, 0.015), mat.black, 0, y, 0, g)
    for (const sz of [-0.8, 0.8]) for (const sx of [-0.18, 0.18]) mesh(RB(0.05, 0.82, 0.05, 0.015), mat.black, sx, 0.41, sz, g)
    const cs = [0xe0463c, 0x3b7bff, 0xfacc15, 0x2fb344, 0x8b5cf6]
    for (const y of [0.47, 0.83])
      for (let k = 0; k < 5; k++) {
        const z0 = -0.66 + k * 0.33, r2 = q2(0.045 + k * 0.007)
        mesh(CY(0.016, 0.016, 0.3, 8), mat.metal, 0, y + r2, z0, g).rotation.z = Math.PI / 2
        for (const e of [-0.12, 0.12]) mesh(CY(r2, r2, 0.07, 6), M(cs[k]!, 0.55), e, y + r2, z0, g).rotation.z = Math.PI / 2
      }
    blockAt(x, z, 0.25, 0.87)
  }
  function kettle(x: number, z: number, c: number, s: number) {
    const g = grp(x, z, rnd())
    g.scale.setScalar(s)
    mesh(SP(0.12, 16, 12), M(c, 0.55), 0, 0.11, 0, g).scale.set(1, 0.9, 1)
    mesh(TO(0.065, 0.016), mat.black, 0, 0.24, 0, g)
  }
  function standingBag(x: number, z: number) {
    const g = grp(x, z)
    mesh(CY(0.3, 0.34, 0.14, 24), mat.black, 0, 0.07, 0, g)
    mesh(CY(0.06, 0.08, 0.25, 12), mat.black, 0, 0.26, 0, g)
    mesh(RB(0.4, 1.0, 0.4, 0.19, 3), mat.red, 0, 0.86, 0, g)
    mesh(CY(0.2, 0.2, 0.04, 20), mat.black, 0, 1.37, 0, g)
    blockAt(x, z, 0.34, 0.34)
  }
  function plyo(x: number, z: number) {
    const g = grp(x, z, 0.15)
    mesh(RB(0.62, 0.46, 0.52, 0.03), mat.wood, 0, 0.23, 0, g)
    mesh(RB(0.54, 0.32, 0.46, 0.03), mat.woodD, 0.02, 0.62, 0, g).rotation.y = -0.2
    blockAt(x, z, 0.34, 0.32)
  }
  function towels(x: number, z: number) {
    const g = grp(x, z)
    mesh(RB(0.42, 0.9, 0.46, 0.02), mat.white, 0, 0.45, 0, g)
    for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) mesh(CY(0.06, 0.06, 0.36, 12), r ? M(0x5eead4, 0.95) : mat.paper, 0, 0.95 + r * 0.12, -0.14 + k * 0.14, g).rotation.z = Math.PI / 2
    blockAt(x, z, 0.22, 0.24)
  }

  const screenGeo = new THREE.PlaneGeometry(0.6, 0.36)
  function plate(s: Slot, w: number, h: number, x: number, y: number, z: number, rx: number) {
    const tex = canvasTex(512, 128)
    const o = plane(w, h, new THREE.MeshBasicMaterial({ map: tex.t, transparent: true }), x, y, z, s.g)
    o.rotation.x = rx
    o.visible = false
    s.plate = { tex, mesh: o }
  }
  function slotOf(d: DeptDef, i: number, x: number, z: number, g: THREE.Group, kind: SlotKind): Slot {
    const s: Slot = {
      dept: d.id, i, kind, bx: x, bz: z, g, seat: new V3(), stand: new V3(), bench: new V3(), relax: new V3(), chip: new V3(), mini: new V3(), screen: canvasTex(340, 200),
      lines: Array.from({ length: 24 }, () => ({ ind: Math.floor(rnd() * 4), len: 40 + rnd() * 170, acc: rnd() < 0.2 })), scroll: 0,
    }
    placeSlot(s, 0)
    return s
  }
  function desk(d: DeptDef, i: number, x: number, z: number): Slot {
    const g = grp(x, z), v = (i * 5 + d.id.charCodeAt(0)) % 6, s = slotOf(d, i, x, z, g, 'desk')
    mesh(RB(1.6, 0.05, 0.76, 0.02), mat.wood, 0, 0.745, 0, g)
    for (const sx of [-0.76, 0.76]) mesh(RB(0.04, 0.72, 0.7, 0.015), mat.white, sx, 0.36, 0, g)
    mesh(RB(1.48, 0.34, 0.025, 0.01), mat.white, 0, 0.53, 0.33, g)
    mesh(RB(0.4, 0.5, 0.6, 0.02), mat.white, 0.5, 0.26, -0.02, g)
    mesh(BX(0.2, 0.012, 0.008), mat.metal, 0.5, 0.44, -0.325, g)
    mesh(RB(0.64, 0.4, 0.03, 0.012), mat.white, 0, 1.07, 0.2, g)
    mesh(CY(0.018, 0.022, 0.2, 10), mat.metal, 0, 0.86, 0.23, g)
    mesh(RB(0.22, 0.012, 0.14, 0.006), mat.metal, 0, 0.776, 0.22, g)
    mesh(RB(0.4, 0.016, 0.13, 0.006), mat.white, 0, 0.778, -0.24, g)
    mesh(RB(0.06, 0.02, 0.1, 0.01), mat.white, 0.31, 0.78, -0.24, g)
    const sp = new THREE.Mesh(screenGeo, new THREE.MeshBasicMaterial({ map: s.screen.t, toneMapped: false }))
    sp.position.set(0, 1.07, 0.183)
    sp.rotation.y = Math.PI
    g.add(sp)
    if (v === 1 || v === 4) {
      const m2 = grp(-0.56, 0.12, 0.5, g)
      mesh(RB(0.5, 0.32, 0.028, 0.01), mat.white, 0, 1.02, 0, m2)
      mesh(BX(0.46, 0.28, 0.004), mat.screenOff, 0, 1.02, -0.016, m2)
      mesh(CY(0.016, 0.02, 0.16, 8), mat.metal, 0, 0.84, 0.03, m2)
      mesh(RB(0.18, 0.012, 0.12, 0.006), mat.metal, 0, 0.776, 0.02, m2)
    }
    if (v % 3 === 0) {
      const lg = grp(0.6, 0.05, -0.6, g)
      mesh(CY(0.07, 0.08, 0.02, 20), mat.black, 0, 0.78, 0, lg)
      mesh(CY(0.01, 0.01, 0.36, 6), mat.black, 0, 0.95, -0.03, lg).rotation.x = -0.18
      mesh(CY(0.01, 0.01, 0.26, 6), mat.black, 0, 1.14, 0.04, lg).rotation.x = 1.1
      mesh(CY(0.03, 0.075, 0.1, 18), mat.black, 0, 1.12, 0.15, lg).rotation.x = 0.5
    }
    if (v % 2 === 0) for (let k = 0; k < 3; k++) mesh(BX(0.21, 0.004, 0.29), k % 2 ? mat.paper : mat.offw, -0.42 + k * 0.01, 0.772 + k * 0.005, -0.1, g).rotation.y = (k - 1) * 0.09
    if (v % 3 === 1) mesh(CY(0.04, 0.036, 0.09, 14), [mat.white, mat.terra, M(0x1b34ff, 0.5)][i % 3]!, 0.62, 0.815, -0.12, g)
    if (v === 2 || v === 5) succ(-0.64, 0.77, 0.12, g)
    if (v === 3) mesh(RB(0.18, 0.016, 0.24, 0.006), M(0xe0463c, 0.7), -0.45, 0.779, -0.08, g).rotation.y = 0.25
    const ch = grp(0, -0.68, 0, g)
    mesh(RB(0.46, 0.07, 0.44, 0.03), mat.chair, 0, 0.46, 0, ch)
    mesh(RB(0.44, 0.44, 0.06, 0.03), mat.chair, 0, 0.76, -0.27, ch)
    mesh(CY(0.025, 0.025, 0.34, 10), mat.black, 0, 0.26, 0, ch)
    for (let k = 0; k < 5; k++) {
      const a = k * 1.2566
      mesh(RB(0.3, 0.025, 0.045, 0.01), mat.black, Math.sin(a) * 0.13, 0.05, Math.cos(a) * 0.13, ch).rotation.y = a - Math.PI / 2
      mesh(SP(0.022, 8, 6), mat.black, Math.sin(a) * 0.27, 0.022, Math.cos(a) * 0.27, ch)
    }
    if (d.id === 'side') plate(s, 0.84, 0.21, 0, 0.862, 0.32, -0.5)
    block(x - 0.8, z - 0.38, x + 0.8, z + 0.38)
    blockAt(x, z - 0.7, 0.25, 0.25, 0.2)
    return s
  }
  function stripeTex() {
    const { x, t } = canvasTex(64, 256)
    x.fillStyle = '#262A31'
    x.fillRect(0, 0, 64, 256)
    x.fillStyle = '#30353E'
    for (let y = 0; y < 256; y += 32) x.fillRect(0, y, 64, 9)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(1, 3)
    return t
  }
  function treadmill(d: DeptDef, i: number, x: number, z: number): Slot {
    const g = grp(x, z), s = slotOf(d, i, x, z, g, 'gym')
    mesh(RB(0.82, 0.12, 1.8, 0.04), mat.black, 0, 0.06, 0, g)
    s.belt = stripeTex()
    const belt = plane(0.62, 1.6, new THREE.MeshStandardMaterial({ map: s.belt, roughness: 0.9 }), 0, 0.123, -0.05, g)
    belt.rotation.x = -Math.PI / 2
    belt.receiveShadow = true
    for (const sx of [-0.36, 0.36]) mesh(RB(0.09, 0.03, 1.7, 0.01), mat.metal, sx, 0.125, 0, g)
    mesh(RB(0.82, 0.16, 0.3, 0.05), mat.dark, 0, 0.1, 0.8, g)
    for (const sx of [-0.37, 0.37]) {
      mesh(RB(0.05, 0.92, 0.05, 0.02), mat.metal, sx, 0.56, 0.78, g).rotation.x = -0.1
      mesh(RB(0.04, 0.04, 0.62, 0.015), mat.metal, sx, 0.93, 0.5, g)
    }
    mesh(RB(0.8, 0.06, 0.3, 0.025), mat.dark, 0, 1.0, 0.8, g).rotation.x = 0.45
    const sp = plane(0.33, 0.2, new THREE.MeshBasicMaterial({ map: s.screen.t, toneMapped: false }), 0, 1.16, 0.8, g)
    sp.rotation.set(0.3, Math.PI, 0)
    mesh(RB(0.35, 0.22, 0.012, 0.006), mat.metal, 0, 1.16, 0.806, g).rotation.set(0.3, Math.PI, 0)
    plate(s, 0.68, 0.17, 0, 1.015, 0.851, -1.12)
    blockAt(x, z, 0.42, 0.92, 0.25)
    return s
  }

  function clockFace() {
    const { x, t } = canvasTex(256, 256)
    x.fillStyle = '#fff'
    x.beginPath()
    x.arc(128, 128, 128, 0, Math.PI * 2)
    x.fill()
    x.fillStyle = '#2A2E36'
    for (let k = 0; k < 60; k++) {
      const a = (k * Math.PI) / 30, big = k % 5 === 0, r0 = big ? 100 : 108
      x.save()
      x.translate(128, 128)
      x.rotate(a)
      x.fillRect(big ? -3 : -1, -118, big ? 6 : 2, 118 - r0)
      x.restore()
    }
    return t
  }
  const hands: THREE.Group[] = []
  function wallClock(x: number, y: number) {
    mesh(CY(0.24, 0.24, 0.045, 40), mat.frame, x, y, -8.475).rotation.x = Math.PI / 2
    plane(0.42, 0.42, new THREE.MeshBasicMaterial({ map: clockFace(), transparent: true }), x, y, -8.45).renderOrder = 1
    const hm = new THREE.MeshBasicMaterial({ color: 0x2a2e36 })
    ;[[0.018, 0.11, 0.045], [0.012, 0.16, 0.07], [0.005, 0.17, 0.06]].forEach(([w, h, o], k) => {
      const g = new THREE.Group()
      g.position.set(x, y, -8.44 + k * 0.003)
      cur.add(g)
      g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.004).translate(0, o!, 0), k === 2 ? new THREE.MeshBasicMaterial({ color: 0xea580c }) : hm))
      hands.push(g)
    })
  }

  let status: CanvasTex | undefined
  function statusScreen(x: number, y: number, z: number) {
    for (const sx of [-0.86, 0.86]) {
      mesh(CY(0.025, 0.025, y + 0.5, 10), mat.metal, x + sx, (y + 0.5) / 2, z - 0.02)
      ms(BX(0.08, 0.03, 0.5), mat.dark, x + sx, 0.015, z)
    }
    mesh(RB(1.94, 1.12, 0.05, 0.02), mat.frame, x, y, z + 0.03)
    const tx = canvasTex(1400, 800)
    plane(1.86, 1.04, new THREE.MeshBasicMaterial({ map: tx.t, toneMapped: false }), x, y, z + 0.057)
    block(x - 0.95, z - 0.25, x + 0.95, z + 0.25)
    return tx
  }
  function atlasGeo(k: string, w: number, h: number, u0: number, v0: number, du: number, dv: number) {
    return once(k, () => {
      const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv!
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * du, v0 + uv.getY(i) * dv)
      return g
    })
  }
  const shirtTex = canvasTex(1024, 512)
  function drawShirts() {
    const { x, t } = shirtTex
    x.clearRect(0, 0, 1024, 512)
    kits.forEach(([b, sl, pt, pc, nc, n], i) => {
      const X0 = (i % 4) * 256 + 18, Y0 = Math.floor(i / 4) * 256 + 18, S2 = 220, P = (u: number, v: number) => [X0 + u * S2, Y0 + (1 - v) * S2] as const
      const path = () => {
        x.beginPath()
        shirtShape.forEach(([u, v], k) => {
          const [px, py] = P(u, v)
          if (k) x.lineTo(px, py)
          else x.moveTo(px, py)
        })
        const [cx, cy] = P(0.5, 0.88), [ex, ey] = P(0.36, 1)
        x.quadraticCurveTo(cx, cy, ex, ey)
        x.closePath()
      }
      x.save()
      path()
      x.clip()
      x.fillStyle = b
      x.fillRect(X0, Y0, S2, S2)
      x.fillStyle = pc
      if (pt === 'vs') for (let k = 0; k < 5; k++) x.fillRect(X0 + (0.25 + k * 0.12) * S2, Y0, 0.06 * S2, S2)
      if (pt === 'hoops') for (let k = 0; k < 6; k++) x.fillRect(X0, Y0 + (0.08 + k * 0.16) * S2, S2, 0.08 * S2)
      if (pt === 'sash') {
        x.save()
        x.translate(...P(0.5, 0.5))
        x.rotate(-0.75)
        x.fillRect(-S2, -0.08 * S2, 2 * S2, 0.16 * S2)
        x.restore()
      }
      x.fillStyle = sl
      x.fillRect(X0, Y0, 0.215 * S2, S2)
      x.fillRect(X0 + 0.785 * S2, Y0, 0.215 * S2, S2)
      x.fillStyle = 'rgba(0,0,0,.1)'
      x.fillRect(X0 + 0.215 * S2, Y0, 0.012 * S2, S2)
      x.fillRect(X0 + 0.773 * S2, Y0, 0.012 * S2, S2)
      x.fillStyle = nc
      x.font = '600 78px Geist, sans-serif'
      x.textAlign = 'center'
      x.textBaseline = 'middle'
      x.fillText(n, ...P(0.5, 0.47))
      x.restore()
      path()
      x.strokeStyle = 'rgba(20,24,32,.28)'
      x.lineWidth = 3
      x.stroke()
      x.beginPath()
      x.moveTo(...P(0.36, 1))
      x.quadraticCurveTo(...P(0.5, 0.88), ...P(0.64, 1))
      x.strokeStyle = sl === b ? pc || nc : sl
      x.lineWidth = 7
      x.stroke()
    })
    x.textAlign = 'left'
    x.textBaseline = 'alphabetic'
    t.needsUpdate = true
  }
  drawShirts()
  shirtTex.t.anisotropy = 4
  const shirtM = bakeM(new THREE.MeshStandardMaterial({ map: shirtTex.t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }))
  const shirtGeo = (i: number, w: number) => atlasGeo(`sh${i}_${w}`, w, w, ((i % 4) * 256 + 18) / 1024, 1 - (Math.floor(i / 4) * 256 + 238) / 512, 220 / 1024, 220 / 512)
  function frameShirt(x: number, y: number, i: number) {
    const z = -8.5
    ms(RB(0.66, 0.78, 0.04, 0.01), mat.frame, x, y, z + 0.02)
    ms(BX(0.58, 0.7, 0.008), mat.paper, x, y, z + 0.044)
    ms(shirtGeo(i, 0.5), shirtM, x, y + 0.03, z + 0.05)
    ms(BX(0.14, 0.028, 0.006), M(0xc8a96a, 0.4, 0.5), x, y - 0.28, z + 0.05)
  }
  function shirtRail(x0: number, x1: number, z: number, list: number[]) {
    const y = 1.5
    for (const x of [x0, x1]) {
      mesh(CY(0.018, 0.018, y, 10), mat.metal, x, y / 2, z)
      ms(RB(0.05, 0.03, 0.42, 0.01), mat.dark, x, 0.015, z)
    }
    mesh(CY(0.014, 0.014, x1 - x0 + 0.06, 10), mat.metal, (x0 + x1) / 2, y, z).rotation.z = Math.PI / 2
    list.forEach((k, i) => {
      const x = x0 + 0.3 + (i * (x1 - x0 - 0.6)) / (list.length - 1)
      ms(CY(0.004, 0.004, 0.07, 6), mat.metal, x, y - 0.04, z)
      ms(BX(0.34, 0.012, 0.012), mat.woodD, x, y - 0.08, z)
      ms(shirtGeo(k, 0.46), shirtM, x, y - 0.31, z + 0.008 * (i % 2)).rotation.y = i % 2 ? 0.06 : -0.05
    })
    block(x0 - 0.1, z - 0.22, x1 + 0.1, z + 0.22)
  }
  function turfRug(cx: number, cz: number, w: number, d: number) {
    const { c, x, t } = canvasTex(640, Math.round((640 * d) / w)), H2 = c.height
    for (let k = 0; k < 10; k++) {
      x.fillStyle = k % 2 ? '#4AA65A' : '#419C52'
      x.fillRect(k * 64, 0, 64, H2)
    }
    x.strokeStyle = 'rgba(255,255,255,.9)'
    x.lineWidth = 4
    x.strokeRect(10, 10, 620, H2 - 20)
    x.beginPath()
    x.moveTo(320, 10)
    x.lineTo(320, H2 - 10)
    x.stroke()
    x.beginPath()
    x.arc(320, H2 / 2, H2 * 0.28, 0, Math.PI * 2)
    x.stroke()
    x.strokeRect(10, H2 * 0.2, 70, H2 * 0.6)
    x.strokeRect(560, H2 * 0.2, 70, H2 * 0.6)
    x.fillStyle = '#fff'
    x.beginPath()
    x.arc(320, H2 / 2, 4, 0, Math.PI * 2)
    x.fill()
    ms(new THREE.PlaneGeometry(w, d), bakeM(new THREE.MeshStandardMaterial({ map: t, roughness: 1 })), cx, 0.007, cz).rotation.x = -Math.PI / 2
  }
  const auction = canvasTex(512, 296)
  let auctionSeconds = 134
  function drawAuction() {
    const { x, t } = auction, m = Math.floor(auctionSeconds / 60), sec = auctionSeconds % 60
    x.fillStyle = '#0F1424'
    x.fillRect(0, 0, 512, 296)
    x.fillStyle = '#EF4444'
    x.beginPath()
    x.arc(30, 32, 7, 0, Math.PI * 2)
    x.fill()
    x.fillStyle = '#FCA5A5'
    x.font = '500 17px "JetBrains Mono", monospace'
    x.fillText('LIVE AUCTION', 46, 38)
    x.fillStyle = '#7D87A6'
    x.textAlign = 'right'
    x.fillText('lot 1302', 490, 38)
    x.textAlign = 'left'
    x.fillStyle = '#161C30'
    rr(x, 22, 62, 150, 180, 14)
    x.fill()
    x.drawImage(shirtTex.c, 18, 18, 220, 220, 32, 82, 130, 130)
    x.fillStyle = '#fff'
    x.font = '600 25px Geist, sans-serif'
    x.fillText('Match-worn home shirt', 192, 92)
    x.fillStyle = '#8E97B2'
    x.font = '400 17px Geist, sans-serif'
    x.fillText('2023/24 · #9 · signed', 192, 120)
    x.fillStyle = '#7D87A6'
    x.font = '500 14px "JetBrains Mono", monospace'
    x.fillText('CURRENT BID', 192, 164)
    x.fillStyle = '#fff'
    x.font = '600 46px Geist, sans-serif'
    x.fillText('€1,240', 190, 212)
    x.fillStyle = '#8E97B2'
    x.font = '500 16px "JetBrains Mono", monospace'
    x.fillText(`12 bids · ends in ${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`, 192, 240)
    x.fillStyle = '#232B45'
    rr(x, 22, 262, 468, 10, 5)
    x.fill()
    x.fillStyle = '#1B34FF'
    rr(x, 22, 262, 468 * (1 - auctionSeconds / 300), 10, 5)
    x.fill()
    t.needsUpdate = true
  }
  function auctionWall(x: number, y: number) {
    ms(RB(1.52, 0.92, 0.05, 0.02), mat.frame, x, y, -8.475)
    drawAuction()
    plane(1.44, 0.83, new THREE.MeshBasicMaterial({ map: auction.t, toneMapped: false }), x, y, -8.447)
  }
  function podium(x: number, z: number) {
    const g = grp(x, z)
    mesh(RB(0.6, 0.92, 0.44, 0.03), mat.wood, 0, 0.46, 0, g)
    ms(BX(0.5, 0.07, 0.005), M(0x1b34ff, 0.6), 0, 0.72, 0.222, g)
    mesh(RB(0.68, 0.04, 0.5, 0.01), mat.woodD, 0, 0.95, 0, g).rotation.x = 0.22
    ms(CY(0.011, 0.011, 0.24, 8), mat.woodD, 0.05, 1.02, 0.02, g).rotation.z = Math.PI / 2.3
    ms(CY(0.034, 0.034, 0.1, 14), mat.woodD, -0.07, 1.06, 0.02, g).rotation.x = Math.PI / 2
    ms(CY(0.055, 0.055, 0.025, 16), mat.woodD, -0.16, 1.0, 0.06, g)
    blockAt(x, z, 0.34, 0.26)
  }
  const devTex = canvasTex(1024, 512)
  function drawApp(x: CanvasRenderingContext2D, X: number, Y: number, w: number, h: number, v: number) {
    const s = w / 128
    x.save()
    x.beginPath()
    x.rect(X, Y, w, h)
    x.clip()
    if (v === 3) {
      const g = x.createLinearGradient(0, Y, 0, Y + h)
      g.addColorStop(0, '#1D2A5C')
      g.addColorStop(1, '#101528')
      x.fillStyle = g
      x.fillRect(X, Y, w, h)
      x.fillStyle = '#fff'
      x.font = `600 ${34 * s}px Geist, sans-serif`
      x.textAlign = 'center'
      x.fillText('9:41', X + w / 2, Y + 60 * s)
      x.textAlign = 'left'
      for (let k = 0; k < 3; k++) {
        x.fillStyle = 'rgba(255,255,255,.88)'
        rr(x, X + 8 * s, Y + (92 + k * 38) * s, w - 16 * s, 32 * s, 8 * s)
        x.fill()
        x.fillStyle = k ? '#9CA3AF' : '#1B34FF'
        rr(x, X + 14 * s, Y + (99 + k * 38) * s, 18 * s, 18 * s, 5 * s)
        x.fill()
        x.fillStyle = '#374151'
        x.fillRect(X + 38 * s, Y + (102 + k * 38) * s, (50 + k * 9) * s, 4 * s)
        x.fillStyle = '#9CA3AF'
        x.fillRect(X + 38 * s, Y + (110 + k * 38) * s, 40 * s, 3 * s)
      }
      x.restore()
      return
    }
    x.fillStyle = v === 2 ? '#FFFFFF' : '#F4F6FA'
    x.fillRect(X, Y, w, h)
    x.fillStyle = '#1B34FF'
    x.fillRect(X, Y, w, 30 * s)
    x.fillStyle = 'rgba(255,255,255,.9)'
    rr(x, X + 8 * s, Y + 11 * s, 34 * s, 8 * s, 4 * s)
    x.fill()
    if (v === 0) {
      for (let k = 0; k < 6; k++) {
        const cx = X + (6 + (k % 2) * 60) * s, cy = Y + (38 + Math.floor(k / 2) * 72) * s
        x.fillStyle = '#fff'
        rr(x, cx, cy, 56 * s, 66 * s, 6 * s)
        x.fill()
        x.drawImage(shirtTex.c, (k % 4) * 256 + 18, Math.floor(k / 4) * 256 + 18, 220, 220, cx + 10 * s, cy + 4 * s, 36 * s, 36 * s)
        x.fillStyle = '#374151'
        x.fillRect(cx + 6 * s, cy + 46 * s, 34 * s, 4 * s)
        x.fillStyle = '#1B34FF'
        x.fillRect(cx + 6 * s, cy + 55 * s, 22 * s, 4 * s)
      }
    } else if (v === 1) {
      x.fillStyle = '#fff'
      x.fillRect(X, Y + 30 * s, w, 110 * s)
      x.drawImage(shirtTex.c, 274, 18, 220, 220, X + 24 * s, Y + 36 * s, 80 * s, 80 * s)
      x.fillStyle = '#111827'
      x.fillRect(X + 10 * s, Y + 150 * s, 80 * s, 6 * s)
      x.fillStyle = '#6B7280'
      x.fillRect(X + 10 * s, Y + 162 * s, 56 * s, 4 * s)
      x.fillStyle = '#111827'
      x.font = `600 ${20 * s}px Geist, sans-serif`
      x.fillText('€1,240', X + 10 * s, Y + 196 * s)
      x.fillStyle = '#1B34FF'
      rr(x, X + 10 * s, Y + 212 * s, w - 20 * s, 28 * s, 8 * s)
      x.fill()
      x.fillStyle = '#fff'
      x.font = `600 ${12 * s}px Geist, sans-serif`
      x.textAlign = 'center'
      x.fillText('Place bid', X + w / 2, Y + 230 * s)
      x.textAlign = 'left'
    } else {
      x.fillStyle = '#111827'
      x.font = `600 ${30 * s}px Geist, sans-serif`
      x.textAlign = 'center'
      x.fillText('02:14', X + w / 2, Y + 92 * s)
      x.fillStyle = '#6B7280'
      x.font = `${11 * s}px Geist, sans-serif`
      x.fillText('until the lot closes', X + w / 2, Y + 112 * s)
      x.textAlign = 'left'
      for (let k = 0; k < 4; k++) {
        x.fillStyle = k ? '#F4F6FA' : '#EEF0FF'
        rr(x, X + 8 * s, Y + (130 + k * 30) * s, w - 16 * s, 24 * s, 6 * s)
        x.fill()
        x.fillStyle = k ? '#9CA3AF' : '#1B34FF'
        x.fillRect(X + 16 * s, Y + (140 + k * 30) * s, (60 - k * 6) * s, 4 * s)
      }
    }
    x.restore()
  }
  {
    const { x, t } = devTex
    x.fillStyle = '#000'
    x.fillRect(0, 0, 1024, 512)
    for (let i = 0; i < 8; i++) drawApp(x, i * 128, 0, 128, 256, i % 4)
    for (let i = 0; i < 4; i++) drawApp(x, i * 256, 256, 256, 256, [0, 1, 2, 0][i]!)
    t.needsUpdate = true
  }
  const devM = bakeM(new THREE.MeshBasicMaterial({ map: devTex.t, toneMapped: false }))
  const phoneGeo = (i: number) => atlasGeo(`ph${i}`, 0.13, 0.26, (i * 128) / 1024, 0.5, 128 / 1024, 0.5)
  const tabGeo = (i: number) => atlasGeo(`tb${i}`, 0.34, 0.25, (i * 256) / 1024, 0.04, 256 / 1024, 0.4)
  function phone(x: number, y: number, z: number, i: number, p: THREE.Object3D = cur, rx = 0) {
    const g = new THREE.Group()
    g.position.set(x, y, z)
    g.rotation.x = rx
    p.add(g)
    ms(RB(0.15, 0.29, 0.014, 0.012), mat.black, 0, 0, 0, g)
    ms(phoneGeo(i % 8), devM, 0, 0, 0.0075, g)
  }
  function deviceWall(cx: number, y: number) {
    const z = -8.5
    ms(RB(3.0, 1.3, 0.03, 0.01), M(0xe2e6eb, 0.8), cx, y, z + 0.015)
    for (let k = 0; k < 7; k++) phone(cx - 1.2 + k * 0.4, y + 0.3, z + 0.04, k)
    for (let k = 0; k < 3; k++) {
      const tx = cx - 1.05 + k * 0.5
      ms(RB(0.37, 0.28, 0.014, 0.012), mat.black, tx, y - 0.25, z + 0.04)
      ms(tabGeo(k), devM, tx, y - 0.25, z + 0.048)
    }
    for (let k = 0; k < 3; k++) phone(cx + 0.55 + k * 0.3, y - 0.25, z + 0.04, k + 3)
    for (const dy of [0.11, -0.44]) ms(BX(2.8, 0.02, 0.06), mat.white, cx, y + dy, z + 0.04)
  }
  function bigPhone(x: number, z: number) {
    const g = grp(x, z)
    g.rotation.x = -0.07
    mesh(RB(0.72, 1.44, 0.09, 0.07), mat.black, 0, 0.74, 0, g)
    const big = canvasTex(256, 512)
    drawApp(big.x, 0, 0, 256, 512, 1)
    plane(0.64, 1.3, new THREE.MeshBasicMaterial({ map: big.t, toneMapped: false }), 0, 0.76, 0.047, g)
    ms(BX(0.012, 0.14, 0.03), mat.black, 0.366, 1.12, 0, g)
    blockAt(x, z, 0.4, 0.12)
  }
  function dock(x: number, z: number) {
    const g = grp(x, z)
    mesh(RB(1.1, 0.62, 0.42, 0.02), mat.white, 0, 0.31, 0, g)
    ms(RB(1.14, 0.04, 0.44, 0.01), mat.wood, 0, 0.64, 0, g)
    ms(RB(0.84, 0.05, 0.1, 0.02), mat.dark, 0, 0.685, 0.04, g)
    for (let k = 0; k < 4; k++) {
      phone(-0.3 + k * 0.2, 0.84, 0.02, k + 4, g, -0.18)
      ms(SP(0.008, 6, 4), M(0x22c55e, 0.3), -0.3 + k * 0.2, 0.7, 0.093, g)
    }
    blockAt(x, z, 0.58, 0.24)
  }
  const leds: [number, number, number][] = []
  function racks(x0: number, z: number, n: number) {
    for (let r = 0; r < n; r++) {
      const x = x0 + r * 0.64
      mesh(RB(0.6, 1.9, 0.85, 0.02), M(0x2a2f38, 0.5), x, 0.95, z)
      ms(BX(0.52, 1.8, 0.01), M(0x1d2129, 0.45), x, 0.95, z + 0.426)
      for (let u = 0; u < 9; u++) {
        ms(BX(0.48, 0.008, 0.004), mat.frame, x, 0.2 + u * 0.19, z + 0.433)
        for (let l = 0; l < 3; l++) leds.push([x - 0.2 + l * 0.045, 0.27 + u * 0.19, z + 0.436])
      }
      ms(BX(0.4, 0.02, 0.3), mat.frame, x, 1.905, z)
    }
    const w = n * 0.64
    for (const dz of [-0.16, 0.16]) ms(BX(w, 0.03, 0.02), mat.metal, x0 + w / 2 - 0.32, 1.95, z + dz)
    for (let k = 0; k <= n * 3; k++) ms(BX(0.02, 0.02, 0.32), mat.metal, x0 - 0.3 + (k * (w - 0.04)) / (n * 3), 1.95, z)
    ;[0x3b7bff, 0xfacc15, 0x9ca3af].forEach((c, i) => {
      ms(CY(0.02, 0.02, w - 0.05, 8), M(c, 0.7), x0 + w / 2 - 0.32, 1.985, z - 0.08 + i * 0.08).rotation.z = Math.PI / 2
    })
    block(x0 - 0.32, z - 0.43, x0 + w - 0.32, z + 0.43)
  }
  const raceway = (x0: number, z0: number, x1: number, z1: number) => ms(BX(Math.max(0.14, Math.abs(x1 - x0)), 0.022, Math.max(0.14, Math.abs(z1 - z0))), M(0x4a505a, 0.8), (x0 + x1) / 2, 0.011, (z0 + z1) / 2)
  function cabinet(x: number, z: number) {
    const g = grp(x, z)
    mesh(RB(0.5, 1.3, 0.6, 0.02), M(0xc9d0d8, 0.55), 0, 0.65, 0, g)
    for (let k = 0; k < 4; k++) {
      const y = 0.2 + k * 0.31
      ms(BX(0.44, 0.27, 0.01), M(0xd9dfe6, 0.5), 0, y, 0.302, g)
      ms(BX(0.12, 0.02, 0.02), mat.dark, 0, y + 0.06, 0.312, g)
      ms(BX(0.09, 0.045, 0.004), mat.paper, 0, y - 0.05, 0.31, g)
    }
    blockAt(x, z, 0.26, 0.31)
  }
  function easel(x: number, z: number, ry: number) {
    const g = grp(x, z, ry)
    g.scale.setScalar(1.25)
    for (const s of [-1, 1]) mesh(BX(0.035, 1.62, 0.035), mat.woodD, s * 0.26, 0.8, 0, g).rotation.z = s * 0.13
    mesh(BX(0.035, 1.6, 0.035), mat.woodD, 0, 0.78, -0.28, g).rotation.x = -0.34
    ms(BX(0.72, 0.03, 0.09), mat.woodD, 0, 0.78, 0.03, g)
    const { x: X, t } = canvasTex(320, 256)
    X.fillStyle = '#F7F7F4'
    X.fillRect(0, 0, 320, 256)
    for (let i = 0; i < 20; i++)
      for (let j = 0; j < 16; j++) {
        const px = 12 + i * 15.5, py = 12 + j * 15.5, d = Math.hypot(px - 200, py - 110), r = Math.max(0.8, 5.6 - d / 32)
        X.fillStyle = d < 70 ? '#1B34FF' : '#AAB3F5'
        X.beginPath()
        X.arc(px, py, r, 0, Math.PI * 2)
        X.fill()
      }
    mesh(RB(0.74, 0.58, 0.025, 0.008), mat.white, 0, 1.12, 0.03, g).rotation.x = -0.1
    plane(0.68, 0.53, bakeM(new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 })), 0, 1.12, 0.046, g).rotation.x = -0.1
    blockAt(x, z, 0.4, 0.3)
  }
  function swatches(x: number, z: number) {
    const g = grp(x, z, 0.3)
    mesh(RB(0.52, 0.6, 0.4, 0.02), mat.white, 0, 0.3, 0, g)
    ;[0x1b34ff, 0xf2994a, 0x111827, 0xe8e4dc, 0x15a34a, 0xf25ca2].forEach((c, i) => {
      ms(BX(0.05, 0.006, 0.26), M(c, 0.7), -0.02 + i * 0.012, 0.605 + i * 0.004, 0.02, g).rotation.y = -0.6 + i * 0.24
    })
    ms(CY(0.04, 0.035, 0.1, 12), mat.terra, 0.16, 0.65, -0.08, g)
    for (let k = 0; k < 3; k++) ms(CY(0.005, 0.005, 0.16, 5), mat.woodD, 0.16 + (k - 1) * 0.015, 0.74, -0.08, g).rotation.z = (k - 1) * 0.18
    blockAt(x, z, 0.3, 0.24)
  }
  function blueprint(x: number, z: number) {
    const g = grp(x, z)
    ms(RB(1.3, 0.04, 0.8, 0.01), mat.wood, 0, 0.88, 0, g)
    for (const sx of [-0.6, 0.6]) for (const sz of [-0.35, 0.35]) mesh(CY(0.02, 0.02, 0.86, 8), mat.woodD, sx, 0.43, sz, g)
    const { x: X, t } = canvasTex(512, 300)
    X.fillStyle = '#2F5FA8'
    X.fillRect(0, 0, 512, 300)
    X.strokeStyle = 'rgba(255,255,255,.14)'
    X.lineWidth = 1
    for (let i = 0; i < 512; i += 16) {
      X.beginPath()
      X.moveTo(i, 0)
      X.lineTo(i, 300)
      X.stroke()
    }
    for (let j = 0; j < 300; j += 16) {
      X.beginPath()
      X.moveTo(0, j)
      X.lineTo(512, j)
      X.stroke()
    }
    X.strokeStyle = '#fff'
    X.lineWidth = 3
    X.strokeRect(40, 40, 432, 220)
    X.beginPath()
    X.moveTo(200, 40)
    X.lineTo(200, 160)
    X.moveTo(40, 160)
    X.lineTo(300, 160)
    X.moveTo(300, 40)
    X.lineTo(300, 260)
    X.stroke()
    X.fillStyle = '#fff'
    X.font = '500 14px "JetBrains Mono", monospace'
    X.fillText('agent-office · floor 1', 44, 30)
    const sh = plane(1.18, 0.7, bakeM(new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 })), 0, 0.903, 0, g)
    sh.rotation.x = -Math.PI / 2
    sh.rotation.z = 0.04
    ms(BX(0.46, 0.015, 0.3), mat.white, 0.18, 0.915, 0.02, g)
    for (const [a, b, w, d] of [[-0.05, 0.02, 0.01, 0.3], [0.4, 0.02, 0.01, 0.3], [0.18, -0.13, 0.46, 0.01], [0.12, 0.02, 0.01, 0.18]] as const) ms(BX(w, 0.05, d), mat.offw, a, 0.947, b, g)
    for (const [a, b, c] of [[0.02, 0.08, 0xf0463c], [0.25, -0.05, 0x3b7bff], [0.32, 0.08, 0xffc21a], [0.08, -0.06, 0x2fb344]] as const) ms(SP(0.018, 8, 6), M(c, 0.5), a, 0.94, b, g)
    ms(BX(0.05, 0.012, 0.03), mat.woodD, 0.22, 0.93, 0.08, g)
    blockAt(x, z, 0.68, 0.43)
  }
  function kitchen(x: number, z: number) {
    const g = grp(x, z)
    mesh(RB(1.9, 0.84, 0.56, 0.02), M(0xf1eee9, 0.6), 0, 0.42, 0, g)
    ms(RB(1.96, 0.05, 0.6, 0.01), mat.wood, 0, 0.865, 0, g)
    for (const sx of [-0.475, 0, 0.475]) ms(BX(0.006, 0.7, 0.006), M(0xd9d4cc, 0.6), sx, 0.42, 0.283, g)
    for (const sx of [-0.7, -0.25, 0.25, 0.7]) ms(BX(0.12, 0.02, 0.02), mat.metal, sx, 0.72, 0.29, g)
    for (const sx of [-0.6, -0.25]) ms(CY(0.1, 0.1, 0.01, 20), mat.dark, sx, 0.895, -0.02, g)
    ms(CY(0.1, 0.09, 0.15, 22), mat.metal, -0.6, 0.97, -0.02, g)
    ms(CY(0.105, 0.105, 0.015, 22), mat.metal, -0.6, 1.05, -0.02, g)
    ms(SP(0.018, 8, 6), mat.dark, -0.6, 1.065, -0.02, g)
    ms(CY(0.12, 0.1, 0.035, 22), mat.black, -0.25, 0.915, -0.02, g)
    ms(BX(0.2, 0.015, 0.03), mat.black, -0.02, 0.925, -0.02, g)
    ms(RB(0.34, 0.02, 0.22, 0.006), mat.wood, 0.3, 0.9, 0.04, g)
    ms(SP(0.035, 10, 8), mat.red, 0.25, 0.93, 0.04, g)
    ms(SP(0.04, 10, 8), mat.leafC, 0.36, 0.93, 0.02, g)
    ms(CY(0.05, 0.045, 0.13, 12), mat.white, 0.62, 0.95, -0.12, g)
    for (let k = 0; k < 3; k++) ms(CY(0.006, 0.006, 0.2, 5), mat.woodD, 0.62 + (k - 1) * 0.015, 1.06, -0.12, g).rotation.z = (k - 1) * 0.2
    succ(0.78, 0.89, 0.08, g)
    blockAt(x, z, 0.98, 0.3)
  }
  function safe(x: number, z: number) {
    const g = grp(x, z, 0.25)
    mesh(RB(0.62, 0.78, 0.56, 0.03), M(0x3a4150, 0.45, 0.3), 0, 0.39, 0, g)
    ms(BX(0.52, 0.66, 0.01), M(0x464e5e, 0.4, 0.35), 0, 0.39, 0.283, g)
    ms(CY(0.075, 0.075, 0.03, 24), mat.metal, -0.05, 0.48, 0.3, g).rotation.x = Math.PI / 2
    for (let k = 0; k < 3; k++) ms(CY(0.006, 0.006, 0.13, 6), mat.metal, 0.14, 0.34, 0.3, g).rotation.set(Math.PI / 2, 0, (k * Math.PI) / 3)
    ms(SP(0.018, 8, 6), mat.metal, 0.14, 0.34, 0.305, g)
    for (const y of [0.18, 0.6]) ms(BX(0.03, 0.08, 0.02), mat.metal, -0.27, y, 0.29, g)
    blockAt(x, z, 0.36, 0.34)
  }
  function smartTable(x: number, z: number) {
    const g = grp(x, z)
    ms(CY(0.22, 0.22, 0.03, 24), mat.wood, 0, 0.55, 0, g)
    mesh(CY(0.02, 0.02, 0.54, 8), mat.metal, 0, 0.27, 0, g)
    ms(CY(0.14, 0.16, 0.02, 20), mat.metal, 0, 0.01, 0, g)
    ms(CY(0.065, 0.07, 0.16, 20), M(0x9aa3ae, 0.95), -0.08, 0.645, 0, g)
    ms(TO(0.052, 0.008), new THREE.MeshBasicMaterial({ color: 0x2dd4bf, toneMapped: false }), -0.08, 0.728, 0, g).rotation.x = Math.PI / 2
    ms(CY(0.045, 0.055, 0.02, 16), mat.black, 0.1, 0.575, 0.02, g)
    ms(CY(0.007, 0.007, 0.28, 6), mat.black, 0.1, 0.72, 0.02, g)
    ms(CY(0.05, 0.09, 0.1, 18), M(0xf3eee4, 0.8), 0.1, 0.87, 0.02, g)
    ms(SP(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe2a8, toneMapped: false }), 0.1, 0.83, 0.02, g)
    blockAt(x, z, 0.24, 0.24)
  }
  function loungeArea() {
    ms(RB(6.5, 0.012, 2.1, 0.006), M(0xe3e5e9, 1), -8.0, 0.006, 9.75)
    const cm = [M(0xd6dce5, 0.95), M(0xe7dccb, 0.95), M(0xccd6e4, 0.95)]
    loungeSpots.forEach(([x, z], i) => ms(CY(0.26, 0.28, 0.13, 20), cm[i % 3]!, x, 0.078, z))
    const lk = M(0xc5ceda, 0.6), n = 12, w = 0.56, x0 = -13.18
    mesh(BX(n * w, 0.06, 0.4), mat.frame, x0 + (n * w) / 2, 0.03, 8.46)
    for (let k = 0; k < n; k++) {
      const x = x0 + w / 2 + k * w
      mesh(BX(w - 0.02, 0.96, 0.38), lk, x, 0.54, 8.46)
      for (let v = 0; v < 3; v++) ms(BX(0.26, 0.012, 0.004), mat.frame, x, 0.92 - v * 0.035, 8.652)
      ms(BX(0.02, 0.1, 0.02), mat.dark, x + 0.2, 0.56, 8.66)
    }
    ms(RB(0.34, 0.2, 0.26, 0.04), mat.kraft, x0 + 0.6, 1.12, 8.46)
    succ(x0 + 2.2, 1.02, 8.46)
    ms(RB(0.3, 0.14, 0.24, 0.05), M(0x3b7bff, 0.8), x0 + 4.1, 1.09, 8.46)
    block(x0, 8.27, x0 + n * w, 8.65, 0.1)
    block(-10.95, 9.0, -5.0, 10.5, 0.1)
  }
  const opsTex = canvasTex(512, 300)
  function opsScreen(x: number, y: number) {
    ms(RB(1.2, 0.72, 0.04, 0.015), mat.frame, x, y, -8.48)
    const { x: c, t } = opsTex
    c.fillStyle = '#F7F8FB'
    c.fillRect(0, 0, 512, 300)
    c.fillStyle = '#DB2777'
    c.fillRect(0, 0, 512, 8)
    c.fillStyle = '#111827'
    c.font = '600 30px Geist, sans-serif'
    c.fillText('Ops today', 24, 54)
    c.fillStyle = '#6B7280'
    c.font = '500 15px "JetBrains Mono", monospace'
    c.fillText('admin.mws.com', 26, 78)
    ;[['orders', '1,284'], ['refunds', '3'], ['disputes', '1'], ['payouts', '€42k']].forEach(([l, v], i) => {
      const X = 24 + (i % 2) * 236, Y = 98 + Math.floor(i / 2) * 96
      c.fillStyle = '#fff'
      rr(c, X, Y, 224, 84, 12)
      c.fill()
      c.strokeStyle = '#E6E8EC'
      c.lineWidth = 2
      c.stroke()
      c.fillStyle = '#111827'
      c.font = '600 34px Geist, sans-serif'
      c.fillText(v!, X + 16, Y + 46)
      c.fillStyle = '#6B7280'
      c.font = '500 15px Geist, sans-serif'
      c.fillText(l!, X + 16, Y + 70)
    })
    t.needsUpdate = true
    plane(1.14, 0.66, new THREE.MeshBasicMaterial({ map: t, toneMapped: false }), x, y, -8.457)
  }
  let ledMesh: THREE.InstancedMesh | undefined
  const ledColours = [new THREE.Color(0x22c55e), new THREE.Color(0x60a5fa), new THREE.Color(0x1f3b2c)]
  function mkLeds() {
    ledMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.034, 0.018, 0.006), new THREE.MeshBasicMaterial({ toneMapped: false }), leds.length)
    const m = new THREE.Matrix4()
    leds.forEach((p, i) => {
      ledMesh!.setMatrixAt(i, m.makeTranslation(p[0], p[1], p[2]))
      ledMesh!.setColorAt(i, ledColours[i % 3 === 2 ? 1 : 0]!)
    })
    cur.add(ledMesh)
  }

  const build: Record<DeptId, () => void> = {
    mkt() {
      frameShirt(-12.65, 1.58, 0)
      frameShirt(-11.5, 1.58, 1)
      auctionWall(-9.9, 1.6)
      frameShirt(-8.3, 1.58, 2)
      frameShirt(-7.15, 1.58, 3)
      podium(-9.9, -7.72)
      turfRug(-10.85, -1.5, 4.3, 0.9)
      shirtRail(-8.55, -6.5, -1.02, [4, 5, 6, 7])
      leafy(-5.95, -8.05, 1.1)
      cooler(-4.5, -8.22)
    },
    adm() {
      cabinet(-3.65, -8.15)
      cabinet(-3.1, -8.15)
      opsScreen(-1.45, 1.5)
      printer(-0.8, -7.95, 0)
      leafy(-0.75, -1.2, 0.85)
    },
    mob() {
      deviceWall(-1.7, 1.45)
      bigPhone(1.35, -8.12)
      dock(3.25, -8.18)
      wallClock(3.25, 1.95)
      lily(-3.55, -8.0, 0.95, true)
      leafy(3.8, -1.4, 0.9)
    },
    plat() {
      status = statusScreen(-9.0, 1.42, 0.2)
      racks(-8.05, 5.72, 3)
      mkLeds()
      raceway(-10.1, 5.72, -8.4, 5.72)
      raceway(-7.41, 3.1, -7.41, 5.27)
      leafy(-12.95, 7.3, 1.05)
      snake(-12.95, 3.9, 0.85)
    },
    side() {
      easel(-0.4, 0.95, -0.15)
      swatches(-2.3, 0.25)
      blueprint(1.45, 0.35)
      kitchen(1.5, 7.6)
      printer(3.72, 4.6, -Math.PI / 2)
      block(3.47, 4.1, 3.97, 5.1)
      leafy(3.85, 7.55, 1.05)
      snake(3.9, -0.1, 0.9)
    },
    gym() {
      for (let k = 0; k < 4; k++) {
        const z = -7.6 + k * 3.8
        mesh(BX(0.06, 2.4, 0.06), mat.frame, 4.5, 1.2, z)
        plane(3.74, 2.3, glassM, 4.5, 1.2, z + 1.9).rotation.y = Math.PI / 2
      }
      mesh(BX(0.06, 2.4, 0.06), mat.frame, 4.5, 1.2, 7.6)
      mesh(BX(0.07, 0.05, 15.26), mat.frame, 4.5, 2.4, 0)
      mesh(BX(0.07, 0.04, 15.26), mat.frame, 4.5, 0.02, 0)
      block(4.45, -7.65, 4.55, 7.65, 0.28)
      plane(7.6, 1.55, new THREE.MeshStandardMaterial({ color: 0xe4eaf0, roughness: 0.05, metalness: 1 }), 8.9, 1.2, -8.485)
      mesh(BX(7.72, 1.67, 0.02), mat.frame, 8.9, 1.2, -8.497)
      bench(7.2, -3.0)
      rack(12.95, -1.9)
      ;[0xe0463c, 0x3b7bff, 0xfacc15, 0x2fb344].forEach((c, k) => kettle(12.95, -0.5 + k * 0.42, c, 0.8 + k * 0.1))
      block(12.7, -0.75, 13.2, 1.0)
      standingBag(10.5, 0.6)
      plyo(6.1, 0.7)
      towels(12.95, 4.6)
      cooler(12.95, 3.6, -Math.PI / 2)
      for (const [m, z] of [[mat.mat1, 1.3], [mat.mat2, 2.2], [mat.mat3, 3.1]] as const) mesh(RB(1.8, 0.02, 0.7, 0.01, 1), m, 8.4, 0.014, z).castShadow = false
      safe(5.35, -7.85)
      smartTable(11.1, -7.72)
      lily(13.0, 7.7, 0.95)
      snake(13.05, -7.95, 0.9)
      mesh(RB(4.4, 0.012, 2.7, 0.006), mat.lounge, 9, 0.006, 10.8).castShadow = false
      sofa(9, 10.05)
      coffee(9, 11.2)
      leafy(5.35, 12.3, 1)
      lily(13.0, 12.3, 0.95, true)
      snake(13.05, 9.1, 0.9)
    },
  }

  function zoneShell(d: DeptScene, width: number) {
    d.shell.children.forEach((o) => o instanceof THREE.Mesh && o.geometry instanceof THREE.PlaneGeometry && o.geometry.dispose())
    d.shell.clear()
    nav.unblock(`shell:${d.def.id}`)
    const prev = [cur, owner, tag] as const
    cur = d.shell
    owner = d.def.id
    tag = `shell:${d.def.id}`
    const [x0, z0, , z1] = d.def.box, x1 = x0 + width, w = x1 - x0, h = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
    if (d.def.row === 'g') {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.05, 17), d.tint)
      f.rotation.x = -Math.PI / 2
      f.position.set(cx + 0.025, 0.004, cz)
      f.receiveShadow = true
      cur.add(f)
      wall(x0 + 1.8, 8.5, x0 + 9, 8.5)
    } else {
      plane(w, h, d.tint, cx, 0.003, cz).rotation.x = -Math.PI / 2
      const m = M(lighten(d.def.accent, 0.3).getHex(), 0.8), i = 0.16, t = 0.06
      for (const z of [z0 + i, z1 - i]) ms(BX(w - 2 * i + t, 0.003, t), m, cx, 0.006, z)
      for (const x of [x0 + i, x1 - i]) ms(BX(t, 0.003, h - 2 * i), m, x, 0.006, cz)
      const north = d.def.row === 'n', fz = north ? MZ : FZ
      wall(x0, fz, x1 - 1, fz)
      trough(x1 - 1, x1, fz)
      for (const x of [x0, x1]) north ? wall(x, -8.5, x, -2.4) : wall(x, 1.5, x, FZ)
    }
    d.shell.traverse((o) => (o.receiveShadow = true))
    ;[cur, owner, tag] = prev
    d.width = width
  }

  const deptScenes = {} as Record<DeptId, DeptScene>
  for (const def of depts) {
    const [x0, z0, x1, z1] = def.box, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, gym = def.row === 'g'
    const g = grp(cx, cz, 0, root)
    const gi = grp(-cx, -cz, 0, g)
    const shell = grp(0, 0, 0, gi)
    const extra = grp(0, 0, 0, gi)
    const tintLo = lighten(def.accent, gym ? 0.55 : 0.62), tintHi = lighten(def.accent, gym ? 0.42 : 0.5)
    const tint = gym ? new THREE.MeshStandardMaterial({ map: rubberTex(), roughness: 0.95 }) : new THREE.MeshStandardMaterial({ map: carpet, roughness: 1 })
    tint.color.copy(tintLo)
    const d: DeptScene = { def, g, gi, shell, extra, tint, tintLo, tintHi, slots: [], width: 0, cx, cz }
    deptScenes[def.id] = d
    cur = gi
    owner = def.id
    build[def.id]()
    def.slots.forEach(([x, z], i) => d.slots.push((gym ? treadmill : desk)(def, i, x, z)))
    cur = root
    owner = undefined
    zoneShell(d, x1 - x0)
  }
  loungeArea()
  snake(-13.05, 11.1, 0.85)

  const myScreen = canvasTex(1024, 600)
  function woodTex() {
    const { x, t } = canvasTex(1024, 512)
    x.fillStyle = '#D5B188'
    x.fillRect(0, 0, 1024, 512)
    for (let r = 0; r < 8; r++) {
      const off = (r * 211) % 256
      for (let k = -1; k < 5; k++) {
        const l = 63 + ((r * 7 + k * 5) % 5), s = 36 + ((r * 3 + k * 11) % 7)
        x.fillStyle = `hsl(32,${s}%,${l}%)`
        x.fillRect(off + k * 256 + 1, r * 64 + 1, 254, 62)
      }
    }
    return t
  }
  {
    const { x0, x1, z0, z1, h, d0, d1 } = OF, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, Wd = x1 - x0, Dp = z1 - z0, f = mat.frame
    const offGlass = new THREE.MeshStandardMaterial({ color: 0xdceaff, roughness: 0.1, transparent: true, opacity: 0.17, depthWrite: false, side: THREE.DoubleSide })
    const gl = (w: number, hh: number, x: number, y: number, z: number, ry: number) => {
      const p = plane(w, hh, offGlass, x, y, z)
      p.rotation.y = ry
      p.renderOrder = 2
    }
    const fl = plane(Wd, Dp, new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.55 }), cx, 0.004, cz)
    fl.rotation.x = -Math.PI / 2
    fl.receiveShadow = true
    gl(Wd, h, cx, h / 2, z0, 0)
    gl(Wd, h, cx, h / 2, z1, 0)
    gl(Dp, h, x1, h / 2, cz, Math.PI / 2)
    gl(d0 - z0, h, x0, h / 2, (z0 + d0) / 2, Math.PI / 2)
    gl(z1 - d1, h, x0, h / 2, (d1 + z1) / 2, Math.PI / 2)
    gl(d1 - d0, h - 2.12, x0, (2.12 + h) / 2, (d0 + d1) / 2, Math.PI / 2)
    gl(d1 - d0 - 0.08, 2.04, x0, 1.07, (d0 + d1) / 2, Math.PI / 2)
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [x0, d0], [x0, d1]] as const) mesh(BX(0.05, h, 0.05), f, x, h / 2, z)
    for (const x of [x0 + Wd / 3, x0 + (Wd * 2) / 3]) mesh(BX(0.035, h, 0.035), f, x, h / 2, z0)
    for (const z of [z0, z1]) {
      mesh(BX(Wd, 0.05, 0.05), f, cx, h, z)
      mesh(BX(Wd, 0.03, 0.05), f, cx, 0.015, z)
    }
    for (const x of [x0, x1]) mesh(BX(0.05, 0.05, Dp), f, x, h, cz)
    mesh(BX(0.05, 0.03, Dp), f, x1, 0.015, cz)
    mesh(BX(0.05, 0.03, d0 - z0), f, x0, 0.015, (z0 + d0) / 2)
    mesh(BX(0.05, 0.03, z1 - d1), f, x0, 0.015, (d1 + z1) / 2)
    mesh(BX(0.05, 0.05, d1 - d0), f, x0, 2.12, (d0 + d1) / 2)
    mesh(BX(0.04, 0.06, d1 - d0 - 0.06), f, x0, 0.05, (d0 + d1) / 2)
    for (const s of [-1, 1]) {
      mesh(CY(0.012, 0.012, 0.62, 10), mat.metal, x0 + s * 0.05, 1.06, d0 + 0.18)
      for (const y of [0.8, 1.32]) mesh(BX(0.05, 0.02, 0.02), mat.metal, x0 + s * 0.025, y, d0 + 0.18)
    }
    const dg = grp(cx, 10.3)
    mesh(RB(2.3, 0.06, 1.0, 0.025), mat.wood, 0, 0.75, 0, dg)
    for (const sx of [-1.1, 1.1]) mesh(RB(0.05, 0.72, 0.9, 0.015), mat.dark, sx, 0.36, 0, dg)
    mesh(RB(2.1, 0.34, 0.025, 0.01), mat.woodD, 0, 0.53, -0.44, dg)
    mesh(RB(0.44, 0.54, 0.78, 0.02), mat.white, 0.74, 0.28, 0, dg)
    mesh(BX(0.2, 0.012, 0.008), mat.metal, 0.74, 0.46, 0.395, dg)
    mesh(RB(0.1, 0.42, 0.05, 0.02), mat.metal, 0, 0.98, -0.27, dg)
    mesh(RB(0.42, 0.02, 0.26, 0.01), mat.metal, 0, 0.785, -0.24, dg)
    const mg = grp(0, -0.21, 0, dg)
    mg.position.y = 1.3
    mg.rotation.x = -0.14
    mesh(RB(1.5, 0.9, 0.045, 0.02), mat.dark, 0, 0, 0, mg)
    plane(1.42, 0.82, new THREE.MeshBasicMaterial({ map: myScreen.t, toneMapped: false }), 0, 0, 0.024, mg)
    mesh(RB(0.56, 0.02, 0.17, 0.006), mat.white, 0, 0.79, 0.2, dg)
    mesh(RB(0.07, 0.025, 0.11, 0.012), mat.white, 0.46, 0.79, 0.22, dg)
    mesh(CY(0.045, 0.04, 0.1, 16), M(0x1b34ff, 0.5), -0.82, 0.83, 0.14, dg)
    mesh(RB(0.24, 0.018, 0.32, 0.006), M(0x2b3a55, 0.8), -0.5, 0.788, 0.16, dg).rotation.y = 0.18
    succ(0.92, 0.78, -0.3, dg)
    const ch = grp(cx, 11.12, Math.PI), cm = M(0x2f333b, 0.55)
    mesh(RB(0.56, 0.09, 0.52, 0.04), cm, 0, 0.48, 0, ch)
    mesh(RB(0.54, 0.7, 0.08, 0.04), cm, 0, 0.92, -0.28, ch).rotation.x = -0.08
    for (const sx of [-0.3, 0.3]) {
      mesh(RB(0.05, 0.04, 0.36, 0.02), mat.black, sx, 0.7, 0.02, ch)
      mesh(RB(0.03, 0.2, 0.03, 0.01), mat.black, sx, 0.6, 0.06, ch)
    }
    mesh(CY(0.03, 0.03, 0.36, 10), mat.metal, 0, 0.27, 0, ch)
    for (let k = 0; k < 5; k++) {
      const a = k * 1.2566
      mesh(RB(0.34, 0.03, 0.05, 0.012), mat.black, Math.sin(a) * 0.15, 0.05, Math.cos(a) * 0.15, ch).rotation.y = a - Math.PI / 2
      mesh(SP(0.024, 8, 6), mat.black, Math.sin(a) * 0.3, 0.024, Math.cos(a) * 0.3, ch)
    }
    mesh(RB(3.8, 0.012, 2.4, 0.006), M(0xd3daea, 0.95), cx, 0.01, 10.85).castShadow = false
    leafy(x1 - 0.42, z0 + 0.42, 1)
    snake(x0 + 0.36, z1 - 0.36, 0.85)
    const lx = x1 - 0.4, lz = z1 - 0.4
    mesh(CY(0.13, 0.15, 0.03, 20), mat.black, lx, 0.015, lz)
    mesh(CY(0.012, 0.012, 1.5, 8), mat.black, lx, 0.76, lz)
    mesh(CY(0.13, 0.19, 0.24, 24), M(0xf3eee4, 0.8), lx, 1.55, lz)
    const q0 = queueSpots.at(-1)![0] - 0.7
    mesh(RB(x0 - q0, 0.008, 1, 0.004), M(0xcfd6e3, 0.95), (q0 + x0) / 2, 0.006, queueZ).castShadow = false
    block(x0, z0, x1, z1, 0.3)
  }
  queueSpots.forEach(([x, z], k) => {
    const { x: c, t } = canvasTex(128, 128)
    c.strokeStyle = 'rgba(217,139,10,.8)'
    c.lineWidth = 5
    c.setLineDash([10, 8])
    c.beginPath()
    c.arc(64, 64, 56, 0, Math.PI * 2)
    c.stroke()
    c.setLineDash([])
    c.fillStyle = 'rgba(138,75,6,.85)'
    c.font = '600 54px Geist, sans-serif'
    c.textAlign = 'center'
    c.fillText(String(k + 1), 64, 83)
    const o = plane(0.66, 0.66, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }), x, 0.014, z, root)
    o.rotation.x = -Math.PI / 2
    o.renderOrder = 1
  })

  function bake(node: THREE.Object3D, skip: ReadonlySet<THREE.Object3D>) {
    scene.updateMatrixWorld(true)
    const groups = new Map<string, { m: THREE.Material; cs: boolean; g: THREE.BufferGeometry[] }>()
    const removed: THREE.Object3D[] = []
    const inv = node.matrixWorld.clone().invert()
    const mw = new THREE.Matrix4()
    ;(function walk(n: THREE.Object3D) {
      for (const o of n.children) {
        if (skip.has(o)) continue
        walk(o)
        if (!(o instanceof THREE.Mesh) || !(o.material as THREE.Material).userData.bake) continue
        const m = o.material as THREE.Material, k = m.uuid + (o.castShadow ? '1' : '0')
        let b = groups.get(k)
        if (!b) groups.set(k, (b = { m, cs: o.castShadow, g: [] }))
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
        g.applyMatrix4(mw.multiplyMatrices(inv, o.matrixWorld))
        b.g.push(g)
        removed.push(o)
      }
    })(node)
    removed.forEach((o) => o.removeFromParent())
    groups.forEach((b) => {
      const m = new THREE.Mesh(mergeGeometries(b.g), b.m)
      m.castShadow = b.cs
      m.receiveShadow = true
      node.add(m)
      b.g.forEach((g) => g.dispose())
    })
  }
  bake(root, new Set([...Object.values(deptScenes).map((d) => d.g), ...shellG]))
  for (const d of Object.values(deptScenes)) bake(d.gi, new Set([d.shell, d.extra]))

  function addSlot(id: DeptId, i: number, x: number, z: number) {
    const d = deptScenes[id]
    cur = d.extra
    owner = id
    tag = `desk:${id}:${i}`
    d.slots[i] = (kindOf(id) === 'gym' ? treadmill : desk)(d.def, i, x, z)
    cur = root
    owner = tag = undefined
  }
  function removeSlot(id: DeptId, i: number) {
    const s = deptScenes[id].slots[i]
    if (!s) return
    s.g.removeFromParent()
    s.screen.t.dispose()
    s.plate?.tex.t.dispose()
    nav.unblock(`desk:${id}:${i}`)
    deptScenes[id].slots.length = i
  }

  const sun = new THREE.DirectionalLight(0xfff2df, 2.3)
  sun.position.set(-18, 15, 8 + ZC)
  sun.target.position.set(0, 0, ZC)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0002
  sun.shadow.normalBias = 0.022
  sun.shadow.radius = 2.5
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xffffff, 0xd9d3ca, 0.9))
  const fill = new THREE.DirectionalLight(0xe6eeff, 0.55)
  fill.position.set(14, 11, 18)
  scene.add(fill)
  function fitShadow(right: number) {
    const lc = sun.shadow.camera, inv = new THREE.Matrix4().lookAt(sun.position, sun.target.position, new V3(0, 1, 0)).setPosition(sun.position).invert(), b = new THREE.Box3()
    for (const x of [-13.8, right + 0.3]) for (const y of [0, 2.7]) for (const z of [-8.8, ZF + 0.1]) b.expandByPoint(new V3(x, y, z).applyMatrix4(inv))
    Object.assign(lc, { left: b.min.x - 0.2, right: b.max.x + 0.2, bottom: b.min.y - 0.2, top: b.max.y + 0.2, near: Math.max(0.1, -b.max.z - 1), far: -b.min.z + 1 })
    lc.updateProjectionMatrix()
  }

  function setShell(right: number) {
    const w = right + 13.5, mid = (right - 13.5) / 2
    floor.scale.x = w / 27
    floor.position.x = mid
    floorMap.repeat.x = w / 27
    shellG[0]!.scale.x = w + 0.3
    shellG[0]!.position.x = mid
    shellG[1]!.scale.x = w + 0.44
    shellG[1]!.position.x = mid
    shellG[2]!.position.x = right + 0.11
    fitShadow(right)
  }

  const hist = Array.from({ length: 30 }, (_, i) => 5 + Math.sin(i * 0.42) * 1.6 + Math.sin(i * 1.3) * 0.8)
  function drawStatus() {
    if (!status) return
    const { x, t } = status, now = new Date()
    x.fillStyle = '#0F1424'
    x.fillRect(0, 0, 1400, 800)
    x.fillStyle = '#fff'
    x.font = '600 60px Geist, sans-serif'
    x.fillText('Platform health', 64, 112)
    x.fillStyle = '#7D87A6'
    x.font = '500 26px "JetBrains Mono", monospace'
    x.fillText(`api.mws.com · eu-west · ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, 66, 158)
    x.fillStyle = '#16203A'
    rr(x, 1186, 64, 150, 50, 25)
    x.fill()
    x.fillStyle = '#4ADE80'
    x.beginPath()
    x.arc(1218, 89, 8, 0, Math.PI * 2)
    x.fill()
    x.fillStyle = '#A7F3C4'
    x.font = '500 24px "JetBrains Mono", monospace'
    x.fillText('LIVE', 1238, 97)
    ;[['uptime', '99.98%', '#4ADE80'], ['p95 latency', '142 ms', '#7088FF'], ['5xx rate', '0.02%', '#4ADE80'], ['queue depth', '12', '#AEB6CC']].forEach(([l, v, c], i) => {
      const X = 64 + i * 324
      x.fillStyle = '#161C30'
      rr(x, X, 200, 300, 176, 18)
      x.fill()
      x.fillStyle = c!
      rr(x, X + 28, 226, 44, 8, 4)
      x.fill()
      x.fillStyle = '#fff'
      x.font = '600 70px Geist, sans-serif'
      x.fillText(v!, X + 26, 316)
      x.fillStyle = '#8E97B2'
      x.font = '500 26px Geist, sans-serif'
      x.fillText(l!, X + 28, 356)
    })
    x.fillStyle = '#161C30'
    rr(x, 64, 400, 812, 336, 18)
    x.fill()
    x.fillStyle = '#7D87A6'
    x.font = '500 22px "JetBrains Mono", monospace'
    x.fillText('REQUESTS / MIN · LAST 30 MIN', 92, 442)
    const px0 = 92, px1 = 848, py0 = 470, py1 = 690, mx = 11, P = hist.map((v, i) => [px0 + ((px1 - px0) * i) / (hist.length - 1), py1 - ((py1 - py0) * v) / mx] as const)
    x.strokeStyle = '#232B45'
    x.lineWidth = 2
    for (let k = 0; k < 4; k++) {
      const y = py0 + ((py1 - py0) * k) / 3
      x.beginPath()
      x.moveTo(px0, y)
      x.lineTo(px1, y)
      x.stroke()
    }
    const gr = x.createLinearGradient(0, py0, 0, py1)
    gr.addColorStop(0, 'rgba(112,136,255,.38)')
    gr.addColorStop(1, 'rgba(112,136,255,0)')
    x.fillStyle = gr
    x.beginPath()
    x.moveTo(px0, py1)
    P.forEach(([a, b]) => x.lineTo(a, b))
    x.lineTo(px1, py1)
    x.closePath()
    x.fill()
    x.strokeStyle = '#7088FF'
    x.lineWidth = 5
    x.lineJoin = 'round'
    x.beginPath()
    P.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b)))
    x.stroke()
    const [lx, ly] = P.at(-1)!
    x.fillStyle = '#fff'
    x.beginPath()
    x.arc(lx, ly, 9, 0, Math.PI * 2)
    x.fill()
    x.fillStyle = '#7088FF'
    x.beginPath()
    x.arc(lx, ly, 5, 0, Math.PI * 2)
    x.fill()
    x.fillStyle = '#5D6784'
    x.font = '500 20px "JetBrains Mono", monospace'
    x.fillText('−30m', px0, 722)
    x.textAlign = 'right'
    x.fillText('now', px1, 722)
    x.textAlign = 'left'
    x.fillStyle = '#161C30'
    rr(x, 900, 400, 436, 336, 18)
    x.fill()
    x.fillStyle = '#7D87A6'
    x.font = '500 22px "JetBrains Mono", monospace'
    x.fillText('SERVICES', 928, 442)
    ;[['api', '142 ms'], ['auctions', '88 ms'], ['payments', '210 ms'], ['search', '64 ms'], ['admin', '120 ms']].forEach(([n, v], i) => {
      const Y = 478 + i * 50
      x.fillStyle = '#4ADE80'
      x.beginPath()
      x.arc(934, Y + 11, 7, 0, Math.PI * 2)
      x.fill()
      x.fillStyle = '#C7CCE0'
      x.font = '500 26px Geist, sans-serif'
      x.fillText(n!, 954, Y + 20)
      x.fillStyle = '#8E97B2'
      x.font = '500 22px "JetBrains Mono", monospace'
      x.textAlign = 'right'
      x.fillText(v!, 1308, Y + 20)
      x.textAlign = 'left'
    })
    t.needsUpdate = true
  }
  drawStatus()

  return {
    root,
    depts: deptScenes,
    myScreen,
    setShell,
    zoneShell,
    addSlot,
    removeSlot,
    drawStatus,
    tickStatus() {
      hist.push(Math.min(9.5, Math.max(2.5, hist.at(-1)! + (Math.random() - 0.5) * 1.4)))
      hist.shift()
      drawStatus()
    },
    tickAuction() {
      auctionSeconds = auctionSeconds > 0 ? auctionSeconds - 1 : 300
      drawAuction()
    },
    blinkLeds() {
      if (!ledMesh) return
      for (let k = 0; k < 8; k++) {
        const i = Math.floor(Math.random() * leds.length)
        ledMesh.setColorAt(i, Math.random() < 0.4 ? ledColours[2]! : ledColours[i % 3 === 2 ? 1 : 0]!)
      }
      ledMesh.instanceColor!.needsUpdate = true
    },
    drawClock() {
      const d = new Date(), s = d.getSeconds() + d.getMilliseconds() / 1000, m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60
      hands[0]!.rotation.z = (-h / 12) * Math.PI * 2
      hands[1]!.rotation.z = (-m / 60) * Math.PI * 2
      hands[2]!.rotation.z = (-Math.floor(s) / 60) * Math.PI * 2
    },
  }
}

export function placeSlot(s: Slot, ox: number) {
  const a = anchorsFor(s.kind, s.bx + ox, s.bz)
  s.seat.set(a.seat[0], 0, a.seat[1])
  s.stand.set(a.stand[0], 0, a.stand[1])
  s.chip.set(a.chip[0], a.chip[1], a.chip[2])
  s.mini.set(s.bx + ox, 0, s.kind === 'gym' ? s.bz : s.bz - 0.3)
  if (s.kind === 'desk') {
    s.bench.copy(s.seat)
    s.relax.copy(s.seat)
    return
  }
  const b = s.i < benchSeats ? gymBench(s.i) : a.seat
  const r = gymRelax(s.i)
  s.bench.set(b[0] + (s.i < benchSeats ? ox : 0), 0, b[1])
  s.relax.set(r[0] + ox, 0, r[1])
}

export function drawPlate(s: Slot, occupant: { colour: number; project: string } | undefined) {
  const P = s.plate
  if (!P) return
  P.mesh.visible = !!occupant
  if (!occupant) return
  const { x, t } = P.tex
  x.clearRect(0, 0, 512, 128)
  x.fillStyle = '#FBFBF9'
  rr(x, 4, 6, 504, 116, 22)
  x.fill()
  x.strokeStyle = 'rgba(17,24,39,.16)'
  x.lineWidth = 3
  x.stroke()
  x.fillStyle = hexCss(occupant.colour)
  x.beginPath()
  x.arc(46, 64, 15, 0, Math.PI * 2)
  x.fill()
  x.fillStyle = '#1F2433'
  x.font = '500 52px "JetBrains Mono", monospace'
  x.textBaseline = 'middle'
  x.fillText(occupant.project, 76, 67, 410)
  t.needsUpdate = true
}

export function drawScreen(s: Slot, a: { colour: number; title: string; state: string; caption: string; ask?: string }) {
  const { c, x, t } = s.screen, w = c.width, st = a.state, idle = st === 'idle'
  x.fillStyle = idle ? '#23272F' : '#F6F7FB'
  x.fillRect(0, 0, w, c.height)
  x.fillStyle = hexCss(a.colour)
  x.fillRect(0, 0, w, 6)
  x.globalAlpha = idle ? 0.35 : 1
  x.fillStyle = idle ? '#AAB0BE' : '#1F2433'
  x.font = '500 17px "JetBrains Mono", monospace'
  x.fillText(a.title.slice(0, 24), 16, 32)
  x.globalAlpha = 1
  if (st === 'needs-you') {
    x.fillStyle = '#F59E0B'
    x.fillRect(16, 52, w - 32, 86)
    x.fillStyle = '#241300'
    x.font = '600 17px Geist, sans-serif'
    x.fillText('Auto mode · confirm', 30, 84)
    x.font = '14px "JetBrains Mono", monospace'
    x.fillText((a.ask ?? '').slice(0, 30), 30, 114)
  } else if (st === 'stuck') {
    x.fillStyle = '#FDECEC'
    x.fillRect(16, 52, w - 32, 86)
    x.fillStyle = '#DC2626'
    x.fillRect(16, 52, 5, 86)
    x.fillStyle = '#B42318'
    x.font = '600 17px Geist, sans-serif'
    x.fillText('Stuck', 32, 84)
    x.font = '14px "JetBrains Mono", monospace'
    x.fillText(a.caption.replace('Stuck · ', '').slice(0, 28), 32, 114)
  } else if (st === 'starting') {
    x.fillStyle = '#6B7280'
    x.font = '15px "JetBrains Mono", monospace'
    x.fillText(a.caption.slice(0, 30), 16, 84)
  } else if (st === 'done') {
    x.fillStyle = '#15A34A'
    x.font = '600 34px Geist, sans-serif'
    x.fillText('Done ✓', 26, 106)
    x.fillStyle = '#6B7280'
    x.font = '14px "JetBrains Mono", monospace'
    x.fillText('ready for review', 28, 142)
  } else {
    for (let k = 0; k < 8; k++) {
      const L = s.lines[(k + s.scroll) % s.lines.length]!
      x.globalAlpha = idle ? 0.12 : k === 7 ? 1 : 0.8
      x.fillStyle = L.acc ? hexCss(a.colour) : '#C3CAD9'
      x.fillRect(16 + L.ind * 16, 52 + k * 17, L.len, 7)
    }
    x.globalAlpha = 1
  }
  t.needsUpdate = true
}

export function clearScreen(s: Slot) {
  const { c, x, t } = s.screen
  x.fillStyle = '#23272F'
  x.fillRect(0, 0, c.width, c.height)
  t.needsUpdate = true
}
