export const deptIds = ['mkt', 'adm', 'mob', 'plat', 'side', 'gym'] as const
export type DeptId = (typeof deptIds)[number]
export const isDeptId = (value: unknown): value is DeptId => deptIds.includes(value as DeptId)

export const deptNames: Record<DeptId, string> = {
  mkt: 'Marketplace',
  adm: 'Admin',
  mob: 'Mobile',
  plat: 'Backend / infra',
  side: 'Side projects',
  gym: 'Research gym',
}

export const parkAfterMs = 24 * 60 * 60 * 1000

export const isResearch = (account: { label: string }) => /research/i.test(account.label)

export function departmentOf(chat: { cwd: string; department?: string }, research: boolean): DeptId {
  if (isDeptId(chat.department)) return chat.department
  if (research) return 'gym'
  const path = chat.cwd.replaceAll('\\', '/')
  if (!/\/monorepo(\/|$)/.test(path)) return 'side'
  if (/\/frontend\/marketplace(\/|$)/.test(path)) return 'mkt'
  if (/\/frontend\/admin(\/|$)/.test(path)) return 'adm'
  if (/\/frontend\/mobile(\/|$)/.test(path)) return 'mob'
  return 'plat'
}

export const palette = [
  0xf0463c, 0x3b7bff, 0x2fb344, 0xffc21a, 0x8b5cf6, 0xff7a59, 0x14b8a6, 0xf25ca2, 0x38bdf8, 0x84cc16, 0xfb923c,
  0x5b5bd6, 0xe879f9, 0x0e7490, 0x10b981, 0xfda4af, 0x9f1239, 0x6ee7b7, 0xc2410c, 0x1e40af, 0xa3a3ff, 0xfdba74,
] as const

export const hexOf = (colour: number) => `#${colour.toString(16).padStart(6, '0')}`

export function pickColour(taken: readonly { colour?: string; dept: DeptId }[], dept: DeptId): string | undefined {
  const used = new Set(taken.map((chat) => chat.colour))
  const nearby = new Set(taken.filter((chat) => chat.dept === dept).map((chat) => chat.colour))
  const colours = palette.map(hexOf)
  return colours.find((colour) => !used.has(colour)) ?? colours.find((colour) => !nearby.has(colour))
}
