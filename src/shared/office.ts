import type { DeptId } from './departments'

export { departmentOf, deptIds, deptNames, isDeptId, isResearch, type DeptId } from './departments'

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
