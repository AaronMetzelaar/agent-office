import type { ChatFields } from '../../shared/chat'
import { cleanupChoices, day, defaultThresholds, parkChoices, type Thresholds } from '../../shared/housekeeping'

type Quiet = Pick<ChatFields, 'id' | 'state' | 'archived' | 'parked' | 'lastActivityAt'>

export interface CleanupNotice {
  at: number
  ids: string[]
}

const settles = new Set<ChatFields['state']>(['idle', 'done'])
const quietFor = (chat: Quiet, now: number) => (!chat.archived && settles.has(chat.state) ? now - chat.lastActivityAt : -1)

export const shouldPark = (chat: Quiet, thresholds: Thresholds, now: number) => !chat.parked && quietFor(chat, now) >= thresholds.parkAfterMs

export const cleanupCandidates = (chats: readonly Quiet[], thresholds: Thresholds, now: number) => chats.filter((chat) => quietFor(chat, now) >= thresholds.cleanupAfterMs).map((chat) => chat.id)

export function toThresholds(value: unknown): Thresholds | undefined {
  const { parkAfterMs, cleanupAfterMs } = (value ?? {}) as Partial<Thresholds>
  const allowed = (choices: [number, string][], ms: unknown) => choices.some(([choice]) => choice === ms)
  if (!allowed(parkChoices, parkAfterMs) || !allowed(cleanupChoices, cleanupAfterMs) || cleanupAfterMs! < parkAfterMs!) return undefined
  return { parkAfterMs: parkAfterMs!, cleanupAfterMs: cleanupAfterMs! }
}

export const readThresholds = (saved: unknown): Thresholds => toThresholds(saved) ?? defaultThresholds

export function cleanupNotice(candidates: readonly string[], last: CleanupNotice | undefined, now: number): CleanupNotice | undefined {
  const fresh = candidates.some((id) => !last?.ids.includes(id))
  if (!fresh || (last && now - last.at < day)) return undefined
  return { at: now, ids: [...candidates] }
}

export function parkStale(chats: readonly Quiet[], thresholds: Thresholds, now: number, park: (chatId: string) => void): string[] {
  const parked = chats.filter((chat) => shouldPark(chat, thresholds, now)).map((chat) => chat.id)
  parked.forEach(park)
  return parked
}
