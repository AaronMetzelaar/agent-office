import { describe, expect, it } from 'vitest'
import { tightest } from '../../src/shared/guardrails'

describe('headroom', () => {
  it('picks the most used window and treats a passed reset as empty', () => {
    const now = 1_000_000
    expect(tightest({ fiveHour: { utilization: 40, resetsAt: now + 1 }, sevenDay: { utilization: 70 } }, now)).toEqual({ window: 'sevenDay', utilization: 70 })
    expect(tightest({ fiveHour: { utilization: 95, resetsAt: now - 1, warn: true } }, now)).toEqual({ window: 'fiveHour', utilization: 0 })
    expect(tightest(undefined, now)).toBeUndefined()
  })
})
