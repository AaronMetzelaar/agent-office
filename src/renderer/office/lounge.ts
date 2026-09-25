export const seatTypes = ['armchair', 'beanbag', 'tub', 'pouf'] as const
export type SeatType = (typeof seatTypes)[number]

export const fabrics = [0xc9d3e0, 0xe8b4a0, 0x9fc5a8, 0xf0d58c, 0xb9a7d6, 0x8fb8d8] as const

export const activities = ['read', 'sip', 'phone', 'gaze'] as const
export type Activity = (typeof activities)[number]

export const holdSeconds = 24
export const maxTurn = 0.12

export interface SeatLook {
  type: SeatType
  fabric: number
  turn: number
}

export function hashOf(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193)
  h ^= h >>> 16
  h = Math.imul(h, 0x45d9f3b)
  return (h ^ (h >>> 16)) >>> 0
}

export function lookFor(id: string): SeatLook {
  const h = hashOf(id)
  return {
    type: seatTypes[h % seatTypes.length]!,
    fabric: fabrics[Math.floor(h / seatTypes.length) % fabrics.length]!,
    turn: ((Math.floor(h / 64) % 1000) / 999 - 0.5) * 2 * maxTurn,
  }
}

export const lookKey = (l: SeatLook) => `${l.type}:${l.fabric}:${l.turn.toFixed(3)}`

export const dozeFor = (id: string) => Math.floor(hashOf(id) / 7) % 3

export function activityAt(t: number, phase: number): Activity {
  const span = Math.floor(t / holdSeconds + (phase / (Math.PI * 2)) * activities.length)
  return activities[((span % activities.length) + activities.length) % activities.length]!
}
