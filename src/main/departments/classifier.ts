import { isAbsolute, resolve } from 'node:path'
import type { ChatState } from '../../shared/chat'
import type { Engine } from '../sessions/manager'
import { normalize, type ChatEvent } from '../sessions/normalize'
import type { ChatStore } from '../store/chats'
import type { Rooms } from './rooms'

export const windowSize = 20
export const moveShare = 0.6
export const confirmations = 2

const weights: Record<string, number> = { Edit: 3, Write: 3, MultiEdit: 3, NotebookEdit: 3, Read: 1, Grep: 1, Glob: 1 }

export interface Evidence {
  dept: string
  weight: number
}

export interface Tally {
  recent: Evidence[]
  leader?: string
  streak: number
}

export const newTally = (): Tally => ({ recent: [], streak: 0 })

export function evidenceOf(events: readonly ChatEvent[], cwd: string, rooms: Pick<Rooms, 'evidenceRoom'>): Evidence[] {
  return events.flatMap((event) => {
    if (event.type !== 'tool-use') return []
    const input = (event.input ?? {}) as Record<string, unknown>
    const path = input.file_path ?? input.notebook_path ?? input.path
    const weight = weights[event.name]
    if (!weight || typeof path !== 'string' || !path) return []
    const dept = rooms.evidenceRoom(isAbsolute(path) ? path : resolve(cwd, path), cwd)
    return dept ? [{ dept, weight }] : []
  })
}

export function classify(tally: Tally, evidence: readonly Evidence[]): string | undefined {
  if (!evidence.length) return undefined
  tally.recent = [...tally.recent, ...evidence].slice(-windowSize)
  const totals = new Map<string, number>()
  for (const { dept, weight } of tally.recent) totals.set(dept, (totals.get(dept) ?? 0) + weight)
  const sum = [...totals.values()].reduce((a, b) => a + b, 0)
  const [top, weight] = [...totals].reduce((a, b) => (b[1] > a[1] ? b : a))
  if (weight < sum * moveShare) {
    tally.leader = undefined
    tally.streak = 0
    return undefined
  }
  tally.streak = tally.leader === top ? tally.streak + 1 : 1
  tally.leader = top
  return tally.streak >= confirmations ? top : undefined
}

const queued = new Set<ChatState>(['needs-you', 'stuck'])

export const placeable = (rooms: Pick<Rooms, 'isTied'>, chat: { department?: string; review?: boolean }) => !chat.review && !(chat.department && rooms.isTied(chat.department))

export function createPlacement(engine: Pick<Engine, 'events'>, store: Pick<ChatStore, 'events' | 'view' | 'setDepartment'>, rooms: Pick<Rooms, 'evidenceRoom' | 'isTied'>, isOpen: (chatId: string) => boolean = () => false) {
  const tallies = new Map<string, Tally>()
  const wanted = new Map<string, string>()

  function settle(chatId: string) {
    const dept = wanted.get(chatId)
    const view = store.view(chatId)
    if (!dept || !view || queued.has(view.state) || isOpen(chatId)) return
    wanted.delete(chatId)
    if (view.department !== dept) store.setDepartment(chatId, dept)
  }
  const release = () => [...wanted.keys()].forEach(settle)

  engine.events.on('message', (chatId, message) => {
    try {
      const view = store.view(chatId)
      if (!view || !placeable(rooms, view)) return
      const tally = tallies.get(chatId) ?? tallies.set(chatId, newTally()).get(chatId)!
      const dept = classify(tally, evidenceOf(normalize(message), view.cwd, rooms))
      if (!dept) return
      wanted.set(chatId, dept)
      settle(chatId)
    } catch (error) {
      console.warn('[departments] could not place a chat', error)
    }
  })
  store.events.on('patch', (patch) => {
    if (patch.fields && 'state' in patch.fields) settle(patch.id)
  })
  setInterval(release, 1000).unref()
  return { release }
}
