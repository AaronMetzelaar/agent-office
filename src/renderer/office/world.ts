import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { CSS2DRenderer, type CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { LoginItem } from '../../shared/chat'
import { day } from '../../shared/housekeeping'
import type { ReviewRequest } from '../../shared/workflow'
import type { Agent } from '../state/projection'
import { createRig, VIEW, type Region, type View } from './camera'
import { animate, createKit, type Character, type Target } from './characters'
import { createGuard } from './guard'
import { chipHalfWidth, chipMode, countsFor, createChip, createDeskChip, createSign, isDim, loud, placeLabels, renderChip, renderSign, ringColourOf, setChipActions, setChipPlacement, stateKey, type Chip, type ChipAction, type Focus, type Labelled, type LabelItem, type Sign, type StateKey } from './labels'
import { dept, depts, door, gymCooler, kindOf, layoutFloor, loungeSeat, minWidth, queueSpots, ZF, type Bounds, type Box, type DeptId, type Floor, type YardSide } from './layout'
import { createIntray } from './intray'
import { createNav, newWalker } from './nav'
import { placementFor } from './pose'
import { createMovers } from './movers'
import { buildOffice, clearScreen, drawPlate, drawScreen, hexCss, placeSlot, setChair, type Slot } from './props'
import { builtDesks, noSeating, reseat, type Desk, type Seating } from './seating'
import { canRest, spotFor, type Spot } from './standby'
import { buildQueue, queuePositions, type QueueItem } from '../../shared/queue'

export interface QueueEntry {
  key: string
  index: number
  title: string
  detail: string
  colour: string
  chatId?: string
  kind: QueueItem['kind']
}

export interface AgentEntry {
  id: string
  title: string
  colour: string
  dept: string
  caption: string
  state: StateKey
}

export interface WorldUi {
  counts: { key: StateKey; label: string; n: number }[]
  queue: QueueEntry[]
  agents: AgentEntry[]
  selected?: AgentEntry
  filter?: StateKey
}

interface Live {
  facts: Agent
  c: Character
  chip: Chip
  slot?: Slot
  spot?: Spot
  gone: boolean
  bye: boolean
  wait: number
  queueIndex: number
  target: Target
  screenKey: string
}

type Rect = [ox: number, oz: number, w: number, d: number]

interface RoomAnim {
  ox: number
  oz: number
  w: number
  d: number
  rows: number
  from: Rect
  to: Rect
  sc: number
  fs: number
  want: boolean
  shown: boolean
}

export interface WorldOptions {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  camera: THREE.PerspectiveCamera
  labelsEl: HTMLElement
  region: () => Region
  ui: WorldUi
  reduce: boolean
  onNewDesk?: (dept: DeptId, slot: number) => void
  onAction?: (action: ChipAction, chatId: string) => void
  removable?: (chatId: string) => boolean
}

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)
const easeBack = (u: number) => 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2)
const room = (): RoomAnim => ({ ox: 0, oz: 0, w: 1, d: 1, rows: 1, from: [0, 0, 1, 1], to: [0, 0, 1, 1], sc: 0.001, fs: 0.001, want: false, shown: false })
const reachOf = (side: YardSide, box: Box): [number, number, number, number] => (side === 'left' ? [0.3, 0.3, door[0] + 0.9 - box[2], ZF + 0.9 - box[3]] : [0.3, box[1] - ZF, 0.3, 0.3])

export type World = ReturnType<typeof createWorld>

export function createWorld({ scene, renderer, camera, labelsEl, region, ui, reduce, onNewDesk, onAction, removable = () => false }: WorldOptions) {
  const motion = reduce ? 0.25 : 1
  const guard = createGuard()
  scene.background = new THREE.Color(0xedeff2)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.6
  pmrem.dispose()
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.needsUpdate = true

  const nav = createNav()
  const office = buildOffice(scene, nav)
  const kit = createKit(scene)
  Object.assign(office.root, { intersectChildren: false })
  const labels = new CSS2DRenderer({ element: labelsEl })
  labels.setSize(innerWidth, innerHeight)
  const labelScene = new THREE.Scene()
  const intray = createIntray(scene, labelScene)
  const canvas = renderer.domElement
  const controls = new OrbitControls(camera, canvas)
  Object.assign(controls, { enableDamping: true, screenSpacePanning: false, minPolarAngle: 0.35, maxPolarAngle: 1.2, minDistance: 4 })
  const rig = createRig(camera, controls, reduce)

  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const live = new Map<string, Live>()
  const claims = new Map<string, number>()
  const sent = new Set<string>()
  const smoking = new Set<string>()
  const finishing = new Set<string>()
  const ghosts = new Map<string, Desk>()
  const deskChips = new Map<string, CSS2DObject>()
  const coolers = new Map<string, number>()
  let seating: Seating = noSeating
  const queueVecs = queueSpots.map(([x, z]) => new THREE.Vector3(x, 0, z))
  const seatVecs: THREE.Vector3[] = []
  const coolerVecs: THREE.Vector3[] = []
  const doorVec = new THREE.Vector3(door[0], 0, door[1])
  const smokeVecs: THREE.Vector3[] = []
  const smokeVec = (k: number) => (smokeVecs[k] ??= new THREE.Vector3(door[0] + 1.1 + k * 0.75, 0, ZF + 0.42))
  const anims = Object.fromEntries(depts.map((d) => [d.id, room()])) as Record<DeptId, RoomAnim>
  const lounge = room()
  let floor: Floor = layoutFloor({})
  let layU = 1
  let B: Bounds = { ...floor.bounds }, B0 = B, B1 = B
  let pendingLayout = false
  let booted = false
  let queue: QueueItem[] = []
  let logins: LoginItem[] = []
  const focus: Focus = {}
  let hotUntil = 0, lastMove = 0, lastR = 0, lastPend = 0, lastLabels = 0, t = 0, scrT = 0, ledT = 0
  let hot = true, labelsDue = true, camKey = ''
  const probe = { awake: false, uncapped: false, frames: 0 }
  const kick = (ms = 350) => (hotUntil = Math.max(hotUntil, performance.now() + ms))

  const signs = new Map<DeptId | 'lounge', Sign>()
  for (const d of depts) {
    const sign = createSign(d.name, d.path, hexCss(d.accent), { enter: () => setHoverDept(d.id), leave: () => setHoverDept(undefined), click: () => focusDept(d.id) })
    sign.obj.visible = false
    labelScene.add(sign.obj)
    signs.set(d.id, sign)
  }
  {
    const sign = createSign('Lounge', 'standby · idle or read', undefined, { enter: () => setHoverDept('lounge'), leave: () => setHoverDept(undefined), click: () => focusDept('lounge') })
    sign.obj.visible = false
    sign.obj.center.set(0, 0)
    labelScene.add(sign.obj)
    signs.set('lounge', sign)
  }

  const scenes = office.depts
  const shown = () => depts.filter((d) => anims[d.id].want)
  const active = () => [...live.values()].filter((l) => !l.gone)
  const labelled = (l: Live): Labelled => ({ id: l.facts.id, dept: l.facts.dept, state: l.facts.state, parked: l.facts.parked, lounge: l.spot === 'lounge', queued: l.queueIndex >= 0 })
  const shift = (l: Live, dx: number, dz: number) => l.c.walker.pos.set(l.c.walker.pos.x + dx, 0, l.c.walker.pos.z + dz)
  const settled = (l: Live) => !l.gone && !l.c.walker.path.length

  function placeCoolers() {
    const a = anims.gym
    coolerVecs.forEach((v, k) => {
      const [x, z] = gymCooler(k, a.w, a.rows)
      v.set(a.ox + x, 0, a.oz + z)
    })
  }

  function place(id: DeptId, [ox, oz, w, d]: Rect) {
    const a = anims[id], sc = scenes[id], dx = ox - a.ox, dz = oz - a.oz
    if (dx || dz) for (const l of live.values()) if (settled(l) && ((l.slot?.dept === id && [l.slot.seat, l.slot.stand].includes(l.target.p)) || (id === 'gym' && coolerVecs.includes(l.target.p)))) shift(l, dx, dz)
    Object.assign(a, { ox, oz, w, d })
    sc.g.position.set(ox + w / 2, 0, oz + d / 2)
    sc.gi.position.set(-w / 2, 0, -d / 2)
    sc.resize(w, d)
    if (sc.side) sc.side.position.x = w - minWidth(id, sc.tier)
    for (const s of sc.slots) if (s) placeSlot(s, ox, oz)
    if (id === 'gym') placeCoolers()
    signs.get(id)!.obj.position.set(ox + 0.25, 0.62, oz + d)
  }

  function placeLounge([ox, oz, w, d]: Rect) {
    const dx = ox - lounge.ox, dz = oz - lounge.oz
    if (dx || dz) for (const l of live.values()) if (settled(l) && seatVecs.includes(l.target.p)) shift(l, dx, dz)
    Object.assign(lounge, { ox, oz, w, d })
    office.lounge.g.position.set(ox + w / 2, 0, oz + d / 2)
    office.lounge.gi.position.set(-w / 2, 0, -d / 2)
    office.lounge.resize(w, d)
    seatVecs.forEach((v, i) => {
      const [x, z] = loungeSeat(i, lounge.rows)
      v.set(ox + x, 0, oz + z)
    })
    signs.get('lounge')!.obj.position.set(ox + 0.25, 0.62, oz + d)
  }

  function offsetOf(owner: string): readonly [number, number] | undefined {
    if (owner === 'lounge:corner') return lounge.want ? [lounge.to[0] + lounge.to[2], lounge.to[1]] : undefined
    const [id, part] = owner.split(':') as [DeptId, string | undefined]
    const a = anims[id]
    if (!a?.want) return undefined
    return [a.to[0] + (part === 'side' ? a.to[2] - minWidth(id, scenes[id].tier) : 0), a.to[1]]
  }

  function rebuildNav() {
    const b = B1
    const wall = (x0: number, z0: number, x1: number, z1: number) => nav.block(x0, z0, x1, z1, 0.05, undefined, 'perimeter')
    nav.unblock('perimeter')
    wall(b.x0 - 0.2, b.z0 - 0.2, b.x0 - 0.1, b.z1 + 0.15)
    wall(b.x0 - 0.2, b.z0 - 0.2, b.x1 + 0.2, b.z0 - 0.1)
    wall(b.x1 + 0.1, b.z0 - 0.2, b.x1 + 0.2, b.z1 + 0.15)
    wall(b.x0 - 0.2, b.z1 + 0.05, door[0] - 0.7, b.z1 + 0.15)
    wall(door[0] + 0.7, b.z1 + 0.05, b.x1 + 0.2, b.z1 + 0.15)
    nav.rebuild(floor.frame, offsetOf)
  }

  function applyLayout(next: Floor, snap: boolean) {
    for (const d of depts) {
      const a = anims[d.id], z = next.zones[d.id], sc = scenes[d.id]
      if (z.shown) {
        const [x0, z0, x1, z1] = z.box
        a.to = [x0, z0, x1 - x0, z1 - z0]
        a.rows = z.rows
        if (d.shell === 'yard' && next.yard) sc.reach = reachOf(next.yard, z.box)
        office.setTier(sc, z.tier)
        if (a.sc < 0.01) place(d.id, a.to)
        sc.block(a.to[2], a.to[3])
      } else a.to = [a.ox, a.oz, a.w, a.d]
      a.from = [a.ox, a.oz, a.w, a.d]
      a.fs = a.sc
      a.shown ||= z.shown
      a.want = z.shown
      signs.get(d.id)!.obj.visible = z.shown
    }
    const lz = next.lounge
    while (seatVecs.length < lz.seats) seatVecs.push(new THREE.Vector3())
    if (lz.shown) {
      const [x0, z0, x1, z1] = lz.box
      lounge.to = [x0, z0, x1 - x0, z1 - z0]
      lounge.rows = lz.rows
      office.lounge.seats(lz.seats, lz.rows)
      if (lounge.sc < 0.01) placeLounge(lounge.to)
    } else lounge.to = [lounge.ox, lounge.oz, lounge.w, lounge.d]
    lounge.from = [lounge.ox, lounge.oz, lounge.w, lounge.d]
    lounge.fs = lounge.sc
    lounge.want = lz.shown
    signs.get('lounge')!.obj.visible = lz.shown
    floor = next
    B0 = { ...B }
    B1 = next.bounds
    layU = snap ? 0.9999 : 0
    stepLayout(snap ? 1 : 0)
    if (!snap) {
      layoutView()
      if (rig.atOverview) rig.goOverview(false)
    }
  }

  function stepLayout(dt: number) {
    if (layU >= 1) return
    layU = Math.min(1, layU + dt / 0.45)
    const e = ease(layU)
    const mix = (from: number, to: number) => from + (to - from) * e
    const grow = (a: RoomAnim, g: THREE.Group) => {
      const to = a.want ? 1 : 0
      a.sc = a.fs + (to - a.fs) * (to > a.fs ? easeBack(layU) : e)
      g.scale.setScalar(Math.max(0.001, a.sc))
      g.visible = a.sc > 0.003
    }
    for (const d of depts) {
      const a = anims[d.id]
      place(d.id, a.from.map((from, k) => mix(from, a.to[k]!)) as Rect)
      grow(a, scenes[d.id].g)
    }
    placeLounge(lounge.from.map((from, k) => mix(from, lounge.to[k]!)) as Rect)
    grow(lounge, office.lounge.g)
    B = { x0: mix(B0.x0, B1.x0), z0: mix(B0.z0, B1.z0), x1: mix(B0.x1, B1.x1), z1: mix(B0.z1, B1.z1) }
    office.setShell(B, { x0: Math.min(B.x0, floor.frame.x0), z0: Math.min(B.z0, floor.frame.z0), x1: Math.max(B.x1, floor.frame.x1), z1: Math.max(B.z1, floor.frame.z1) })
    renderer.shadowMap.needsUpdate = true
    kick(120)
    if (layU >= 1) {
      for (const d of depts) anims[d.id].shown = anims[d.id].want
      lounge.shown = lounge.want
      rebuildNav()
      for (const l of live.values()) l.c.walker.goal = null
      kick()
    }
  }

  const canFold = () => !focus.hovered && !focus.hoverDept && layU >= 1 && !rig.zoomed()

  function relayout() {
    const act = active().sort((a, b) => a.facts.createdAt - b.facts.createdAt)
    for (const l of act) {
      if (!canRest(l.facts.state)) sent.delete(l.facts.id)
      const was = l.spot
      l.spot = spotFor(l.facts, l.spot, focus.selected === l.facts.id, sent.has(l.facts.id))
      if (l.spot !== 'lounge' || l.facts.parked) smoking.delete(l.facts.id)
      else if (was !== 'lounge' && rnd() < 0.1) smoking.add(l.facts.id)
    }
    const sitting = act.filter((l) => l.spot === 'lounge' && settled(l) && l.target.p === seatVecs[seating.seats.get(l.facts.id) ?? -1])
    const sitters = act.map((l) => ({ id: l.facts.id, dept: l.facts.dept, spot: smoking.has(l.facts.id) ? ('smoke' as const) : l.spot!, parked: l.facts.parked, recent: l.facts.quietMs < day }))
    const next = reseat(seating, [...sitters, ...[...ghosts].map(([id, d]) => ({ id, dept: d.dept, spot: 'gone' as const, parked: false, recent: false }))], canFold(), claims)
    seating = next
    pendingLayout = next.pending
    for (const id of claims.keys()) if (next.desks.has(id)) claims.delete(id)
    if (booted && !next.repack) return
    applyLayout(layoutFloor(next.size, next.lounge, floor), !booted)
    for (const l of sitting) {
      const v = seatVecs[next.seats.get(l.facts.id)!]
      if (!v) continue
      l.c.walker.pos.copy(v)
      l.c.walker.goal = null
    }
  }

  const slotKey = (d: Desk) => `${d.dept}:${d.slot}`

  function seatCoolers() {
    const kept = new Map(coolers)
    coolers.clear()
    const atCooler = active().filter((l) => l.spot === 'cooler').map((l) => l.facts.id)
    for (const id of atCooler) if (kept.has(id) && ![...coolers.values()].includes(kept.get(id)!)) coolers.set(id, kept.get(id)!)
    for (const id of atCooler) {
      if (coolers.has(id)) continue
      let k = 0
      while ([...coolers.values()].includes(k)) k++
      coolers.set(id, k)
    }
    while (coolerVecs.length < Math.max(0, ...coolers.values()) + 1) coolerVecs.push(new THREE.Vector3())
    placeCoolers()
  }

  function paintDesk(s: Slot, id: string | undefined) {
    const l = id ? live.get(id) : undefined
    const here = !!l && !l.gone && l.spot === 'desk'
    const look = here ? 'here' : l && !l.gone ? `away|${l.facts.title}|${l.facts.colour}|${l.facts.project}` : id ? 'leaving' : 'free'
    if (s.look === look) return
    s.look = look
    setChair(s, !here && !!id)
    if (here || look === 'leaving') return
    if (l) {
      drawScreen(s, { colour: l.facts.colour, title: l.facts.title, state: 'away', caption: '' })
      drawPlate(s, l.facts)
    } else {
      clearScreen(s)
      drawPlate(s, undefined)
    }
  }

  function buildDesks() {
    for (const d of depts) {
      const want = new Set(builtDesks(seating, d.id))
      const sc = scenes[d.id], local = floor.zones[d.id].slots, a = anims[d.id]
      sc.slots.forEach((_, i) => want.has(i) || office.removeSlot(d.id, i))
      for (const i of want) if (!sc.slots[i] && local[i]) placeSlot(office.addSlot(d.id, i, local[i][0], local[i][1]), a.ox, a.oz)
    }
  }

  function assign() {
    buildDesks()
    const holders = new Map([...seating.desks].map(([id, d]) => [slotKey(d), id]))
    for (const [id, d] of seating.desks) {
      const s = scenes[d.dept].slots[d.slot]
      if (s?.bare && !ghosts.has(id)) placeSlot(office.rebuildSlot(d.dept, d.slot, false)!, anims[d.dept].ox, anims[d.dept].oz)
    }
    seatCoolers()
    for (const l of live.values()) {
      const desk = !l.gone && l.spot === 'desk' ? seating.desks.get(l.facts.id) : undefined
      const slot = desk ? scenes[desk.dept].slots[desk.slot] : undefined
      if (l.slot === slot) continue
      l.slot = slot
      l.screenKey = ''
    }
    for (const d of depts) scenes[d.id].slots.forEach((s, i) => s && paintDesk(s, holders.get(slotKey({ dept: d.id, slot: i }))))
  }

  function targetOf(l: Live): Target {
    const f = l.facts
    if (l.gone) return { p: doorVec, face: null, pose: 'stand', y: 0, home: false, homeKind: 'none', parked: false, needs: false, subs: 0 }
    const place = placementFor({ state: f.state, kind: kindOf(f.dept), spot: l.spot ?? 'desk', parked: f.parked, queueIndex: l.queueIndex, spots: queueVecs.length, smoking: smoking.has(f.id) })
    const p =
      place.anchor === 'queue' ? queueVecs[l.queueIndex]!
      : place.anchor === 'lounge' ? (seatVecs[seating.seats.get(f.id) ?? 0] ?? doorVec)
      : place.anchor === 'smoke' ? smokeVec([...smoking].indexOf(f.id))
      : place.anchor === 'cooler' ? (coolerVecs[coolers.get(f.id) ?? 0] ?? doorVec)
      : !l.slot || place.anchor === 'door' ? doorVec
      : place.anchor === 'stand' ? l.slot.stand
      : l.slot.seat
    const seated = place.anchor === 'seat' && !!l.slot
    return {
      p, face: place.faceCamera ? null : 0, pose: place.pose, y: place.y, home: seated, homeKind: l.slot?.kind ?? 'none', parked: f.parked, needs: f.state === 'needs-you',
      subs: seated && f.state === 'working' ? f.subagents.length : 0, miniCentre: seated ? l.slot!.mini : undefined,
    }
  }

  function spawn(a: Agent) {
    const walker = newWalker(doorVec)
    const chip = createChip({ click: () => select(a.id, 'fly'), enter: () => setHovered(a.id), leave: () => focus.hovered === a.id && setHovered(undefined), act: (action) => onAction?.(action, a.id) })
    labelScene.add(chip.obj)
    const c = kit.create(a.colour, doorVec, walker, booted, rnd)
    c.chipAt = chip.obj.position.copy(c.chipAt)
    c.proxy.userData.agent = a.id
    const l: Live = { facts: a, c, chip, gone: false, bye: false, wait: 0, queueIndex: -1, target: { p: doorVec, face: null, pose: 'stand', y: 0, home: false, homeKind: 'none', parked: false, needs: false, subs: 0 }, screenKey: '' }
    live.set(a.id, l)
    return l
  }

  function leave(l: Live, i: number) {
    const id = l.facts.id
    l.gone = true
    l.bye = finishing.delete(id)
    l.wait = (l.bye ? 1.1 : 0) + i * 0.18
    sent.delete(id)
    smoking.delete(id)
    const desk = seating.desks.get(id)
    if (l.bye && desk) {
      ghosts.set(id, desk)
      movers.add({ id, ...desk })
    }
    if (focus.selected === id) select(undefined, 'overview')
  }

  function dispose(l: Live) {
    kit.dispose(l.c)
    labelScene.remove(l.chip.obj)
    l.chip.el.remove()
    live.delete(l.facts.id)
    if (focus.hovered === l.facts.id) focus.hovered = undefined
  }

  function paint(l: Live) {
    const f = l.facts, dim = isDim(labelled(l), focus)
    renderChip(l.chip, { title: f.title, caption: f.caption, colour: hexCss(f.colour), state: f.state, parked: f.parked, queueIndex: l.queueIndex, selected: focus.selected === f.id, dim, subs: f.subagents.length, badge: f.badge, sim: f.sim })
    l.c.ring.material.color.set(ringColourOf(f))
    kit.tint(l.c, f.colour, f.parked && !l.gone)
    if (!l.slot) return
    const key = `${f.state}|${f.title}|${f.colour}|${f.request?.summary}|${f.state === 'stuck' || f.state === 'starting' ? f.caption : ''}`
    if (key === l.screenKey) return
    l.screenKey = key
    drawScreen(l.slot, { colour: f.colour, title: f.title, state: f.state, caption: f.caption, ask: f.request?.summary })
    drawPlate(l.slot, f)
  }

  function renderSigns() {
    const act = active()
    for (const [id, sign] of signs) {
      const on = focus.hoverDept === id, dim = !!focus.hoverDept && focus.hoverDept !== id
      if (id === 'lounge') {
        const here = act.filter((l) => l.spot === 'lounge')
        const dozing = here.filter((l) => l.facts.parked).length
        const out = here.filter((l) => smoking.has(l.facts.id)).length
        const counts = [{ key: 'idle', label: 'relaxing', n: here.length - dozing - out }, { key: 'idle', label: 'dozing', n: dozing }, { key: 'idle', label: 'outside for a smoke', n: out }].filter((c) => c.n > 0)
        renderSign(sign, 'Lounge', counts, 'Empty', on, dim)
      } else renderSign(sign, dept[id].name, countsFor(act.filter((l) => l.facts.dept === id && l.spot !== 'lounge').map((l) => l.facts)), 'No agents', on, dim)
      sign.w = sign.el.offsetWidth || sign.w
      sign.h = sign.el.offsetHeight || sign.h
    }
  }

  function drawMonitor() {
    const { c, x, t: tex } = office.myScreen, w = c.width, h = c.height, act = active()
    const n = (s: StateKey) => act.filter((l) => l.spot !== 'lounge' && stateKey(l.facts.state) === s).length
    const N = queue.length
    x.fillStyle = '#F7F8FB'
    x.fillRect(0, 0, w, h)
    x.fillStyle = '#1B34FF'
    x.fillRect(0, 0, w, 10)
    x.fillStyle = '#111827'
    x.font = '600 62px Geist, sans-serif'
    x.fillText(N ? 'Waiting for you' : 'All clear', 44, 108)
    if (N) {
      x.fillStyle = '#F59E0B'
      x.beginPath()
      x.arc(w - 84, 88, 40, 0, Math.PI * 2)
      x.fill()
      x.fillStyle = '#241300'
      x.font = '600 44px Geist, sans-serif'
      x.textAlign = 'center'
      x.fillText(String(N), w - 84, 104)
      x.textAlign = 'left'
    }
    ui.queue.slice(0, 3).forEach((q, k) => {
      const y = 146 + k * 112
      x.fillStyle = k ? '#FFFFFF' : '#FFF7E8'
      x.beginPath()
      x.roundRect(32, y, w - 64, 96, 18)
      x.fill()
      x.strokeStyle = k ? '#E6E8EC' : '#F5C66B'
      x.lineWidth = 3
      x.stroke()
      x.fillStyle = '#8A4B06'
      x.font = '600 30px "JetBrains Mono", monospace'
      x.fillText(String(k + 1), 60, y + 59)
      x.fillStyle = q.colour
      x.beginPath()
      x.arc(122, y + 48, 24, 0, Math.PI * 2)
      x.fill()
      x.fillStyle = '#111827'
      x.font = '500 34px Geist, sans-serif'
      x.fillText(q.title.slice(0, 30), 166, y + 42)
      x.fillStyle = q.kind === 'request' ? '#8A4B06' : '#B42318'
      x.font = '24px "JetBrains Mono", monospace'
      x.fillText(q.detail.slice(0, 46), 166, y + 78)
    })
    if (N > 3) {
      x.fillStyle = '#6B7280'
      x.font = '500 28px Geist, sans-serif'
      x.fillText(`+${N - 3} more in line`, 44, 512)
    }
    if (!N) {
      x.fillStyle = '#6B7280'
      x.font = '34px Geist, sans-serif'
      x.fillText('Nobody is at your door.', 44, 186)
    }
    x.fillStyle = '#6B7280'
    x.font = '24px "JetBrains Mono", monospace'
    x.fillText(`${n('working')} working · ${n('done')} done · ${act.filter((l) => l.spot === 'lounge').length} in the lounge`, 44, h - 30)
    tex.needsUpdate = true
  }

  const entry = (l: Live): AgentEntry => ({ id: l.facts.id, title: l.facts.title, colour: hexCss(l.facts.colour), dept: dept[l.facts.dept].name, caption: l.facts.caption, state: stateKey(l.facts.state) })

  function updateUi() {
    const act = active()
    ui.counts = countsFor(act.filter((l) => !l.facts.parked).map((l) => l.facts))
    ui.queue = queue.map((item, index) => {
      const l = item.chatId ? live.get(item.chatId) : undefined
      const f = l?.facts
      const title = item.kind === 'login' ? `${item.label ?? 'An account'} needs login` : (f?.title ?? '')
      const detail = item.kind === 'login' ? `${item.chats.length} chat${item.chats.length === 1 ? '' : 's'} waiting · log in again` : item.kind === 'request' ? `${f?.request?.tool ?? 'Tool'} · ${f?.request?.summary ?? ''}` : (f?.caption ?? '')
      return { key: item.key, index, title, detail, colour: f ? hexCss(f.colour) : '#DC2626', chatId: item.chatId, kind: item.kind }
    })
    ui.agents = act.map(entry)
    const sel = focus.selected ? live.get(focus.selected) : undefined
    ui.selected = sel ? entry(sel) : undefined
    ui.filter = focus.filter
  }

  function refresh() {
    relayout()
    assign()
    const act = active()
    queue = buildQueue(
      act.filter((l) => !sent.has(l.facts.id)).map((l) => ({ id: l.facts.id, accountId: l.facts.accountId, state: l.facts.state, since: l.facts.since, stuckReason: l.facts.stuckReason })),
      logins,
    )
    const positions = queuePositions(queue)
    for (const l of live.values()) {
      l.queueIndex = l.gone ? -1 : (positions.get(l.facts.id) ?? -1)
      l.target = targetOf(l)
      paint(l)
    }
    updateUi()
    renderSigns()
    drawMonitor()
    kick()
  }

  function sync(agents: Agent[], nextLogins: LoginItem[] = []) {
    logins = nextLogins
    const seen = new Set<string>()
    let leaving = 0
    for (const a of agents) {
      seen.add(a.id)
      const l = live.get(a.id)
      if (l && !l.gone) l.facts = a
      else if (!l) spawn(a)
    }
    for (const l of live.values()) if (!seen.has(l.facts.id) && !l.gone) leave(l, leaving++)
    refresh()
    if (!booted) {
      for (const l of live.values()) {
        l.c.walker.pos.copy(l.target.p)
        l.c.walker.goal = l.target.p
        l.c.walker.face = l.target.face ?? 0
        l.c.body.g.position.copy(l.target.p)
        kit.settle(l.c, l.target)
      }
      booted = true
      layoutView()
      rig.goOverview(true)
    }
  }

  function applyFocus() {
    for (const l of live.values()) paint(l)
    renderSigns()
    for (const d of depts) scenes[d.id].tint.color.copy(focus.hoverDept === d.id ? scenes[d.id].tintHi : scenes[d.id].tintLo)
    kick()
  }
  function setHovered(id: string | undefined) {
    if (focus.hovered === id) return
    focus.hovered = id
    kick()
  }
  function setHoverDept(id: DeptId | 'lounge' | undefined) {
    if (focus.hoverDept === id) return
    focus.hoverDept = id
    applyFocus()
  }
  function setFilter(key: StateKey | undefined) {
    focus.filter = key
    ui.filter = key
    applyFocus()
  }

  const focusPoint = (l: Live) => new THREE.Vector3(l.c.walker.pos.x, 0.7, l.c.walker.pos.z)
  function select(id: string | undefined, view: View) {
    const changed = focus.selected !== id
    focus.selected = id
    const l = id ? live.get(id) : undefined
    ui.selected = l ? entry(l) : undefined
    if (l && view === 'fly') rig.show('fly', () => focusPoint(l), rig.zoomDistance(region(), innerHeight))
    else if (view !== 'keep' && (!l || rig.atOverview)) rig.show('overview')
    if (changed && booted) refresh()
    else for (const other of live.values()) paint(other)
    kick()
  }
  function focusDept(id: DeptId | 'lounge') {
    const [x0, z0, x1, z1] = id === 'lounge' ? floor.lounge.box : floor.zones[id].box
    const span = Math.max(x1 - x0, (z1 - z0) * 1.3)
    rig.atOverview = false
    rig.follow = undefined
    rig.flyTo(() => new THREE.Vector3((x0 + x1) / 2, 0.3, (z0 + z1) / 2), Math.min(rig.zoomDistance(region(), innerHeight) * Math.max(1.5, span / 4.4), rig.overview.distance * 0.58), VIEW, 0.85)
  }

  function layoutView() {
    rig.layout(region(), innerWidth, innerHeight, floor.frame)
  }

  const ray = new THREE.Raycaster()
  const ptr = new THREE.Vector2()
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const floorHit = new THREE.Vector3()
  let down: [number, number] | undefined
  function hit(e: PointerEvent): string | undefined {
    const r = canvas.getBoundingClientRect()
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ptr, camera)
    const proxies = [...live.values()].filter((l) => !l.gone).map((l) => l.c.proxy)
    return ray.intersectObjects(proxies, false)[0]?.object.userData.agent as string | undefined
  }
  const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY])
  const onUp = (e: PointerEvent) => {
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) {
      const id = hit(e)
      if (id) select(id, 'fly')
    }
    down = undefined
  }
  const onMove = (e: PointerEvent) => {
    lastMove = performance.now()
    if (e.buttons) return
    const id = hit(e)
    setHovered(id)
    canvas.style.cursor = id ? 'pointer' : 'grab'
    const p = ray.ray.intersectPlane(floorPlane, floorHit)
    if (!p) return setHoverDept(undefined)
    const inside = ([x0, z0, x1, z1]: Box) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1
    const zone = shown().find((d) => inside(floor.zones[d.id].box))
    setHoverDept(zone?.id ?? (lounge.want && inside(floor.lounge.box) ? 'lounge' : undefined))
  }
  const onLeave = () => {
    setHovered(undefined)
    setHoverDept(undefined)
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerleave', onLeave)

  const deskCentre = (job: { dept: DeptId; slot: number }) => {
    const s = scenes[job.dept].slots[job.slot]
    return s && new THREE.Vector3(s.bx + anims[job.dept].ox, 0, s.bz + anims[job.dept].oz)
  }
  const movers = createMovers(scene, kit, (a, b) => nav.route(a, b), deskCentre, motion)

  const timers = [
    setInterval(() => {
      if (!document.hidden) guard.run('auction screen', undefined, office.tickAuction)
    }, 1000),
    setInterval(() => guard.run('status screen', undefined, office.tickStatus), 10_000),
  ]

  function deskChip(id: DeptId, i: number) {
    const key = `${id}:${i}`
    let chip = deskChips.get(key)
    if (!chip) {
      chip = createDeskChip(`New agent at ${dept[id].name} ${kindOf(id) === 'gym' ? 'treadmill' : id === 'side' ? 'table' : 'desk'} ${i + 1}`, () => onNewDesk?.(id, i))
      labelScene.add(chip)
      deskChips.set(key, chip)
    }
    return chip
  }

  function layoutDeskChips(zoomed: boolean) {
    for (const chip of deskChips.values()) chip.visible = false
    if (!zoomed || !onNewDesk || layU < 1) return
    const taken = new Set([...seating.desks.values()].map(slotKey))
    for (const d of shown())
      scenes[d.id].slots.forEach((slot, i) => {
        if (!slot || taken.has(slotKey({ dept: d.id, slot: i }))) return
        const chip = deskChip(d.id, i)
        chip.position.copy(slot.chip)
        chip.visible = true
      })
  }

  const projected = new THREE.Vector3()
  function layoutChips() {
    const zoomed = rig.zoomed(), far = !zoomed, w = innerWidth, h = innerHeight
    layoutDeskChips(zoomed)
    if (far !== labelsEl.classList.contains('far')) {
      labelsEl.classList.toggle('far', far)
      renderSigns()
    }
    const rects: [number, number, number, number][] = []
    for (const sign of signs.values()) {
      if (!sign.obj.visible) continue
      projected.copy(sign.obj.position).project(camera)
      if (projected.z >= 1) continue
      const x = ((projected.x + 1) / 2) * w, y = ((1 - projected.y) / 2) * h
      const top = y - sign.h * sign.obj.center.y
      rects.push([x, top, x + sign.w, top + sign.h])
    }
    const items: LabelItem[] = []
    const byKey = new Map<string, Live>()
    for (const l of live.values()) {
      const who = labelled(l)
      const mode = l.gone ? 0 : chipMode(who, focus)
      const acts = mode && (mode === 2 || zoomed) && canRest(l.facts.state) ? (l.spot === 'lounge' ? 'done' : 'both') : undefined
      setChipActions(l.chip, acts, !!acts && removable(l.facts.id))
      if (mode) {
        projected.copy(l.c.chipAt)
        const distance = projected.distanceToSquared(camera.position)
        projected.project(camera)
        if (projected.z < 1 && Math.abs(projected.x) < 1.05 && Math.abs(projected.y) < 1.05) {
          const f = l.facts
          const bubble = f.state === 'needs-you' || (f.state === 'stuck' && l.queueIndex >= 0)
          items.push({
            key: f.id,
            x: ((projected.x + 1) / 2) * w,
            y: ((1 - projected.y) / 2) * h,
            hw: chipHalfWidth(f.title, f.caption, far, f.state === 'working' && f.subagents.length > 0, l.queueIndex >= 0) + (acts === 'both' ? 50 : acts ? 22 : 0) + (acts && removable(f.id) ? 50 : 0),
            miniHw: l.queueIndex >= 0 ? 22 : 14,
            h: (far ? 32 : 38) + (bubble ? (far ? 30 : 36) : 0),
            priority: mode === 2 ? 0 : loud(who) ? 1 : stateKey(f.state) === 'working' ? 2 : f.state === 'done' ? 3 : 4,
            distance,
          })
          byKey.set(f.id, l)
          continue
        }
      }
      l.chip.obj.visible = false
    }
    for (const [key, p] of placeLabels(rects, items)) setChipPlacement(byKey.get(key)!.chip, p)
  }

  function step(dt: number, now: number) {
    t += dt
    const zoomed = rig.zoomed()
    scrT += dt
    if (scrT > 0.4) {
      scrT = 0
      if (zoomed)
        guard.run('desk screens', undefined, () => {
          for (const l of live.values())
            if (l.slot && !l.gone && l.facts.state === 'working' && l.target.home) {
              l.slot.scroll++
              drawScreen(l.slot, { colour: l.facts.colour, title: l.facts.title, state: 'working', caption: l.facts.caption })
            }
        })
    }
    ledT += dt
    if (ledT > 0.25) {
      ledT = 0
      if (anims.plat.shown) guard.run('server LEDs', undefined, office.blinkLeds)
    }
    let moved = false
    const faceCamera = (p: THREE.Vector3) => Math.atan2(camera.position.x - p.x, camera.position.z - p.z)
    const route = (a: THREE.Vector3, b: THREE.Vector3) => nav.route(a, b)
    for (const l of [...live.values()]) {
      moved =
        guard.run(`agent ${l.facts.id}`, false, () => {
          if (l.slot?.belt && l.target.home && l.target.pose === 'run' && !l.c.walker.path.length) l.slot.belt.offset.y -= dt * 1.9
          let target = l.target
          if (l.gone && l.wait > 0) {
            l.wait -= dt
            target = { ...l.target, p: l.c.walker.pos, ...(l.bye ? { pose: 'wave' as const, face: null } : {}) }
          }
          const looking = focus.selected === l.facts.id || focus.hovered === l.facts.id
          return animate(l.c, target, kit, l.facts.colour, { dt, t, motion, faceCamera, route, looking, dim: isDim(labelled(l), focus), gone: l.gone })
        }) || moved
      if (l.c.out >= 1) {
        dispose(l)
        refresh()
      }
    }
    const crew = guard.run('movers', undefined, () => movers.step(dt, t))
    if (crew) {
      for (const job of crew.picked) {
        office.removeSlot(job.dept, job.slot)
        ghosts.delete(job.id)
      }
      if (crew.picked.length) refresh()
      moved ||= crew.active
    }
    guard.run('layout', undefined, () => stepLayout(dt))
    if (pendingLayout && now - lastPend > 500) {
      lastPend = now
      refresh()
    }
    guard.run('camera', undefined, () => rig.step(dt))
    const cm = guard.run('controls', false, () => controls.update())
    guard.run('wall clock', undefined, office.drawClock)
    const key = [...camera.position.toArray(), ...controls.target.toArray()].map((v) => v.toFixed(3)).join()
    const camMoved = key !== camKey
    camKey = key
    hot = !!rig.tween || cm || camMoved || moved || layU < 1 || now < hotUntil || now - lastMove < 250
    labelsDue = camMoved || moved || now < hotUntil || now - lastLabels > 120
  }

  function resize() {
    labels.setSize(innerWidth, innerHeight)
    layoutView()
    if (rig.atOverview) rig.goOverview(true)
    kick()
  }
  addEventListener('resize', resize)
  const onVisible = () => {
    if (!document.hidden) kick()
  }
  document.addEventListener('visibilitychange', onVisible)
  layoutView()
  rig.goOverview(true)
  office.setShell(B)

  return {
    probe,
    sync,
    select,
    claimDesk(chatId: string, slot: number) {
      claims.set(chatId, slot)
      refresh()
    },
    sentAway: (): ReadonlySet<string> => sent,
    sendToLounge(chatId: string) {
      sent.add(chatId)
      refresh()
    },
    finishing(chatIds: readonly string[], on: boolean) {
      for (const id of chatIds) {
        if (on) finishing.add(id)
        else finishing.delete(id)
      }
    },
    setFilter,
    setReviews(requests: readonly ReviewRequest[]) {
      if (intray.update(requests, Date.now())) kick()
    },
    overview: () => select(undefined, 'overview'),
    escape() {
      if (focus.filter) return setFilter(undefined)
      if (focus.selected) return select(undefined, 'overview')
      if (!rig.atOverview) rig.goOverview(false)
    },
    relayoutView: () => {
      layoutView()
      if (rig.atOverview) rig.goOverview(false)
      kick()
    },
    frame(now: number): boolean {
      if (document.hidden && !probe.awake) {
        lastR = now
        return false
      }
      if (!hot && !probe.uncapped && now - lastR < 31) return false
      const dt = Math.min((now - lastR) / 1000, 0.05)
      lastR = now
      step(dt, now)
      return true
    },
    render() {
      renderer.render(scene, camera)
      probe.frames++
      if (!labelsDue) return
      lastLabels = performance.now()
      guard.run('labels', undefined, () => {
        layoutChips()
        labels.render(labelScene, camera)
        for (const l of live.values()) if (l.chip.obj.visible && (loud(labelled(l)) || focus.selected === l.facts.id || focus.hovered === l.facts.id)) l.chip.el.style.zIndex = String(1000 + (Number(l.chip.el.style.zIndex) || 0))
      })
    },
    dispose() {
      timers.forEach(clearInterval)
      removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisible)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      controls.dispose()
      labelsEl.replaceChildren()
    },
  }
}
