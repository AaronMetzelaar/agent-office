import type { ChatState } from '../../shared/chat'
import type { SlotKind } from './layout'

export type PoseName = 'stand' | 'sleep' | 'type' | 'lean' | 'slump' | 'sit' | 'wave' | 'relax' | 'run' | 'wait'
export type Anchor = 'queue' | 'seat' | 'stand' | 'lounge' | 'bench' | 'relax' | 'door'

export interface Placement {
  anchor: Anchor
  pose: PoseName
  y: number
  faceCamera: boolean
}

export interface PlacementInput {
  state: ChatState
  kind: SlotKind
  parked: boolean
  queueIndex: number
  spots: number
  bench: boolean
}

const busy = (state: ChatState) => state === 'working' || state === 'starting'

export function placementFor({ state, kind, parked, queueIndex, spots, bench }: PlacementInput): Placement {
  const queued = queueIndex >= 0
  if (queued && queueIndex < spots) return { anchor: 'queue', pose: queueIndex === 0 && state === 'needs-you' ? 'wave' : 'wait', y: 0, faceCamera: true }
  if (parked) return { anchor: 'lounge', pose: busy(state) || queued ? 'sit' : 'sleep', y: 0.15, faceCamera: false }
  if (queued) return { anchor: 'stand', pose: state === 'needs-you' ? 'wave' : 'wait', y: 0, faceCamera: true }
  if (kind === 'gym') {
    if (busy(state)) return { anchor: 'seat', pose: 'run', y: 0.125, faceCamera: false }
    if (state === 'done' || !bench) return { anchor: 'relax', pose: state === 'done' ? 'relax' : 'wait', y: 0, faceCamera: true }
    return { anchor: 'bench', pose: 'sit', y: 0.4, faceCamera: false }
  }
  return { anchor: 'seat', pose: busy(state) ? 'type' : state === 'done' ? 'lean' : 'slump', y: 0.4, faceCamera: false }
}
