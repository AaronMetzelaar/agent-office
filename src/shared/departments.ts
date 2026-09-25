
export const roomIds = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] as const
export const deptIds = ['mkt', 'adm', 'mob', 'plat', 'side', 'rev', ...roomIds, 'gym'] as const
export type DeptId = (typeof deptIds)[number]
export type RoomId = (typeof roomIds)[number]
export const isDeptId = (value: unknown): value is DeptId => deptIds.includes(value as DeptId)

export interface Room {
  id: RoomId
  name: string
  about: string
  folder?: string
}

export const deptNames: Record<DeptId, string> = {
  mkt: 'Marketplace',
  adm: 'Admin',
  mob: 'Mobile',
  plat: 'Backend / infra',
  side: 'Side projects',
  rev: 'PR reviews',
  gym: 'Research gym',
  ...(Object.fromEntries(roomIds.map((id) => [id, 'New room'])) as Record<RoomId, string>),
}

export function applyRooms(rooms: readonly Room[]) {
  for (const room of rooms) deptNames[room.id] = room.name
}

export const roomRules = (rooms: readonly Room[]): DeptRule[] => rooms.flatMap((room) => (room.folder ? [{ path: room.folder, dept: room.id }] : []))

export const isResearch = (account: { label: string }) => /research/i.test(account.label)

export interface DeptRule {
  path: string
  dept: DeptId
}

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
  const pick = (list: AccountLike[]) => list.find((account) => isResearch(account) === (dept === 'gym')) ?? list[0]
  return (pick(open.filter((account) => usedPercent(account) < 100)) ?? pick(open))?.id
}

export function accountHint(accounts: readonly AccountLike[], chosenId: string, dept: DeptId): { accountId: string; text: string } | undefined {
  const chosen = accounts.find((account) => account.id === chosenId)
  const research = accounts.find((account) => isResearch(account) && usable(account))
  if (!chosen || !research || isResearch(chosen) || !monorepo.has(dept)) return undefined
  const used = usedPercent(chosen)
  if (used < lowHeadroom || usedPercent(research) >= used) return undefined
  return { accountId: research.id, text: `${chosen.label} is at ${Math.round(used)}% of its limit. Run this on ${research.label}; it keeps its department.` }
}
