import type { Design } from './looks'

export type DeptId = string

export const looks = ['showroom', 'backoffice', 'devices', 'servers', 'reading', 'gym', 'playground', 'plain'] as const
export type Look = (typeof looks)[number]

export interface ConfigRoom {
  id: string
  name: string
  folders?: string[]
  account?: string
  accent?: string
  look?: Look
}

export interface ConfigCommands {
  ship?: string[]
  fixCi?: string
  answerComments?: string
  review?: string
}

export interface DeptConfig {
  rooms: ConfigRoom[]
  playground: string[]
  commands: ConfigCommands
}

export interface RoomDef {
  id: string
  name: string
  subtitle: string
  accent: number
  look: Look
  account?: string
  about?: string
  root?: string
  parent?: string
  createdAt?: number
  design?: Design
}

export const mwsRooms: readonly RoomDef[] = [
  { id: 'mkt', name: 'Marketplace', subtitle: 'monorepo/frontend/marketplace', accent: 0x1b34ff, look: 'showroom' },
  { id: 'adm', name: 'Admin', subtitle: 'monorepo/frontend/admin', accent: 0xdb2777, look: 'backoffice' },
  { id: 'mob', name: 'Mobile', subtitle: 'monorepo/frontend/mobile', accent: 0x16a34a, look: 'devices' },
  { id: 'plat', name: 'Backend / infra', subtitle: 'services · api · workers · infra', accent: 0x7c3aed, look: 'servers' },
]
export const reviewRoom: RoomDef = { id: 'rev', name: 'PR reviews', subtitle: 'your review requests', accent: 0x854d0e, look: 'reading' }
export const playgroundRoom: RoomDef = { id: 'side', name: 'Side projects', subtitle: 'folders without a room', accent: 0xea580c, look: 'playground' }
export const legacyRooms: readonly RoomDef[] = [...mwsRooms, playgroundRoom, reviewRoom, { id: 'gym', name: 'Research gym', subtitle: 'research account', accent: 0x0d9488, look: 'gym', account: 'research' }]

const holds = (label: string, account: string) => label.toLowerCase().includes(account.toLowerCase())

export const tiedRoomIn = (rooms: readonly Pick<RoomDef, 'id' | 'account'>[], label = '') =>
  rooms.filter((room) => room.account && holds(label, room.account)).sort((a, b) => b.account!.length - a.account!.length)[0]?.id

export function showsAccountBadge(rooms: readonly Pick<RoomDef, 'id' | 'account'>[], roomId: string, label = ''): boolean {
  const account = rooms.find((room) => room.id === roomId)?.account
  return account ? !holds(label, account) : !!tiedRoomIn(rooms, label)
}

export interface StartOptions {
  dept?: DeptId
  worktree?: boolean
  title?: string
  review?: boolean
}

export const repoPath = (path: string) => path.replaceAll('\\', '/').replace(/\/\.claude\/worktrees\/[^/]+/, '').replace(/\/+$/, '')

interface AccountLike {
  id: string
  label: string
  health: { status: string; headroom?: { fiveHour?: { utilization: number }; sevenDay?: { utilization: number } } }
}

export const lowHeadroom = 80
const usable = (account: AccountLike) => account.health.status !== 'needs-login'
export const usedPercent = (account: AccountLike) => Math.max(account.health.headroom?.fiveHour?.utilization ?? 0, account.health.headroom?.sevenDay?.utilization ?? 0)

export function defaultAccountFor(accounts: readonly AccountLike[], tiedRoom: (label: string) => string | undefined, room?: string): string | undefined {
  const open = accounts.filter(usable)
  const pick = (list: AccountLike[]) => list.find((account) => tiedRoom(account.label) === room) ?? list.find((account) => !tiedRoom(account.label)) ?? list[0]
  return (pick(open.filter((account) => usedPercent(account) < 100)) ?? pick(open))?.id
}

export function accountHint(accounts: readonly AccountLike[], chosenId: string): { accountId: string; text: string } | undefined {
  const chosen = accounts.find((account) => account.id === chosenId)
  if (!chosen || usedPercent(chosen) < lowHeadroom) return undefined
  const other = accounts.filter((account) => account.id !== chosenId && usable(account)).sort((a, b) => usedPercent(a) - usedPercent(b))[0]
  if (!other || usedPercent(other) >= usedPercent(chosen)) return undefined
  return { accountId: other.id, text: `${chosen.label} is at ${Math.round(usedPercent(chosen))}% of its limit. Run this on ${other.label}; it keeps its room.` }
}
