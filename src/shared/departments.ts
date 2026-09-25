export const deptIds = ['mkt', 'adm', 'mob', 'plat', 'side', 'rev', 'gym'] as const
export type DeptId = (typeof deptIds)[number]
export const isDeptId = (value: unknown): value is DeptId => deptIds.includes(value as DeptId)

export const deptNames: Record<DeptId, string> = {
  mkt: 'Marketplace',
  adm: 'Admin',
  mob: 'Mobile',
  plat: 'Backend / infra',
  side: 'Side projects',
  rev: 'PR reviews',
  gym: 'Research gym',
}

export const isResearch = (account: { label: string }) => /research/i.test(account.label)

export interface DeptRule {
  path: string
  dept: DeptId
}

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
  root?: string
  parent?: string
  createdAt?: number
}

export const mwsRooms: readonly RoomDef[] = [
  { id: 'mkt', name: 'Marketplace', subtitle: 'monorepo/frontend/marketplace', accent: 0x1b34ff, look: 'showroom' },
  { id: 'adm', name: 'Admin', subtitle: 'monorepo/frontend/admin', accent: 0xdb2777, look: 'backoffice' },
  { id: 'mob', name: 'Mobile', subtitle: 'monorepo/frontend/mobile', accent: 0x16a34a, look: 'devices' },
  { id: 'plat', name: 'Backend / infra', subtitle: 'services · api · workers · infra', accent: 0x7c3aed, look: 'servers' },
]
export const reviewRoom: RoomDef = { id: 'rev', name: 'PR reviews', subtitle: 'your review requests', accent: 0x854d0e, look: 'reading' }
export const playgroundRoom: RoomDef = { id: 'side', name: 'Side projects', subtitle: 'folders without a room', accent: 0xea580c, look: 'playground' }

export interface StartOptions {
  dept?: DeptId
  worktree?: boolean
  title?: string
  review?: boolean
}

export const defaultRules: readonly DeptRule[] = [
  { path: 'monorepo/frontend/marketplace', dept: 'mkt' },
  { path: 'monorepo/frontend/admin', dept: 'adm' },
  { path: 'monorepo/frontend/mobile', dept: 'mob' },
  { path: 'monorepo', dept: 'plat' },
]

export function validRules(value: unknown): DeptRule[] | undefined {
  if (!Array.isArray(value)) return undefined
  const rules = value.filter((rule): rule is DeptRule => typeof rule?.path === 'string' && !!rule.path.replace(/\//g, '') && isDeptId(rule.dept))
  return rules.length ? rules.map(({ path, dept }) => ({ path, dept })) : undefined
}

export const repoPath = (path: string) => path.replaceAll('\\', '/').replace(/\/\.claude\/worktrees\/[^/]+/, '').replace(/\/+$/, '')

const segments = (path: string) => `/${path.replace(/^\/+|\/+$/g, '')}/`

export function ruleFor(path: string, rules: readonly DeptRule[] = defaultRules): DeptId | undefined {
  const target = `${repoPath(path)}/`
  return [...rules].sort((a, b) => b.path.length - a.path.length).find((rule) => target.includes(segments(rule.path)))?.dept
}

export function homeDept(cwd: string, research: boolean, rules: readonly DeptRule[] = defaultRules): DeptId {
  return research ? 'gym' : (ruleFor(cwd, rules) ?? 'side')
}

export function departmentOf(chat: { cwd: string; department?: string }, research: boolean, rules: readonly DeptRule[] = defaultRules): DeptId {
  return isDeptId(chat.department) ? chat.department : homeDept(chat.cwd, research, rules)
}

export function evidenceDept(file: string, cwd: string, rules: readonly DeptRule[] = defaultRules): DeptId | undefined {
  const matched = ruleFor(file, rules)
  if (matched) return matched
  const [path, root] = [repoPath(file), repoPath(cwd)]
  return path === root || path.startsWith(`${root}/`) ? 'side' : undefined
}

export const showsAccountBadge = (dept: DeptId, research: boolean) => research !== (dept === 'gym')

interface AccountLike {
  id: string
  label: string
  health: { status: string; headroom?: { fiveHour?: { utilization: number }; sevenDay?: { utilization: number } } }
}

export const lowHeadroom = 80
const monorepo = new Set<DeptId>(['mkt', 'adm', 'mob', 'plat'])
const usable = (account: AccountLike) => account.health.status !== 'needs-login'
export const usedPercent = (account: AccountLike) => Math.max(account.health.headroom?.fiveHour?.utilization ?? 0, account.health.headroom?.sevenDay?.utilization ?? 0)

export function defaultAccount(accounts: readonly AccountLike[], dept?: DeptId): string | undefined {
  const open = accounts.filter(usable)
  return (open.find((account) => isResearch(account) === (dept === 'gym')) ?? open[0])?.id
}

export function defaultAccountFor(accounts: readonly AccountLike[], tiedRoom: (label: string) => string | undefined, room?: string): string | undefined {
  const open = accounts.filter(usable)
  return (open.find((account) => tiedRoom(account.label) === room) ?? open.find((account) => !tiedRoom(account.label)) ?? open[0])?.id
}

export function accountHint(accounts: readonly AccountLike[], chosenId: string, dept: DeptId): { accountId: string; text: string } | undefined {
  const chosen = accounts.find((account) => account.id === chosenId)
  const research = accounts.find((account) => isResearch(account) && usable(account))
  if (!chosen || !research || isResearch(chosen) || !monorepo.has(dept)) return undefined
  const used = usedPercent(chosen)
  if (used < lowHeadroom || usedPercent(research) >= used) return undefined
  return { accountId: research.id, text: `${chosen.label} is at ${Math.round(used)}% of its limit. Run this on ${research.label}; it keeps its department.` }
}
