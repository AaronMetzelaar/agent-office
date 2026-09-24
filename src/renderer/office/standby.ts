import type { ChatState } from '../../shared/chat'
import type { Demand, DeptId } from './layout'

export type Spot = 'desk' | 'cooler' | 'lounge'

export interface Resting {
  state: ChatState
  parked: boolean
  dept: DeptId
}

const active = new Set<ChatState>(['starting', 'working', 'needs-you', 'stuck'])

export function spotFor(agent: Resting, prev: Spot | undefined, open: boolean): Spot {
  const want: Spot = active.has(agent.state) ? 'desk' : agent.state === 'done' && !agent.parked ? (agent.dept === 'gym' ? 'cooler' : 'desk') : 'lounge'
  return open && want === 'lounge' && prev && prev !== 'lounge' ? prev : want
}

export function demandOf(agents: readonly { dept: DeptId; spot: Spot }[]): { seated: Demand; present: Set<DeptId>; standby: number } {
  const seated: Demand = {}
  const present = new Set<DeptId>()
  let standby = 0
  for (const { dept, spot } of agents) {
    if (spot === 'desk') seated[dept] = (seated[dept] ?? 0) + 1
    else if (spot === 'cooler') present.add(dept)
    else standby++
  }
  return { seated, present, standby }
}
