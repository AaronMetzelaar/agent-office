import { describe, expect, it } from 'vitest'
import { dozes, seated } from '../../src/renderer/office/characters'
import { activities, activityAt, dozeFor, errandAt, errandEvery, errandFor, errands, fabrics, holdSeconds, lookFor, maxTurn, seatTypes } from '../../src/renderer/office/lounge'

const ids = Array.from({ length: 400 }, (_, i) => `chat-${i}-${(i * 7919).toString(36)}`)

describe('lounge looks', () => {
  it('gives a chat the same look and doze every time', () => {
    for (const id of ids.slice(0, 20)) {
      expect(lookFor(id)).toEqual(lookFor(id))
      expect(dozeFor(id)).toBe(dozeFor(id))
    }
  })

  it('uses every seat type, fabric and doze posture', () => {
    const some = ids.slice(0, 50)
    expect(new Set(some.map((id) => lookFor(id).type))).toEqual(new Set(seatTypes))
    expect(new Set(some.map((id) => lookFor(id).fabric))).toEqual(new Set(fabrics))
    expect(new Set(some.map(dozeFor))).toEqual(new Set([0, 1, 2]))
  })

  it('usually shows three seat types among five occupants', () => {
    let hits = 0, sets = 0
    for (let i = 0; i + 5 <= ids.length; i += 5, sets++) if (new Set(ids.slice(i, i + 5).map((id) => lookFor(id).type)).size >= 3) hits++
    expect(hits / sets).toBeGreaterThanOrEqual(0.75)
  })

  it('keeps the turn within a few degrees', () => {
    for (const id of ids) expect(Math.abs(lookFor(id).turn)).toBeLessThanOrEqual(maxTurn)
  })
})

describe('lounge activities', () => {
  it('holds an activity for a whole span and then moves on', () => {
    const start = holdSeconds * 3
    const a = activityAt(start + 0.01, 0)
    expect(activityAt(start + holdSeconds - 0.01, 0)).toBe(a)
    expect(activityAt(start + holdSeconds + 0.01, 0)).not.toBe(a)
  })

  it('cycles through every activity', () => {
    expect(new Set(Array.from({ length: activities.length }, (_, k) => activityAt(k * holdSeconds + 1, 0)))).toEqual(new Set(activities))
  })

  it('keeps agents with spread phases out of step', () => {
    const phases = [0.3, 1.9, 3.4, 5.1]
    for (let t = 0; t < holdSeconds * 8; t += 0.5) expect(new Set(phases.map((p) => activityAt(t, p))).size).toBeGreaterThanOrEqual(2)
  })

  it('handles negative scene time', () => {
    expect(activities).toContain(activityAt(-5, 1))
  })
})

describe('lounge poses', () => {
  it('keeps every awake activity visibly open-eyed, and every doze closed', () => {
    const asleep = Math.max(...dozes.map((d) => d.eye))
    for (const a of activities) expect(seated[a].eye).toBeGreaterThanOrEqual(0.6)
    expect(asleep).toBeLessThan(0.2)
  })

  it('offers three distinct dozing postures', () => {
    expect(new Set(dozes.map((d) => JSON.stringify(d))).size).toBe(3)
  })
})

describe('lounge errands', () => {
  it('sends an agent on an errand for a stretch of every round and keeps it seated otherwise', () => {
    let away = 0, samples = 0
    for (let t = 0; t < errandEvery * 20; t += 0.5, samples++) if (errandAt(t, 1.3)) away++
    expect(away / samples).toBeCloseTo(errandFor / errandEvery, 1)
  })

  it('keeps one errand for its whole outing', () => {
    for (let t = 0; t < errandEvery * 10; t += 0.25) {
      const now = errandAt(t, 2.2), next = errandAt(t + 0.25, 2.2)
      if (now && next && now.round === next.round) expect(next.errand).toBe(now.errand)
    }
  })

  it('uses every errand, smoking included, across rounds and agents', () => {
    const seen = new Set<string>()
    for (let k = 0; k < 40; k++) for (const phase of [0.4, 2.1, 3.7, 5.2]) {
      const e = errandAt(k * errandEvery + 1 - (phase / (Math.PI * 2)) * errandEvery, phase)
      if (e) seen.add(e.errand)
    }
    expect(seen).toEqual(new Set(errands))
  })

  it('keeps agents with spread phases from all leaving at once', () => {
    const phases = [0.3, 1.4, 2.6, 3.9, 5.1]
    for (let t = 0; t < errandEvery * 4; t += 0.5) expect(phases.filter((p) => errandAt(t, p)).length).toBeLessThan(phases.length)
  })
})
