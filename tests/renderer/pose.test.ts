import { describe, expect, it } from 'vitest'
import type { ChatState } from '../../src/shared/chat'
import { placementFor, type PlacementInput } from '../../src/renderer/office/pose'
import { spotFor } from '../../src/renderer/office/standby'

const at = (state: ChatState, extra: Partial<PlacementInput> = {}) => {
  const kind = extra.kind ?? 'desk'
  const parked = extra.parked ?? false
  const spot = extra.spot ?? spotFor({ state, parked, dept: kind === 'gym' ? 'gym' : 'mkt' }, undefined, false)
  const p = placementFor({ state, kind, spot, parked, queueIndex: -1, spots: 5, ...extra })
  return [p.anchor, p.pose]
}

describe('state to pose', () => {
  it('maps the desk column of the R5 table', () => {
    expect(at('working')).toEqual(['seat', 'type'])
    expect(at('starting')).toEqual(['seat', 'type'])
    expect(at('done')).toEqual(['seat', 'lean'])
    expect(at('idle')).toEqual(['lounge', 'lounge'])
    expect(at('idle', { smoking: true })).toEqual(['smoke', 'smoke'])
  })

  it('maps the gym column of the R5 table', () => {
    const gym = { kind: 'gym' as const }
    expect(at('working', gym)).toEqual(['seat', 'run'])
    expect(at('done', gym)).toEqual(['cooler', 'relax'])
    expect(at('idle', gym)).toEqual(['lounge', 'lounge'])
  })

  it('keeps a read chat that is still open where it was, in a calm pose', () => {
    expect(at('idle', { spot: 'desk' })).toEqual(['seat', 'sit'])
    expect(at('idle', { kind: 'gym', spot: 'desk' })).toEqual(['seat', 'wait'])
    expect(at('idle', { kind: 'gym', spot: 'cooler' })).toEqual(['cooler', 'relax'])
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

  it('lets parked chats doze in the lounge, even a done one', () => {
    expect(at('idle', { parked: true })).toEqual(['lounge', 'sleep'])
    expect(at('done', { parked: true, kind: 'gym' })).toEqual(['lounge', 'sleep'])
    expect(at('done', { parked: true })).toEqual(['lounge', 'sleep'])
  })
})
