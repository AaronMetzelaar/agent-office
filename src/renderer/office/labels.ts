import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { ChatState } from '../../shared/chat'
import { iconSvg } from '../icons'
import type { DeptId } from './layout'

export type StateKey = 'needs' | 'stuck' | 'working' | 'done' | 'idle'
export const stateKey = (state: ChatState): StateKey => (state === 'needs-you' ? 'needs' : state === 'starting' ? 'working' : state)

export const ringColours: Record<StateKey, number> = { working: 0x1b34ff, needs: 0xf59e0b, done: 0x15a34a, idle: 0x9ca3af, stuck: 0xdc2626 }
export const parkedRing = 0xb9bfc9
export const ringColourOf = (a: { state: ChatState; parked: boolean }) => (a.parked && a.state !== 'done' ? parkedRing : ringColours[stateKey(a.state)])

export const countOrder: [StateKey, string][] = [
  ['needs', 'needs you'],
  ['stuck', 'stuck'],
  ['working', 'working'],
  ['done', 'done'],
  ['idle', 'idle'],
]

export function countsFor(agents: readonly { state: ChatState }[]): { key: StateKey; label: string; n: number }[] {
  return countOrder.map(([key, label]) => ({ key, label, n: agents.filter((a) => stateKey(a.state) === key).length })).filter((c) => c.n > 0)
}

export interface Focus {
  hoverDept?: DeptId | 'lounge'
  filter?: StateKey
  selected?: string
  hovered?: string
}

export interface Labelled {
  id: string
  dept: DeptId
  state: ChatState
  parked: boolean
  lounge: boolean
  queued: boolean
}

export const loud = (a: Labelled) => a.queued || a.state === 'needs-you' || a.state === 'stuck'
const inGroup = (a: Labelled, group: DeptId | 'lounge') => (group === 'lounge' ? a.lounge : a.dept === group && !a.lounge)

export function isDim(a: Labelled, f: Focus): boolean {
  return (!!f.hoverDept && !inGroup(a, f.hoverDept)) || (!!f.filter && stateKey(a.state) !== f.filter)
}

export function chipMode(a: Labelled, f: Focus): 0 | 1 | 2 {
  if (a.id === f.selected || a.id === f.hovered) return 2
  if (a.lounge) return f.hoverDept === 'lounge' || (!!f.filter && stateKey(a.state) === f.filter) ? 1 : 0
  return !f.filter || stateKey(a.state) === f.filter ? 1 : 0
}

export function chipHalfWidth(title: string, caption: string, far: boolean, extra: boolean, queued: boolean): number {
  return ((far ? 0.9 : 1) * (30 + Math.min(far ? 170 : 190, Math.max(title.length * 6.2, caption.length * 6.05))) + (extra && !far ? 26 : 0) + (queued ? 14 : 0)) / 2
}

export interface LabelItem {
  key: string
  x: number
  y: number
  hw: number
  miniHw: number
  h: number
  priority: number
  distance: number
}

export interface Placed {
  show: boolean
  dx: number
  lift: number
  mini: boolean
  rect?: [number, number, number, number]
}

const offsets = [[0, 0], [0, 24], [0, 48], [-1, 0], [1, 0], [0, 72], [-1, 24], [1, 24], [-1, 48], [1, 48], [0, 96], [0, -64], [-1, -64], [1, -64], [0, -88], [-1, 72], [1, 72], [0, 120], [-1, -88], [1, -88]] as const

export function placeLabels(signs: readonly [number, number, number, number][], items: readonly LabelItem[]): Map<string, Placed> {
  const placed = [...signs]
  const out = new Map<string, Placed>()
  const fits = (it: LabelItem, hw: number, dx: number, lift: number) =>
    !placed.some((r) => it.x + dx - hw < r[2] + 6 && it.x + dx + hw > r[0] - 6 && it.y - it.h - lift < r[3] + 4 && it.y - lift > r[1] - 4)
  const put = (it: LabelItem, hw: number, dx: number, lift: number, mini: boolean) => {
    const rect: [number, number, number, number] = [it.x + dx - hw, it.y - it.h - lift, it.x + dx + hw, it.y - lift]
    placed.push(rect)
    out.set(it.key, { show: true, dx, lift, mini, rect })
  }
  for (const it of [...items].sort((a, b) => a.priority - b.priority || a.distance - b.distance)) {
    const full = offsets.find(([sx, lift]) => fits(it, it.hw, sx * (it.hw + 10), lift))
    if (full) {
      put(it, it.hw, full[0] * (it.hw + 10), full[1], false)
      continue
    }
    if (it.priority === 0) {
      put(it, it.hw, 0, 0, false)
      continue
    }
    if (it.priority > 1) {
      out.set(it.key, { show: false, dx: 0, lift: 0, mini: false })
      continue
    }
    const small = offsets.find(([sx, lift]) => fits(it, it.miniHw, sx * (it.miniHw + 10), lift)) ?? offsets[0]
    put(it, it.miniHw, small[0] * (it.miniHw + 10), small[1], true)
  }
  return out
}

export interface Chip {
  el: HTMLDivElement
  obj: CSS2DObject
  title: HTMLSpanElement
  caption: HTMLSpanElement
  dot: HTMLSpanElement
  bubble: HTMLSpanElement
  number: HTMLSpanElement
  extra: HTMLSpanElement
  badge: HTMLSpanElement
  sim: HTMLSpanElement
  acts: HTMLSpanElement
  lounge: HTMLButtonElement
  shown?: string
  key: string
  dx: number
  lift: number
  mini: boolean
}

const span = (className: string, parent: HTMLElement) => {
  const el = document.createElement('span')
  el.className = className
  parent.append(el)
  return el
}

export type ChipActions = 'both' | 'done' | undefined

export type ChipAction = 'lounge' | 'done'

export function createChip(on: { click(): void; enter(): void; leave(): void; act(action: ChipAction): void }): Chip {
  const el = document.createElement('div')
  el.setAttribute('role', 'button')
  el.tabIndex = -1
  el.addEventListener('click', (event) => {
    event.stopPropagation()
    on.click()
  })
  el.addEventListener('pointerenter', on.enter)
  el.addEventListener('pointerleave', on.leave)
  const bubble = span('bang', el)
  bubble.setAttribute('aria-hidden', 'true')
  bubble.textContent = '!'
  const number = span('qn', el)
  const dot = span('cd', el)
  const tx = span('tx', el)
  const title = span('tt', tx)
  const caption = span('dn', tx)
  const extra = span('ex', el)
  const badge = span('ab', el)
  const sim = span('sim', el)
  sim.textContent = '📱'
  sim.title = 'Using the iOS Simulator'
  sim.setAttribute('aria-hidden', 'true')
  const acts = span('acts', el)
  acts.hidden = true
  const labels: Record<ChipAction, [string, string]> = {
    lounge: ['Lounge', 'Lounge: move it to the lounge, keeping its desk'],
    done: ['Done', 'Done: finish the chat and remove its worktree'],
  }
  const [lounge] = (['lounge', 'done'] as const).map((action) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = action
    button.innerHTML = iconSvg(action, 13)
    button.setAttribute('aria-label', labels[action][0])
    button.title = labels[action][1]
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      on.act(action)
    })
    acts.append(button)
    return button
  })
  const obj = new CSS2DObject(el)
  obj.center.set(0.5, 1)
  obj.visible = false
  return { el, obj, title, caption, dot, bubble, number, extra, badge, sim, acts, lounge: lounge!, key: '', dx: 0, lift: 0, mini: false }
}

export function createDeskChip(label: string, click: () => void): CSS2DObject {
  const el = document.createElement('div')
  el.className = 'chip new'
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', label)
  el.title = label
  el.append('+', Object.assign(document.createElement('span'), { textContent: ' New agent' }))
  el.addEventListener('click', (event) => {
    event.stopPropagation()
    click()
  })
  const obj = new CSS2DObject(el)
  obj.center.set(0.5, 1)
  obj.visible = false
  return obj
}

export interface ChipView {
  title: string
  caption: string
  colour: string
  state: ChatState
  parked: boolean
  queueIndex: number
  selected: boolean
  dim: boolean
  subs: number
  badge?: string
  sim: boolean
}

export function renderChip(chip: Chip, v: ChipView) {
  const key = JSON.stringify(v)
  if (key === chip.key) return false
  chip.key = key
  const queued = v.queueIndex >= 0
  const extra = v.state === 'working' && v.subs > 0 && !v.parked
  chip.el.className = ['chip', stateKey(v.state), v.parked && 'parked', queued && 'q', v.selected && 'sel', v.dim && 'dim', chip.mini && 'mini'].filter(Boolean).join(' ')
  chip.bubble.hidden = !(v.state === 'needs-you' || (v.state === 'stuck' && queued))
  chip.bubble.classList.toggle('warn', v.state === 'stuck')
  chip.number.hidden = !queued
  chip.number.textContent = queued ? String(v.queueIndex + 1) : ''
  chip.dot.style.background = v.colour
  chip.title.textContent = v.title
  chip.caption.textContent = v.caption
  chip.extra.hidden = !extra
  chip.extra.textContent = extra ? `+${v.subs}` : ''
  chip.badge.hidden = !v.badge
  chip.badge.textContent = v.badge ?? ''
  chip.sim.hidden = !v.sim
  chip.el.setAttribute('aria-label', `${v.title}, ${queued ? `number ${v.queueIndex + 1} at your door, ` : ''}${v.caption}${v.sim ? ', using the iOS Simulator' : ''}`)
  return true
}

export function setChipActions(chip: Chip, acts: ChipActions) {
  if (chip.shown === acts) return
  chip.shown = acts
  chip.acts.hidden = !acts
  chip.lounge.hidden = acts !== 'both'
}

export function setChipPlacement(chip: Chip, p: Placed) {
  chip.obj.visible = p.show
  if (p.mini !== chip.mini) {
    chip.mini = p.mini
    chip.el.classList.toggle('mini', p.mini)
  }
  if (p.dx !== chip.dx || p.lift !== chip.lift) {
    chip.dx = p.dx
    chip.lift = p.lift
    chip.el.style.setProperty('--dx', `${p.dx}px`)
    chip.el.style.setProperty('--lift', `${-p.lift}px`)
  }
}

export interface Sign {
  el: HTMLButtonElement
  obj: CSS2DObject
  name: HTMLElement
  counts: HTMLSpanElement
  path: HTMLSpanElement
  key: string
  w: number
  h: number
}

export function createSign(name: string, path: string, accent: string | undefined, on: { enter(): void; leave(): void; click(): void }): Sign {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = accent ? 'sign' : 'sign park'
  if (accent) el.style.setProperty('--ac', accent)
  el.addEventListener('pointerenter', on.enter)
  el.addEventListener('pointerleave', on.leave)
  el.addEventListener('focus', on.enter)
  el.addEventListener('blur', on.leave)
  el.addEventListener('click', (event) => {
    event.stopPropagation()
    on.click()
  })
  const label = document.createElement('b')
  span('sn', el).append(document.createElement('i'), label)
  const sub = span('sp', el)
  sub.textContent = path
  const counts = span('cts', el)
  const obj = new CSS2DObject(el)
  obj.center.set(0, 1)
  const sign = { el, obj, counts, name: label, path: sub, key: '', w: 150, h: 44 }
  setSignName(sign, name)
  return sign
}

export function setSignName(sign: Pick<Sign, 'el' | 'name'>, name: string) {
  if (sign.name.textContent === name) return
  sign.name.textContent = name
  sign.el.title = name
}

export function signNames(rooms: readonly { id: string; name: string; parent?: string }[]): Map<string, string> {
  const clash = (name: string) => rooms.filter((room) => room.name === name).length > 1
  return new Map(rooms.map((room) => [room.id, clash(room.name) && room.parent ? `${room.name} · ${room.parent}` : room.name]))
}

export function renderSign(sign: Sign, name: string, counts: { key: string; label: string; n: number }[], empty: string, on: boolean, dim: boolean, path = sign.path.textContent ?? '') {
  const key = JSON.stringify([name, path, counts, on, dim])
  if (key === sign.key) return
  sign.key = key
  setSignName(sign, name)
  sign.path.textContent = path
  sign.counts.replaceChildren(
    ...(counts.length
      ? counts.map((c) => {
          const el = document.createElement('span')
          el.className = c.key
          const dot = document.createElement('i')
          dot.className = `sd ${c.key}`
          const label = document.createElement('em')
          label.textContent = ` ${c.label}`
          el.append(dot, String(c.n), label)
          return el
        })
      : [Object.assign(document.createElement('span'), { textContent: empty })]),
  )
  sign.el.classList.toggle('on', on)
  sign.el.classList.toggle('dim', dim)
  sign.el.setAttribute('aria-label', `${name}, ${counts.map((c) => `${c.n} ${c.label}`).join(', ') || empty}`)
}
