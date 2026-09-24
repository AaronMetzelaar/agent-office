import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { CSS2DRenderer, type CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { LoginItem } from '../../shared/chat'
import type { ReviewRequest } from '../../shared/workflow'
import type { Agent } from '../state/projection'
import { createRig, VIEW, type Region } from './camera'
import { animate, createKit, type Character, type Target } from './characters'
import { chipHalfWidth, chipMode, countsFor, createChip, createDeskChip, createSign, isDim, loud, placeLabels, renderChip, renderSign, ringColourOf, setChipPlacement, stateKey, type Chip, type Focus, type Labelled, type LabelItem, type Sign, type StateKey } from './labels'
import { assignDesks, benchSeats, dept, depts, door, kindOf, layoutFloor, lounge, minWidth, parkedZone, queueSpots, settle, type Bounds, type Demand, type DeptId, type Floor } from './layout'
import { createIntray } from './intray'
import { createNav, newWalker } from './nav'
import { placementFor } from './pose'
import { buildOffice, clearScreen, drawPlate, drawScreen, hexCss, placeSlot, type Slot } from './props'
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
  gone: boolean
  wait: number
  queueIndex: number
  target: Target
  screenKey: string
}

type Rect = [ox: number, oz: number, w: number, d: number]

interface DeptAnim {
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
}

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)
const easeBack = (u: number) => 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2)

export type World = ReturnType<typeof createWorld>

export function createWorld({ scene, renderer, camera, labelsEl, region, ui, reduce, onNewDesk }: WorldOptions) {
  const motion = reduce ? 0.25 : 1
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
  const desks = new Map<string, number>()
  const claims = new Map<string, number>()
  const deskChips = new Map<string, CSS2DObject>()
  const loungeOf = new Map<string, number>()
  const queueVecs = queueSpots.map(([x, z]) => new THREE.Vector3(x, 0, z))
  const loungeVecs = lounge.map(([x, z]) => new THREE.Vector3(x, 0, z))
  const doorVec = new THREE.Vector3(door[0], 0, door[1])
  const anims = Object.fromEntries(depts.map((d) => [d.id, { ox: 0, oz: 0, w: 1, d: 1, rows: 1, from: [0, 0, 1, 1], to: [0, 0, 1, 1], sc: 0.001, fs: 0.001, want: false, shown: false }])) as Record<DeptId, DeptAnim>
  const loungeCentre = [(parkedZone.box[0] + parkedZone.box[2]) / 2, (parkedZone.box[1] + parkedZone.box[3]) / 2] as const
  let applied: Demand = {}
  let floor: Floor = layoutFloor({})
  let layU = 1
  let B: Bounds = { ...floor.bounds }, B0 = B, B1 = B
  let loungeWant = false, loungeSc = 0
  let pendingLayout = false
  let booted = false
  let queue: QueueItem[] = []
  let logins: LoginItem[] = []
  const focus: Focus = {}
  let hotUntil = 0, lastMove = 0, lastR = 0, lastPend = 0, lastLabels = 0, t = 0, scrT = 0, ledT = 0
  let hot = true, labelsDue = true, camKey = ''
  const probe = { awake: false, uncapped: false, frames: 0 }
  const kick = (ms = 350) => (hotUntil = Math.max(hotUntil, performance.now() + ms))

  const signs = new Map<DeptId | 'park', Sign>()
  for (const d of depts) {
    const sign = createSign(d.name, d.path, hexCss(d.accent), { enter: () => setHoverDept(d.id), leave: () => setHoverDept(undefined), click: () => focusDept(d.id) })
    sign.obj.visible = false
    labelScene.add(sign.obj)
    signs.set(d.id, sign)
  }
  {
    const sign = createSign(parkedZone.name, 'no message for 1d+', undefined, { enter: () => setHoverDept('park'), leave: () => setHoverDept(undefined), click: () => focusDept('park') })
    sign.obj.position.set(parkedZone.sign[0], 0.62, parkedZone.sign[1])
    sign.obj.visible = false
    labelScene.add(sign.obj)
    signs.set('park', sign)
  }

  const scenes = office.depts
  const shown = () => depts.filter((d) => anims[d.id].want)
  const active = () => [...live.values()].filter((l) => !l.gone)
  const labelled = (l: Live): Labelled => ({ id: l.facts.id, dept: l.facts.dept, state: l.facts.state, parked: l.facts.parked, queued: l.queueIndex >= 0 })

  function place(id: DeptId, [ox, oz, w, d]: Rect) {
    const a = anims[id], sc = scenes[id], dx = ox - a.ox, dz = oz - a.oz
    if (dx || dz) for (const l of live.values()) if (l.slot?.dept === id && !l.gone && !l.c.walker.path.length && [l.slot.seat, l.slot.stand, l.slot.bench, l.slot.relax].includes(l.target.p)) l.c.walker.pos.set(l.c.walker.pos.x + dx, 0, l.c.walker.pos.z + dz)
    Object.assign(a, { ox, oz, w, d })
    sc.g.position.set(ox + w / 2, 0, oz + d / 2)
    sc.gi.position.set(-w / 2, 0, -d / 2)
    sc.resize(w, d)
    if (sc.side) sc.side.position.x = w - minWidth(id, sc.tier)
    for (const s of sc.slots) placeSlot(s, ox, oz, w, a.rows)
    signs.get(id)!.obj.position.set(ox + 0.25, 0.62, oz + d)
  }

  function offsetOf(owner: string): readonly [number, number] | undefined {
    if (owner === 'park') return loungeWant ? [0, 0] : undefined
    const [id, part] = owner.split(':') as [DeptId, string | undefined]
    const a = anims[id]
    if (!a?.want) return undefined
    return [a.to[0] + (part === 'side' ? a.to[2] - minWidth(id, scenes[id].tier) : 0), a.to[1]]
  }

  function applyLayout(next: Floor, snap: boolean) {
    for (const d of depts) {
      const a = anims[d.id], z = next.zones[d.id], sc = scenes[d.id]
      if (z.shown) {
        const [x0, z0, x1, z1] = z.box
        a.to = [x0, z0, x1 - x0, z1 - z0]
        a.rows = z.rows
        office.setTier(sc, z.tier)
        if (a.sc < 0.01) place(d.id, a.to)
        for (let i = sc.slots.length - 1; i >= z.desks; i--) office.removeSlot(d.id, i)
        for (let i = sc.slots.length; i < z.desks; i++) placeSlot(office.addSlot(d.id, i, z.slots[i]![0], z.slots[i]![1]), a.ox, a.oz, a.w, a.rows)
        sc.block(a.to[2], a.to[3])
      } else a.to = [a.ox, a.oz, a.w, a.d]
      a.from = [a.ox, a.oz, a.w, a.d]
      a.fs = a.sc
      a.shown ||= z.shown
      a.want = z.shown
      signs.get(d.id)!.obj.visible = z.shown
    }
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
    for (const d of depts) {
      const a = anims[d.id], sc = scenes[d.id]
      place(d.id, a.from.map((from, k) => mix(from, a.to[k]!)) as Rect)
      const to = a.want ? 1 : 0
      a.sc = a.fs + (to - a.fs) * (to > a.fs ? easeBack(layU) : e)
      sc.g.scale.setScalar(Math.max(0.001, a.sc))
      sc.g.visible = a.sc > 0.003
    }
    B = { x0: mix(B0.x0, B1.x0), z0: mix(B0.z0, B1.z0), x1: mix(B0.x1, B1.x1), z1: mix(B0.z1, B1.z1) }
    office.setShell(B)
    renderer.shadowMap.needsUpdate = true
    kick(120)
    if (layU >= 1) {
      for (const d of depts) anims[d.id].shown = anims[d.id].want
      nav.rebuild(B1, offsetOf)
      for (const l of live.values()) l.c.walker.goal = null
      kick()
    }
  }

  function stepLounge(dt: number) {
    const to = loungeWant ? 1 : 0
    if (Math.abs(loungeSc - to) < 0.002) return
    loungeSc = Math.abs(loungeSc - to) < 0.01 ? to : loungeSc + (to - loungeSc) * Math.min(1, dt * 8)
    office.lounge.scale.setScalar(Math.max(0.001, loungeSc))
    office.lounge.position.set(loungeCentre[0] * (1 - loungeSc), 0, loungeCentre[1] * (1 - loungeSc))
    office.lounge.visible = loungeSc > 0.003
    renderer.shadowMap.needsUpdate = true
    kick(120)
  }

  const canFold = () => !focus.hovered && !focus.hoverDept && layU >= 1 && !rig.zoomed()

  function relayout() {
    const agents: Demand = {}
    for (const l of active()) if (!l.facts.parked) agents[l.facts.dept] = (agents[l.facts.dept] ?? 0) + 1
    const { desks, pending } = settle(applied, agents, canFold())
    pendingLayout = pending
    const next = layoutFloor(desks, floor)
    const moved = (id: DeptId) => next.zones[id].shown !== floor.zones[id].shown || next.zones[id].desks !== floor.zones[id].desks || next.zones[id].box.some((v, k) => v !== floor.zones[id].box[k])
    const changed = !booted || depts.some((d) => moved(d.id)) || next.bounds.x1 !== floor.bounds.x1 || next.bounds.z0 !== floor.bounds.z0
    applied = desks
    if (changed) applyLayout(next, !booted)
    const parked = active().some((l) => l.facts.parked)
    if (parked === loungeWant) return
    loungeWant = parked
    signs.get('park')!.obj.visible = parked
    if (layU >= 1) nav.rebuild(B1, offsetOf)
  }

  function assign() {
    const seated = active()
      .filter((l) => !l.facts.parked)
      .sort((a, b) => a.facts.createdAt - b.facts.createdAt)
    const next = assignDesks(new Map([...desks, ...claims]), seated.map((l) => ({ id: l.facts.id, dept: l.facts.dept })), (id) => applied[id] ?? 0)
    desks.clear()
    for (const [id, i] of next) desks.set(id, i)
    for (const id of claims.keys()) if (desks.has(id)) claims.delete(id)
    const usedLounge = new Set<number>()
    for (const l of live.values()) {
      const slot = l.gone || l.facts.parked ? undefined : scenes[l.facts.dept].slots[desks.get(l.facts.id)!]
      if (l.slot !== slot) {
        if (l.slot && ![...live.values()].some((o) => o !== l && o.slot === l.slot)) {
          drawPlate(l.slot, undefined)
          clearScreen(l.slot)
        }
        l.slot = slot
        l.screenKey = ''
      }
      if (l.facts.parked && !l.gone) {
        const keep = loungeOf.get(l.facts.id)
        if (keep !== undefined && !usedLounge.has(keep)) usedLounge.add(keep)
        else loungeOf.delete(l.facts.id)
      } else loungeOf.delete(l.facts.id)
    }
    for (const l of live.values()) {
      if (!l.facts.parked || l.gone || loungeOf.has(l.facts.id)) continue
      let i = 0
      while (usedLounge.has(i)) i++
      usedLounge.add(i)
      loungeOf.set(l.facts.id, i)
    }
  }

  function targetOf(l: Live): Target {
    const f = l.facts
    if (l.gone) return { p: doorVec, face: null, pose: 'stand', y: 0, home: false, homeKind: 'none', parked: false, needs: false, subs: 0 }
    const place = placementFor({ state: f.state, kind: kindOf(f.dept), parked: f.parked, queueIndex: l.queueIndex, spots: queueVecs.length, bench: (l.slot?.i ?? 0) < benchSeats })
    const lounged = loungeOf.get(f.id) ?? 0
    const p = place.anchor === 'queue' ? queueVecs[l.queueIndex]! : place.anchor === 'lounge' ? (loungeVecs[lounged] ?? loungeVecs[lounged % loungeVecs.length]!) : place.anchor === 'door' || !l.slot ? doorVec : l.slot[place.anchor]
    const seated = place.anchor === 'seat'
    return {
      p, face: place.faceCamera ? null : 0, pose: place.pose, y: place.y, home: seated, homeKind: l.slot?.kind ?? 'none', parked: f.parked, needs: f.state === 'needs-you',
      subs: seated && f.state === 'working' ? f.subagents.length : 0, miniCentre: seated ? l.slot!.mini : undefined,
    }
  }

  function spawn(a: Agent) {
    const walker = newWalker(doorVec)
    const chip = createChip({ click: () => select(a.id, true), enter: () => setHovered(a.id), leave: () => focus.hovered === a.id && setHovered(undefined) })
    labelScene.add(chip.obj)
    const c = kit.create(a.colour, doorVec, walker, booted, rnd)
    c.chipAt = chip.obj.position.copy(c.chipAt)
    c.proxy.userData.agent = a.id
    const l: Live = { facts: a, c, chip, gone: false, wait: 0, queueIndex: -1, target: { p: doorVec, face: null, pose: 'stand', y: 0, home: false, homeKind: 'none', parked: false, needs: false, subs: 0 }, screenKey: '' }
    live.set(a.id, l)
    return l
  }

  function leave(l: Live, i: number) {
    l.gone = true
    l.wait = i * 0.18
    if (focus.selected === l.facts.id) select(undefined, false)
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
    renderChip(l.chip, { title: f.title, caption: f.caption, colour: hexCss(f.colour), state: f.state, parked: f.parked, queueIndex: l.queueIndex, selected: focus.selected === f.id, dim, subs: f.subagents.length, badge: f.badge })
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
      const group = act.filter((l) => (id === 'park' ? l.facts.parked : l.facts.dept === id && !l.facts.parked)).map((l) => l.facts)
      const counts = id === 'park' ? (group.length ? [{ key: 'idle', label: 'asleep', n: group.length }] : []) : countsFor(group)
      renderSign(sign, id === 'park' ? parkedZone.name : dept[id].name, counts, id === 'park' ? 'Empty' : 'No agents', focus.hoverDept === id, !!focus.hoverDept && focus.hoverDept !== id)
      sign.w = sign.el.offsetWidth || sign.w
      sign.h = sign.el.offsetHeight || sign.h
    }
  }

  function drawMonitor() {
    const { c, x, t: tex } = office.myScreen, w = c.width, h = c.height, seated = active().filter((l) => !l.facts.parked)
    const n = (s: StateKey) => seated.filter((l) => stateKey(l.facts.state) === s).length
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
    x.fillText(`${n('working')} working · ${n('done')} done · ${n('idle')} idle`, 44, h - 30)
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
      act.map((l) => ({ id: l.facts.id, accountId: l.facts.accountId, state: l.facts.state, since: l.facts.since, stuckReason: l.facts.stuckReason })),
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
  function setHoverDept(id: DeptId | 'park' | undefined) {
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
  function select(id: string | undefined, fly: boolean) {
    focus.selected = id
    const l = id ? live.get(id) : undefined
    for (const other of live.values()) paint(other)
    ui.selected = l ? entry(l) : undefined
    if (l && fly) {
      rig.atOverview = false
      rig.follow = () => focusPoint(l)
      rig.flyTo(() => focusPoint(l), rig.zoomDistance(region(), innerHeight), undefined, 0.8)
    } else if (!l || rig.atOverview) rig.goOverview(false)
    kick()
  }
  function focusDept(id: DeptId | 'park') {
    const box = id === 'park' ? parkedZone.box : floor.zones[id].box
    const [x0, z0, x1, z1] = box
    const span = Math.max(x1 - x0, (z1 - z0) * 1.3)
    rig.atOverview = false
    rig.follow = undefined
    rig.flyTo(() => new THREE.Vector3((x0 + x1) / 2, 0.3, (z0 + z1) / 2), Math.min((rig.zoomDistance(region(), innerHeight) * Math.max(1.5, span / 4.4)), rig.overview.distance * 0.58), VIEW, 0.85)
  }

  function layoutView() {
    rig.layout(region(), innerWidth, innerHeight, B1)
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
      if (id) select(id, true)
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
    const [px0, pz0, px1, pz1] = parkedZone.box
    const zone = shown().find((d) => {
      const [x0, z0, x1, z1] = floor.zones[d.id].box
      return p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1
    })
    setHoverDept(zone?.id ?? (p.x >= px0 && p.x <= px1 && p.z >= pz0 && p.z <= pz1 ? 'park' : undefined))
  }
  const onLeave = () => {
    setHovered(undefined)
    setHoverDept(undefined)
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerleave', onLeave)

  const timers = [
    setInterval(() => {
      if (!document.hidden) office.tickAuction()
    }, 1000),
    setInterval(() => office.tickStatus(), 10_000),
  ]

  function deskChip(id: DeptId, i: number) {
    const key = `${id}:${i}`
    let chip = deskChips.get(key)
    if (!chip) {
      chip = createDeskChip(`New agent at ${dept[id].name} ${kindOf(id) === 'gym' ? 'treadmill' : 'desk'} ${i + 1}`, () => onNewDesk?.(id, i))
      labelScene.add(chip)
      deskChips.set(key, chip)
    }
    return chip
  }

  function layoutDeskChips(zoomed: boolean) {
    for (const chip of deskChips.values()) chip.visible = false
    if (!zoomed || !onNewDesk || layU < 1) return
    const taken = new Set(active().map((l) => l.slot))
    for (const d of shown())
      scenes[d.id].slots.forEach((slot, i) => {
        if (taken.has(slot)) return
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
      rects.push([x, y - sign.h, x + sign.w, y])
    }
    const items: LabelItem[] = []
    const byKey = new Map<string, Live>()
    for (const l of live.values()) {
      const who = labelled(l)
      const mode = l.gone ? 0 : chipMode(who, focus, zoomed)
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
            hw: chipHalfWidth(f.title, f.caption, far, f.state === 'working' && f.subagents.length > 0 && f.subagents.length < 3, l.queueIndex >= 0),
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
        for (const l of live.values())
          if (l.slot && !l.gone && l.facts.state === 'working' && l.target.home) {
            l.slot.scroll++
            drawScreen(l.slot, { colour: l.facts.colour, title: l.facts.title, state: 'working', caption: l.facts.caption })
          }
    }
    ledT += dt
    if (ledT > 0.25) {
      ledT = 0
      if (anims.plat.shown) office.blinkLeds()
    }
    let moved = false
    const faceCamera = (p: THREE.Vector3) => Math.atan2(camera.position.x - p.x, camera.position.z - p.z)
    const route = (a: THREE.Vector3, b: THREE.Vector3) => nav.route(a, b)
    for (const l of [...live.values()]) {
      if (l.slot?.belt && l.target.home && l.target.pose === 'run' && !l.c.walker.path.length) l.slot.belt.offset.y -= dt * 1.9
      let target = l.target
      if (l.gone && l.wait > 0) {
        l.wait -= dt
        target = { ...l.target, p: l.c.walker.pos }
      }
      const looking = focus.selected === l.facts.id || focus.hovered === l.facts.id
      moved = animate(l.c, target, kit, l.facts.colour, { dt, t, motion, faceCamera, route, looking, dim: isDim(labelled(l), focus), gone: l.gone }) || moved
      if (l.c.out >= 1) {
        dispose(l)
        refresh()
      }
    }
    stepLayout(dt)
    stepLounge(dt)
    if (pendingLayout && now - lastPend > 500) {
      lastPend = now
      refresh()
    }
    rig.step(dt)
    const cm = controls.update()
    office.drawClock()
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
  office.lounge.visible = false
  office.lounge.scale.setScalar(0.001)

  return {
    probe,
    sync,
    select,
    claimDesk(chatId: string, slot: number) {
      claims.set(chatId, slot)
      refresh()
    },
    setFilter,
    setReviews(requests: readonly ReviewRequest[]) {
      if (intray.update(requests, Date.now())) kick()
    },
    overview: () => select(undefined, false),
    escape() {
      if (focus.filter) return setFilter(undefined)
      if (focus.selected) return select(undefined, false)
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
      layoutChips()
      labels.render(labelScene, camera)
      for (const l of live.values()) if (l.chip.obj.visible && (loud(labelled(l)) || focus.selected === l.facts.id || focus.hovered === l.facts.id)) l.chip.el.style.zIndex = String(1000 + (Number(l.chip.el.style.zIndex) || 0))
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
