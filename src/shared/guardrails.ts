import type { Headroom, UsageWindow } from './ipc'

export const warnAt = 80

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
