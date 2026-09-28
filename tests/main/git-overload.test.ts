import { describe, expect, it, vi } from 'vitest'
import { eachLimited } from '../../src/main/housekeeping'
import { gitError } from '../../src/main/worktrees/create'

vi.mock('electron', () => import('../fakes/electron'))

describe('git under load', () => {
  it('checks worktrees a few at a time, not all at once', async () => {
    let running = 0
    let peak = 0
    const done: number[] = []
    await eachLimited([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, async (item) => {
      peak = Math.max(peak, ++running)
      await new Promise((settle) => setTimeout(settle, 5))
      running--
      done.push(item)
    })
    expect(peak).toBe(4)
    expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('says git timed out instead of echoing its progress output', () => {
    const killed = Object.assign(new Error('Command failed'), { killed: true, stderr: 'Updating files:  40% (6273/15681)' })
    expect(gitError(killed)).toMatch(/took too long/)
  })
})
