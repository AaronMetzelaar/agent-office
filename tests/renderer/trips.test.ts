import { describe, expect, it } from 'vitest'
import { builtDesks, noSeating, reseat, type Sitter } from '../../src/renderer/office/seating'
import { createTrips, tripSize, tripTimes, type Job } from '../../src/renderer/office/trips'

const total = Object.values(tripTimes).reduce((sum, t) => sum + t, 0)
const job = (id: string, slot = 0): Job => ({ id, dept: 'mkt', slot })

function run(trips: ReturnType<typeof createTrips>, seconds: number, dt = 1 / 60) {
  const log: { t: number; picked: string[]; cleared: string[] }[] = []
  for (let t = dt; t <= seconds + 1e-9; t += dt) {
    const { picked, cleared } = trips.step(dt)
    if (picked.length || cleared.length) log.push({ t, picked: picked.map((j) => j.id), cleared: cleared.map((j) => j.id) })
  }
  return log
}

describe('the movers', () => {
  it('takes about 4 to 6 seconds and walks through arrive, fetch, pickup, carry, load and leave', () => {
    expect(total).toBeGreaterThanOrEqual(4)
    expect(total).toBeLessThanOrEqual(6)
    const trips = createTrips()
    trips.add(job('a'))
    const seen: string[] = []
    for (let k = 0; k < 400 && trips.trip; k++) {
      if (seen.at(-1) !== trips.trip.phase) seen.push(trips.trip.phase)
      trips.step(1 / 60)
    }
    expect(seen).toEqual(['arrive', 'fetch', 'pickup', 'carry', 'load', 'leave'])
    expect(trips.trip).toBeUndefined()
  })

  it('clears the desk only after the truck has left', () => {
    const trips = createTrips()
    trips.add(job('a'))
    const log = run(trips, total + 1)
    const picked = tripTimes.arrive + tripTimes.fetch + tripTimes.pickup
    expect(log).toEqual([
      { t: expect.closeTo(picked, 1), picked: ['a'], cleared: [] },
      { t: expect.closeTo(total, 1), picked: [], cleared: ['a'] },
    ])
    expect(log[1]!.t).toBeGreaterThanOrEqual(total - 1e-6)

    const chats: Sitter[] = [
      { id: 'a', dept: 'mkt', spot: 'desk', parked: false, recent: true },
      { id: 'b', dept: 'mkt', spot: 'desk', parked: false, recent: true },
    ]
    const before = reseat(noSeating, chats, true)
    const moving = reseat(before, [{ ...chats[0]!, spot: 'gone' }, chats[1]!], true)
    expect(moving).toMatchObject({ repack: false, size: before.size })
    const after = reseat(moving, [chats[1]!], true)
    expect(builtDesks(after, 'mkt')).toEqual([0, 1])
  })

  it('shares one truck for Dones that arrive together, and queues the rest for the next trip', () => {
    const trips = createTrips()
    trips.add(job('a', 0))
    trips.step(0.2)
    trips.add(job('b', 1))
    trips.add(job('c', 2))
    trips.add(job('d', 3))
    expect(trips.trip!.jobs.map((j) => j.id)).toEqual(['a', 'b', 'c'])
    expect(trips.trip!.jobs).toHaveLength(tripSize)
    expect(trips.queued.map((j) => j.id)).toEqual(['d'])
    trips.step(tripTimes.arrive)
    trips.add(job('e', 4))
    expect(trips.queued.map((j) => j.id)).toEqual(['d', 'e'])
    expect(trips.holds('e')).toBe(true)
    const log = run(trips, total * 2 + 1)
    expect(log.filter((entry) => entry.cleared.length).map((entry) => entry.cleared)).toEqual([['a', 'b', 'c'], ['d', 'e']])
    expect(trips.trip).toBeUndefined()
  })
})
