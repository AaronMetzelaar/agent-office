import { Color } from 'three'
import { applyPatch, doingNow, type ChatFields, type ChatPatch, type ChatPatchBatch, type ChatSnapshot, type ChatState, type ChatView, type LoginItem, type StuckReason } from '../../shared/chat'
import type { AccountView } from '../../shared/ipc'
import { isDeptId, type DeptId } from '../office/layout'

export interface ChatSource {
  getSnapshot(): Promise<ChatSnapshot>
  onChatPatches(listener: (batch: ChatPatchBatch) => void): () => void
  onWindowVisibility?(listener: (payload: { visible: boolean }) => void): () => void
}

export type Projection = ReturnType<typeof createProjection>

const isNewChat = (patch: ChatPatch): patch is ChatPatch & { fields: ChatFields } => !!patch.fields && 'accountId' in patch.fields && 'state' in patch.fields && 'createdAt' in patch.fields

export function createProjection(source: ChatSource) {
  const chats = new Map<string, ChatView>()
  const listeners = new Set<() => void>()
  let seq = -1
  let buffer: ChatPatchBatch[] | undefined = []
  let loading: Promise<void> | undefined

  const state = { logins: [] as LoginItem[] }
  const emit = () => listeners.forEach((listener) => listener())

  function applyBatch(batch: ChatPatchBatch) {
    if (batch.seq <= seq) return
    seq = batch.seq
    if (batch.logins) state.logins = batch.logins
    for (const patch of batch.patches) {
      const current = chats.get(patch.id)
      if (current) chats.set(patch.id, applyPatch(current, patch))
      else if (isNewChat(patch)) chats.set(patch.id, { ...patch.fields, rows: patch.rows ?? [] })
    }
  }

  function load() {
    buffer ??= []
    loading ??= source
      .getSnapshot()
      .then((snapshot) => {
        chats.clear()
        for (const chat of snapshot.chats) chats.set(chat.id, chat)
        state.logins = snapshot.logins
        seq = snapshot.seq
        const queued = buffer ?? []
        buffer = undefined
        queued.forEach(applyBatch)
        emit()
      })
      .finally(() => (loading = undefined))
    return loading
  }

  const offPatches = source.onChatPatches((batch) => {
    if (buffer) return void buffer.push(batch)
    applyBatch(batch)
    emit()
  })
  const offVisibility = source.onWindowVisibility?.(({ visible }) => {
    if (visible) void load()
  })

  return {
    chats,
    get logins() {
      return state.logins
    },
    ready: load(),
    resync: load,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    stop() {
      offPatches()
      offVisibility?.()
      listeners.clear()
    },
  }
}

export const parkAfterMs = 24 * 60 * 60 * 1000

export interface Agent {
  id: string
  title: string
  accountId: string
  dept: DeptId
  project: string
  state: ChatState
  stuckReason?: StuckReason
  caption: string
  parked: boolean
  subagents: string[]
  since: number
  quietMs: number
  createdAt: number
  colour: number
  request?: { tool: string; summary: string; dangerous: boolean }
}

export function isResearch(account: Pick<AccountView, 'label'>): boolean {
  return /research/i.test(account.label)
}

export function departmentOf(chat: Pick<ChatFields, 'cwd' | 'accountId' | 'department'>, researchAccounts: ReadonlySet<string>): DeptId {
  if (isDeptId(chat.department)) return chat.department
  if (researchAccounts.has(chat.accountId)) return 'gym'
  const path = chat.cwd.replaceAll('\\', '/')
  if (!/\/monorepo(\/|$)/.test(path)) return 'side'
  if (/\/frontend\/marketplace(\/|$)/.test(path)) return 'mkt'
  if (/\/frontend\/admin(\/|$)/.test(path)) return 'adm'
  if (/\/frontend\/mobile(\/|$)/.test(path)) return 'mob'
  return 'plat'
}

export function projectOf(cwd: string): string {
  const path = cwd.replaceAll('\\', '/').replace(/\/+$/, '')
  const repo = /^(.*?)\/\.claude\/worktrees\/[^/]+/.exec(path)?.[1] ?? path
  return repo.split('/').pop() || repo
}

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

export function captionOf(chat: ChatView, parked: boolean, now: number): string {
  if (chat.state === 'needs-you') return `Waiting for you · ${chat.pendingRequests[0]?.tool ?? chat.pending[0]?.toolName ?? 'a decision'}`
  if (parked) return `Parked · ${ago(now - chat.lastActivityAt)}`
  return doingNow(chat, now)
}

export const palette = [
  0xf0463c, 0x3b7bff, 0x2fb344, 0xffc21a, 0x8b5cf6, 0xff7a59, 0x14b8a6, 0xf25ca2, 0x38bdf8, 0x84cc16, 0xfb923c,
  0x5b5bd6, 0xe879f9, 0x0e7490, 0x10b981, 0xfda4af, 0x9f1239, 0x6ee7b7, 0xc2410c, 0x1e40af, 0xa3a3ff, 0xfdba74,
] as const

function hueFallback(id: string, avoid: readonly number[]): number {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const hsl = { h: 0, s: 0, l: 0 }
  const taken = avoid.map((colour) => new Color(colour).getHSL(hsl).h)
  const gapTo = (h: number) => Math.min(1, ...taken.map((t) => Math.min(Math.abs(t - h), 1 - Math.abs(t - h))))
  const candidates = Array.from({ length: 24 }, (_, k) => ((hash % 360) / 360 + k * 0.382) % 1)
  const hue = candidates.find((h) => gapTo(h) >= 0.05) ?? candidates.reduce((a, b) => (gapTo(b) > gapTo(a) ? b : a))
  return new Color().setHSL(hue, 0.7, 0.58).getHex()
}

export function assignColours(agents: readonly { id: string; dept: DeptId; createdAt: number; fixed?: number }[], prev: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  const inDept = new Map<DeptId, number[]>()
  const used = new Set<number>()
  const ordered = [...agents].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
  const take = (agent: { id: string; dept: DeptId }, colour: number) => {
    out.set(agent.id, colour)
    used.add(colour)
    inDept.set(agent.dept, [...(inDept.get(agent.dept) ?? []), colour])
  }
  const clashes = (dept: DeptId, colour: number) => inDept.get(dept)?.includes(colour) ?? false
  const later: typeof ordered = []
  for (const agent of ordered) {
    const kept = agent.fixed ?? prev.get(agent.id)
    if (kept !== undefined && !clashes(agent.dept, kept)) take(agent, kept)
    else later.push(agent)
  }
  for (const agent of later) {
    const fresh = palette.find((colour) => !used.has(colour)) ?? palette.find((colour) => !clashes(agent.dept, colour))
    take(agent, fresh ?? hueFallback(agent.id, inDept.get(agent.dept) ?? []))
  }
  return out
}

const hexColour = (value: string | undefined) => (value && /^#[0-9a-f]{6}$/i.test(value) ? Number.parseInt(value.slice(1), 16) : undefined)

export function toAgents(chats: Iterable<ChatView>, accounts: readonly AccountView[], now: number, prevColours: ReadonlyMap<string, number>): Agent[] {
  const research = new Set(accounts.filter(isResearch).map((account) => account.id))
  const live = [...chats].filter((chat) => !chat.archived)
  const placed = live.map((chat) => ({ chat, dept: departmentOf(chat, research) }))
  const colours = assignColours(
    placed.map(({ chat, dept }) => ({ id: chat.id, dept, createdAt: chat.createdAt, fixed: hexColour(chat.colour) })),
    prevColours,
  )
  return placed.map(({ chat, dept }) => {
    const quietMs = now - chat.lastActivityAt
    const parked = (chat.state === 'idle' || chat.state === 'done') && quietMs >= parkAfterMs
    const first = chat.pendingRequests[0]
    const tool = first?.tool ?? chat.pending[0]?.toolName
    return {
      id: chat.id,
      title: chat.title,
      accountId: chat.accountId,
      dept,
      project: projectOf(chat.cwd),
      state: chat.state,
      stuckReason: chat.stuck?.reason,
      caption: captionOf(chat, parked, now),
      parked,
      subagents: chat.subagents.map((agent) => agent.description),
      since: chat.state === 'needs-you' ? (chat.oldestPendingAt ?? first?.createdAt ?? chat.stateSince) : chat.stateSince,
      quietMs,
      createdAt: chat.createdAt,
      colour: colours.get(chat.id)!,
      ...(chat.state === 'needs-you' && tool ? { request: { tool, summary: first?.summary ?? tool, dangerous: first?.dangerous ?? false } } : {}),
    }
  })
}
