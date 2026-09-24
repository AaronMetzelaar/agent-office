import { describe, expect, it } from 'vitest'
import { createGuard } from '../../src/renderer/office/guard'

describe('the frame loop guard', () => {
  it('turns off a throwing animation after logging it once, and keeps running the rest', () => {
    const logs: string[] = []
    const guard = createGuard((message) => logs.push(message))
    let clock = 0
    let frames = 0
    const hands: { rotation: { z: number } }[] = []
    for (let frame = 0; frame < 10; frame++) {
      guard.run('wall clock', undefined, () => {
        hands[0]!.rotation.z = frame
      })
      clock = guard.run('agents', clock, () => clock + 1)
      frames++
    }
    expect(frames).toBe(10)
    expect(clock).toBe(10)
    expect(guard.off('wall clock')).toBe(true)
    expect(guard.off('agents')).toBe(false)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/wall clock stopped after an error/)
  })

  it('hands back the fallback value for a piece that failed', () => {
    const guard = createGuard(() => {})
    expect(
      guard.run('moved', false, () => {
        throw new Error('boom')
      }),
    ).toBe(false)
    expect(guard.run('moved', false, () => true)).toBe(false)
  })
})
