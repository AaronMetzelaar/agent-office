import { isBusy, type ChatState } from '../../shared/chat'
import { kindOf, type DeptId } from './layout'

export type Spot = 'desk' | 'cooler' | 'lounge'

export interface Resting {
  state: ChatState
  parked: boolean
  dept: DeptId
}

export const canRest = (state: ChatState) => state === 'done' || state === 'idle' || state === 'stuck'

export function spotFor(agent: Resting, prev: Spot | undefined, open: boolean, sent = false): Spot {
  if (isBusy(agent.state)) return 'desk'
  if (sent) return 'lounge'
  const want: Spot = agent.state === 'stuck' ? 'desk' : agent.state === 'done' && !agent.parked ? (kindOf(agent.dept) === 'gym' ? 'cooler' : 'desk') : 'lounge'
  return open && want === 'lounge' && prev && prev !== 'lounge' ? prev : want
}
