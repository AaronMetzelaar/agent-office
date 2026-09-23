import type { ChatState } from '../../../shared/chat'

const midTurn = new Set<ChatState>(['starting', 'working', 'needs-you'])

export const endedTurn = (before: ChatState | undefined, after: ChatState) => !!before && midTurn.has(before) && !midTurn.has(after)

export function createRefresher(load: () => Promise<void>, delayMs = 300) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let again = false
  const fire = async () => {
    timer = undefined
    if (running) return void (again = true)
    running = true
    try {
      await load()
    } finally {
      running = false
      if (again) {
        again = false
        poke()
      }
    }
  }
  const poke = () => {
    clearTimeout(timer)
    timer = setTimeout(fire, delayMs)
  }
  return { poke, stop: () => clearTimeout(timer) }
}
