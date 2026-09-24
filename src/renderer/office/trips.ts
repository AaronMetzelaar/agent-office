import type { DeptId } from './layout'

export interface Job {
  id: string
  dept: DeptId
  slot: number
}

export const tripTimes = { arrive: 0.9, fetch: 1.3, pickup: 0.5, carry: 1.3, load: 0.4, leave: 0.8 }
export type Phase = keyof typeof tripTimes
export const tripSize = 3
const phases = Object.keys(tripTimes) as Phase[]

export interface Trip {
  jobs: Job[]
  phase: Phase
  t: number
}

export function createTrips() {
  const queue: Job[] = []
  let trip: Trip | undefined

  const start = () => {
    trip = queue.length ? { jobs: queue.splice(0, tripSize), phase: 'arrive', t: 0 } : undefined
  }

  return {
    get trip(): Readonly<Trip> | undefined {
      return trip
    },
    get queued(): readonly Job[] {
      return queue
    },
    holds: (id: string) => !!trip?.jobs.some((job) => job.id === id) || queue.some((job) => job.id === id),
    add(job: Job): void {
      if (trip?.phase === 'arrive' && trip.jobs.length < tripSize) trip.jobs.push(job)
      else queue.push(job)
      if (!trip) start()
    },
    step(dt: number): { picked: Job[]; cleared: Job[] } {
      const out = { picked: [] as Job[], cleared: [] as Job[] }
      let left = dt
      while (trip && left > 0) {
        const room = tripTimes[trip.phase] - trip.t
        if (left < room) {
          trip.t += left
          break
        }
        left -= room
        const next = phases[phases.indexOf(trip.phase) + 1]
        if (trip.phase === 'pickup') out.picked.push(...trip.jobs)
        if (next) Object.assign(trip, { phase: next, t: 0 })
        else {
          out.cleared.push(...trip.jobs)
          start()
        }
      }
      return out
    },
  }
}
