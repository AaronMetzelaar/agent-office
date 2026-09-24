import type { ChatStore } from '../store/chats'

export function whenIdle(store: Pick<ChatStore, 'busy' | 'events'>, fire: () => void): () => void {
  const check = () => {
    if (store.busy()) return
    stop()
    fire()
  }
  const stop = () => void store.events.off('patch', check)
  store.events.on('patch', check)
  check()
  return stop
}
