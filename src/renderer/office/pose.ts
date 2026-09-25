import type { ChatState } from '../../shared/chat'
import type { SlotKind } from './layout'
import type { Spot } from './standby'

export type PoseName = 'stand' | 'sleep' | 'type' | 'lean' | 'sit' | 'lounge' | 'wave' | 'relax' | 'run' | 'wait' | 'smoke'
export type Anchor = 'queue' | 'seat' | 'stand' | 'lounge' | 'cooler' | 'door' | 'smoke'

export interface Placement {
  anchor: Anchor
  pose: PoseName
  y: number
  faceCamera: boolean
}

export interface PlacementInput {
  state: ChatState
  kind: SlotKind
  spot: Spot
  parked: boolean
  queueIndex: number
  spots: number
  smoking?: boolean
}

const busy = (state: ChatState) => state === 'working' || state === 'starting'

export function placementFor({ state, kind, spot, parked, queueIndex, spots, smoking }: PlacementInput): Placement {
  const queued = queueIndex >= 0
  if (queued && queueIndex < spots) return { anchor: 'queue', pose: queueIndex === 0 && state === 'needs-you' ? 'wave' : 'wait', y: 0, faceCamera: true }
  if (spot === 'lounge' && smoking) return { anchor: 'smoke', pose: 'smoke', y: 0, faceCamera: true }
  if (spot === 'lounge') return { anchor: 'lounge', pose: parked ? 'sleep' : 'lounge', y: 0.36, faceCamera: false }
  if (queued) return { anchor: 'stand', pose: state === 'needs-you' ? 'wave' : 'wait', y: 0, faceCamera: true }
  if (spot === 'cooler') return { anchor: 'cooler', pose: 'relax', y: 0, faceCamera: true }
  if (kind === 'gym') return busy(state) ? { anchor: 'seat', pose: 'run', y: 0.125, faceCamera: false } : { anchor: 'seat', pose: 'wait', y: 0.125, faceCamera: true }
  return { anchor: 'seat', pose: busy(state) ? 'type' : state === 'done' ? 'lean' : 'sit', y: 0.4, faceCamera: false }
}
