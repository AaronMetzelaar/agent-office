import type { Decision, PendingRequestView } from '../../shared/permissions'

export interface KeyContext {
  open?: string
  queue: readonly { chatId?: string; requests: readonly unknown[] }[]
  card?: Pick<PendingRequestView, 'id' | 'tool' | 'dangerous' | 'alwaysAllow'>
}

export type KeyAction = { kind: 'open'; chatId: string } | { kind: 'decide'; requestId: string; decision: Decision }

const decisions: Record<string, Decision> = { '1': { kind: 'allow' }, '2': { kind: 'always' }, '3': { kind: 'deny' } }
const steps: Record<string, number> = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 }

export function keyAction(key: string, { open, queue, card }: KeyContext): KeyAction | undefined {
  const decision = decisions[key]
  if (decision) {
    if (!open) {
      const first = queue.find((item) => item.chatId && item.requests.length > 0)?.chatId
      return first ? { kind: 'open', chatId: first } : undefined
    }
    if (!card || card.dangerous) return undefined
    if (decision.kind === 'always' && !card.alwaysAllow) return undefined
    if (card.tool === 'AskUserQuestion') return undefined
    return { kind: 'decide', requestId: card.id, decision }
  }
  const step = steps[key]
  const chats = queue.flatMap((item) => (item.chatId ? [item.chatId] : []))
  if (!step || !chats.length) return undefined
  const at = open ? chats.indexOf(open) : -1
  const next = at < 0 ? (step > 0 ? 0 : chats.length - 1) : Math.min(chats.length - 1, Math.max(0, at + step))
  return next === at ? undefined : { kind: 'open', chatId: chats[next]! }
}

export function cycleAgent(ids: readonly string[], open: string | undefined, back: boolean, waiting: readonly string[] = []): string | undefined {
  if (waiting.some((id) => id !== open)) return cycleAgent(waiting, open, back)
  if (!ids.length) return undefined
  const at = open ? ids.indexOf(open) : -1
  if (at < 0) return back ? ids.at(-1) : ids[0]
  return ids[(at + (back ? -1 : 1) + ids.length) % ids.length]
}
