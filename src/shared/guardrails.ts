import type { Headroom, UsageWindow } from './ipc'

export interface Limits {
  turns?: number
  costUsd?: number
}

export const warnAt = 80

const positive = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined)

export function limitsOf(value: unknown): Limits {
  const raw = (typeof value === 'object' && value ? value : {}) as Record<string, unknown>
  const turns = positive(raw.turns)
  const costUsd = positive(raw.costUsd)
  return { ...(turns ? { turns: Math.round(turns) } : {}), ...(costUsd ? { costUsd } : {}) }
}

export function limitHit(limits: Limits, turns: number, spentUsd: number): string | undefined {
  if (limits.turns && turns > limits.turns) return `Stopped at its ${limits.turns}-turn limit`
  if (limits.costUsd && spentUsd >= limits.costUsd) return `Stopped at its $${limits.costUsd.toFixed(2)} limit`
  return undefined
}

export type Tightest = UsageWindow & { window: keyof Headroom }

export function tightest(headroom: Headroom | undefined, now: number): Tightest | undefined {
  const windows = (['fiveHour', 'sevenDay'] as const).flatMap((window) => {
    const usage = headroom?.[window]
    if (!usage) return []
    return usage.resetsAt !== undefined && usage.resetsAt <= now ? [{ window, utilization: 0 }] : [{ ...usage, window }]
  })
  return windows.sort((a, b) => b.utilization - a.utilization)[0]
}

export const isWarning = (usage: UsageWindow | undefined) => !!usage && (usage.warn === true || usage.utilization >= warnAt)
