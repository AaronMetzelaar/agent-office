import type { ChatView } from '../../shared/chat'
import { artifacts } from '../panels/chat/rows'

const key = 'agent-office:seen-artifacts'
let seen: Record<string, string> | undefined

const load = () => (seen ??= JSON.parse(globalThis.localStorage?.getItem(key) ?? '{}') as Record<string, string>)
const newest = (chat: Pick<ChatView, 'rows'>) => [...artifacts(chat.rows).keys()].at(-1)

export function hasNewArtifact(chat: Pick<ChatView, 'id' | 'rows'>): boolean {
  const id = newest(chat)
  return !!id && load()[chat.id] !== id
}

export function sawArtifacts(chat: Pick<ChatView, 'id' | 'rows'>): boolean {
  const id = newest(chat)
  if (!id || load()[chat.id] === id) return false
  load()[chat.id] = id
  globalThis.localStorage?.setItem(key, JSON.stringify(seen))
  return true
}
