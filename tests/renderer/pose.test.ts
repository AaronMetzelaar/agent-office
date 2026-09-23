import { describe, expect, it } from 'vitest'
import type { ChatState } from '../../src/shared/chat'
import { placementFor, type PlacementInput } from '../../src/renderer/office/pose'

const at = (state: ChatState, extra: Partial<PlacementInput> = {}) => {
  const p = placementFor({ state, kind: 'desk', parked: false, queueIndex: -1, spots: 5, bench: true, ...extra })
  return [p.anchor, p.pose]
}

describe('state to pose', () => {
  it('maps the desk column of the R5 table', () => {
    expect(at('working')).toEqual(['seat', 'type'])
    expect(at('starting')).toEqual(['seat', 'type'])
    expect(at('done')).toEqual(['seat', 'lean'])
    expect(at('idle')).toEqual(['seat', 'slump'])
  })

  it('maps the gym column of the R5 table', () => {
    const gym = { kind: 'gym' as const }
    expect(at('working', gym)).toEqual(['seat', 'run'])
    expect(at('done', gym)).toEqual(['relax', 'relax'])
    expect(at('idle', gym)).toEqual(['bench', 'sit'])
  })

  it('sends needs-you and stuck to the door queue, waving only at the front', () => {
    expect(at('needs-you', { queueIndex: 0 })).toEqual(['queue', 'wave'])
    expect(at('needs-you', { queueIndex: 2 })).toEqual(['queue', 'wait'])
    expect(at('stuck', { queueIndex: 0 })).toEqual(['queue', 'wait'])
    expect(at('needs-you', { queueIndex: 1, kind: 'gym' })).toEqual(['queue', 'wait'])
  })

  it('keeps an overflowing queue waiting by the desk', () => {
    expect(at('needs-you', { queueIndex: 6 })).toEqual(['stand', 'wave'])
    expect(at('stuck', { queueIndex: 5 })).toEqual(['stand', 'wait'])
  })

  it('sends parked chats to the lounge asleep', () => {
    expect(at('idle', { parked: true })).toEqual(['lounge', 'sleep'])
    expect(at('done', { parked: true, kind: 'gym' })).toEqual(['lounge', 'sleep'])
  })
})
