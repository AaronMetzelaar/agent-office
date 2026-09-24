import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { ChatState } from '../../src/shared/chat'
import { applyRegion, fitOverview, VIEW } from '../../src/renderer/office/camera'
import { chipHalfWidth, chipMode, countsFor, isDim, placeLabels, ringColourOf, ringColours, stateKey, type Labelled, type LabelItem } from '../../src/renderer/office/labels'
import { anchorsFor, dept, deptIds, kindOf, layoutFloor, queueSpots, type DeptId } from '../../src/renderer/office/layout'
import { noSeating, reseat } from '../../src/renderer/office/seating'
import { placementFor } from '../../src/renderer/office/pose'
import { buildQueue, queuePositions } from '../../src/shared/queue'

interface Sample {
  id: string
  dept: DeptId
  state: ChatState
  title: string
  caption: string
}

const fifteen: Sample[] = [
  ['mkt', 'working', 'Bid flow approach', 'Editing BidFlow.vue'],
  ['mkt', 'needs-you', 'Dialog flow CI fix', 'Waiting for you · Bash'],
  ['mkt', 'done', 'Czechia auction visibility', 'Done · ready to review'],
  ['adm', 'working', 'Dispute export', 'Reading disputes/index.vue'],
  ['mob', 'working', 'Close stale test PRs', 'Running gh pr close'],
  ['mob', 'idle', 'Push notification deep links', 'Idle 38m'],
  ['mob', 'needs-you', 'Bid alerts widget', 'Waiting for you · WebFetch'],
  ['plat', 'idle', 'Crowdin translations', 'Idle 52m'],
  ['plat', 'working', 'Worker template cleanup', 'Editing index.ts'],
  ['plat', 'idle', 'Refund webhook retries', 'Idle 7h'],
  ['side', 'working', 'Portfolio hero', '1 subagent exploring'],
  ['side', 'stuck', 'Office floor plan', 'Stuck · error'],
  ['side', 'needs-you', 'Cookbook pages', 'Waiting for you · WebFetch'],
  ['gym', 'working', 'Enigma RSA sweep', '3 subagents exploring'],
  ['gym', 'idle', 'Matter pairing', 'Idle 9h'],
].map(([dept, state, title, caption], i) => ({ id: `a${i}`, dept: dept as DeptId, state: state as ChatState, title: title!, caption: caption! }))

const overlaps = (a: readonly number[], b: readonly number[]) => a[0]! < b[2]! && b[0]! < a[2]! && a[1]! < b[3]! && b[1]! < a[3]!

function overview(samples: Sample[], zoomed: boolean) {
  const w = 1440, h = 853
  const region = { x0: 12, y0: 76, x1: w - 403 - 24, y1: h - 12 }
  const seating = reseat(noSeating, samples.map((s) => ({ id: s.id, dept: s.dept, spot: 'desk' as const, parked: false, recent: true })), true)
  const floor = layoutFloor(seating.size)
  const camera = new PerspectiveCamera(24, w / h, 0.5, 220)
  applyRegion(camera, region, w, h)
  const fit = fitOverview(camera, region, w, h, floor.frame)
  camera.position.copy(fit.target).addScaledVector(VIEW, zoomed ? fit.distance * 0.6 : fit.distance)
  camera.lookAt(fit.target)
  camera.updateMatrixWorld()
  const screen = (x: number, y: number, z: number) => {
    const p = new Vector3(x, y, z).project(camera)
    return [((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h] as const
  }
  const queue = queuePositions(buildQueue(samples.map((s) => ({ id: s.id, accountId: 'main', state: s.state, since: Number(s.id.slice(1)) }))))
  const signs = deptIds
    .filter((id) => floor.zones[id].shown)
    .map((id) => {
      const [x, y] = screen(floor.zones[id].box[0] + 0.25, 0.62, floor.zones[id].box[3])
      return [x, y - 40, x + 30 + dept[id].name.length * 6.5, y] as [number, number, number, number]
    })
  const items: LabelItem[] = []
  const labelled: Labelled[] = []
  for (const s of samples) {
    const queued = queue.get(s.id) ?? -1
    const who: Labelled = { id: s.id, dept: s.dept, state: s.state, parked: false, lounge: false, queued: queued >= 0 }
    labelled.push(who)
    const mode = chipMode(who, {}, zoomed)
    const place = placementFor({ state: s.state, kind: kindOf(s.dept), spot: 'desk', parked: false, queueIndex: queued, spots: queueSpots.length })
    const [bx, bz] = floor.zones[s.dept].world[seating.desks.get(s.id)!.slot]!
    const seat = anchorsFor(kindOf(s.dept), bx, bz).seat
    const [ax, az] = place.anchor === 'queue' ? queueSpots[queued]! : seat
    if (!mode) continue
    const [x, y] = screen(ax, 1.42 + place.y, az)
    const far = !zoomed
    items.push({ key: s.id, x, y, hw: chipHalfWidth(s.title, s.caption, far, false, queued >= 0), miniHw: queued >= 0 ? 22 : 14, h: (far ? 32 : 38) + (s.state === 'needs-you' ? (far ? 30 : 36) : 0), priority: who.queued ? 1 : 2, distance: 0 })
  }
  return { signs, placed: placeLabels(signs, items), items, labelled }
}

describe('overview labels', () => {
  it('shows compact signs plus tags only for agents that need you or are stuck', () => {
    const { items } = overview(fifteen, false)
    expect(items.map((it) => fifteen.find((s) => s.id === it.key)!.title).sort()).toEqual(['Bid alerts widget', 'Cookbook pages', 'Dialog flow CI fix', 'Office floor plan'])
  })

  it('never overlaps signs or tags with 15 agents across every department', () => {
    for (const zoomed of [false, true]) {
      const { signs, placed } = overview(fifteen, zoomed)
      const rects = [...signs, ...[...placed.values()].filter((p) => p.show).map((p) => p.rect!)]
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]!, rects[j]!), `${zoomed ? 'zoomed' : 'overview'} ${i}/${j}`).toBe(false)
      if (!zoomed) expect([...placed.values()].every((p) => p.show)).toBe(true)
    }
  })

  it('keeps every floor ring in its state colour whether or not the tag shows', () => {
    const { labelled } = overview(fifteen, false)
    const expected: Record<string, number> = { working: 0x1b34ff, 'needs-you': 0xf59e0b, done: 0x15a34a, idle: 0x9ca3af, stuck: 0xdc2626 }
    for (const who of labelled) {
      expect(ringColourOf(who)).toBe(expected[who.state])
      expect(ringColourOf(who)).toBe(ringColours[stateKey(who.state)])
    }
    expect(labelled.filter((who) => chipMode(who, {}, false) === 0).length).toBeGreaterThan(0)
  })

  it('shows every tag in a department on hover, and lounge tags only when hovering the Lounge', () => {
    const working: Labelled = { id: 'w', dept: 'mob', state: 'working', parked: false, lounge: false, queued: false }
    const parked: Labelled = { id: 'p', dept: 'mob', state: 'idle', parked: true, lounge: true, queued: false }
    expect(chipMode(working, {}, false)).toBe(0)
    expect(chipMode(working, { hoverDept: 'mob' }, false)).toBe(1)
    expect(chipMode(working, {}, true)).toBe(1)
    expect(chipMode(working, { hovered: 'w' }, false)).toBe(2)
    expect(chipMode(parked, {}, true)).toBe(0)
    expect(chipMode(parked, { hoverDept: 'lounge' }, false)).toBe(1)
  })
})

describe('highlighting', () => {
  const people: Labelled[] = fifteen.map((s) => ({ id: s.id, dept: s.dept, state: s.state, parked: false, lounge: false, queued: s.state === 'needs-you' }))

  it('hovering a department highlights its agents and dims the rest', () => {
    const lit = people.filter((p) => !isDim(p, { hoverDept: 'mkt' }))
    expect(lit.map((p) => p.dept)).toEqual(['mkt', 'mkt', 'mkt'])
  })

  it('clicking "3 need you" in the tally highlights exactly those three', () => {
    const count = countsFor(people).find((c) => c.key === 'needs')!
    expect(count).toEqual({ key: 'needs', label: 'needs you', n: 3 })
    const lit = people.filter((p) => !isDim(p, { filter: 'needs' }))
    expect(lit.map((p) => fifteen.find((s) => s.id === p.id)!.title)).toEqual(['Dialog flow CI fix', 'Bid alerts widget', 'Cookbook pages'])
    expect(people.filter((p) => chipMode(p, { filter: 'needs' }, false) > 0)).toEqual(lit)
  })

  it('counts each department in the sign order, with needs-you first', () => {
    expect(countsFor(fifteen.filter((s) => s.dept === 'side'))).toEqual([
      { key: 'needs', label: 'needs you', n: 1 },
      { key: 'stuck', label: 'stuck', n: 1 },
      { key: 'working', label: 'working', n: 1 },
    ])
  })
})
