import { describe, expect, it } from 'vitest'
import type { ChatState } from '../../src/shared/chat'
import { layoutFloor, settle, type DeptId } from '../../src/renderer/office/layout'
import { demandOf, spotFor, type Spot } from '../../src/renderer/office/standby'

const spot = (state: ChatState, extra: { parked?: boolean; dept?: DeptId; prev?: Spot; open?: boolean } = {}) => spotFor({ state, parked: extra.parked ?? false, dept: extra.dept ?? 'mkt' }, extra.prev, extra.open ?? false)

describe('where a chat rests', () => {
  it('keeps active and done-unread chats at their desk and sends read or idle chats to the Lounge', () => {
    expect(['starting', 'working', 'needs-you', 'stuck', 'done', 'idle'].map((state) => spot(state as ChatState))).toEqual(['desk', 'desk', 'desk', 'desk', 'desk', 'lounge'])
    expect(spot('done', { dept: 'gym' })).toBe('cooler')
    expect(spot('working', { dept: 'gym' })).toBe('desk')
    expect(spot('idle', { dept: 'gym' })).toBe('lounge')
  })

  it('lets parked chats doze in the Lounge, unless they are busy again', () => {
    expect(spot('idle', { parked: true })).toBe('lounge')
    expect(spot('done', { parked: true })).toBe('lounge')
    expect(spot('working', { parked: true })).toBe('desk')
  })

  it('never moves an agent while its chat is open, and walks it to the Lounge once Aaron leaves', () => {
    const read = spot('idle', { prev: 'desk', open: true })
    expect(read).toBe('desk')
    expect(spot('idle', { prev: read, open: true })).toBe('desk')
    expect(spot('idle', { prev: read, open: false })).toBe('lounge')
    expect(spot('idle', { dept: 'gym', prev: 'cooler', open: true })).toBe('cooler')
    expect(spot('idle', { prev: 'lounge', open: true })).toBe('lounge')
  })

  it('walks a standby chat back to a desk in its department when a message arrives, even while open', () => {
    const resting = spot('idle', { dept: 'plat' })
    expect(resting).toBe('lounge')
    const back = spot('working', { dept: 'plat', prev: resting, open: true })
    expect(back).toBe('desk')
    const before = demandOf([{ dept: 'plat', spot: resting }])
    const after = demandOf([{ dept: 'plat', spot: back }])
    expect(before).toMatchObject({ seated: {}, standby: 1 })
    expect(after).toMatchObject({ seated: { plat: 1 }, standby: 0 })
    expect(layoutFloor(settle({}, after.seated, false).desks).zones.plat).toMatchObject({ shown: true, desks: 1 })
  })

  it('counts only working, needs-you, stuck and done-unread chats toward section size, and gives the gym treadmills only for runners', () => {
    const agents: { dept: DeptId; state: ChatState }[] = [
      { dept: 'mkt', state: 'stuck' },
      { dept: 'mkt', state: 'idle' },
      { dept: 'mkt', state: 'idle' },
      { dept: 'plat', state: 'working' },
      { dept: 'plat', state: 'needs-you' },
      { dept: 'plat', state: 'done' },
      { dept: 'plat', state: 'idle' },
      { dept: 'gym', state: 'working' },
      { dept: 'gym', state: 'done' },
      { dept: 'gym', state: 'idle' },
      { dept: 'gym', state: 'idle' },
    ]
    const { seated, present, standby } = demandOf(agents.map((a) => ({ dept: a.dept, spot: spot(a.state, { dept: a.dept }) })))
    expect(seated).toEqual({ mkt: 1, plat: 3, gym: 1 })
    expect([...present]).toEqual(['gym'])
    expect(standby).toBe(5)
    expect(settle({}, seated, true, present).desks).toMatchObject({ mkt: 2, plat: 4, gym: 2, adm: 0 })
  })
})
