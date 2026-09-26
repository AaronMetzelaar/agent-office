import { describe, expect, it } from 'vitest'
import { arrange, checkDesign, footprint, limits, placed, roomSize, tidy, type Design, type Prop } from '../../src/shared/looks'

const shelf: Prop = {
  name: 'bookshelf',
  zone: 'back',
  tiers: [1, 2, 3],
  signature: true,
  parts: [
    { shape: 'rounded', size: [0.9, 1.8, 0.35], at: [0, 0.9, 0], color: '#cda274' },
    { shape: 'box', size: [0.2, 0.28, 0.25], at: [-0.2, 1.1, 0.02], color: '#3b7bff' },
  ],
}
const plant: Prop = { name: 'plant', zone: 'back', tiers: [1, 2, 3], parts: [{ shape: 'cylinder', size: [0.4, 0.4, 0.4], at: [0, 0.2, 0], color: '#efece6', taper: 0.8 }, { shape: 'sphere', size: [0.6, 0.7, 0.6], at: [0, 0.8, 0], color: '#3f9a55' }] }
const cooler: Prop = { name: 'cooler', zone: 'side', tiers: [1, 2, 3], parts: [{ shape: 'rounded', size: [0.4, 1.1, 0.4], at: [0, 0.55, 0], color: '#e6e4df', finish: 'satin' }] }
const board: Prop = { name: 'board', zone: 'back', tiers: [1, 2, 3], parts: [{ shape: 'panel', size: [1.2, 0.7, 0.03], at: [0, 1.5, 0], color: '#f6f3ea', text: 'Launch board', textColor: '#2a2e36' }] }
const gantry: Prop = { name: 'gantry', zone: 'back', tiers: [1, 2, 3], parts: [{ shape: 'box', size: [4, 3.4, 2.2], at: [0, 1.7, 0], color: '#c9d0d8' }] }
const room = (...props: Prop[]): Design => ({ theme: 'a tidy study', props })

describe('placing a generated look', () => {
  it('passes a room that keeps to the budgets and palette', () => {
    expect(checkDesign(room(shelf, plant, cooler, board))).toEqual([])
  })

  it('centres the signature piece, spreads the rest along the back wall, hangs wall pieces above them, and keeps clear of desks at every tier', () => {
    const design = room(shelf, plant, board, gantry, cooler)
    expect(checkDesign(design)).toEqual([])
    const w = roomSize(1).w, props = arrange(design, 1)
    for (const prop of props) expect(placed(prop, w)[3]).toBeLessThanOrEqual(limits.backDepth)
    const floor = props.filter((p) => p.name !== 'board').map((p) => ({ name: p.name, box: placed(p, w) })).sort((a, b) => a.box[0] - b.box[0])
    floor.slice(1).forEach(({ box }, i) => expect(box[0]).toBeGreaterThanOrEqual(floor[i]!.box[2]))
    expect(floor.map((f) => f.name)).toEqual(['gantry', 'bookshelf', 'plant'])
  })

  it('enlarges a timid signature piece toward a showpiece', () => {
    const [grown] = arrange(room(shelf), 1)
    const [x0, , x1] = footprint(grown!)
    expect(x1 - x0).toBeGreaterThan(1.3)
  })

  it('shrinks a prop too big for its zone instead of failing it', () => {
    const [box] = arrange(room({ ...gantry, signature: true }), 1).map((p) => footprint(p))
    expect(box![3] - box![1]).toBeLessThanOrEqual(limits.backDepth - 0.15 + 1e-9)
    expect(Math.max(...arrange(room({ ...gantry, signature: true }), 1)[0]!.parts.map((p) => p.at[1] + p.size[1] / 2))).toBeLessThanOrEqual(limits.height + 1e-9)
  })

  it('shows side props from tier 2, and leaves out props past the tier budget', () => {
    expect(arrange(room(shelf, cooler), 1).map((p) => p.name)).toEqual(['bookshelf'])
    expect(arrange(room(shelf, cooler), 2).map((p) => p.name).sort()).toEqual(['bookshelf', 'cooler'])
    const many = room(shelf, ...Array.from({ length: 9 }, (_, i) => ({ ...plant, name: `plant ${i}`, parts: plant.parts.map((p) => ({ ...p, size: [0.2, p.size[1], 0.2] as [number, number, number] })) })))
    expect(arrange(many, 1)).toHaveLength(limits.perTier[1]!)
  })

  it('needs exactly one signature piece, in the back zone from tier 1', () => {
    expect(checkDesign(room({ ...shelf, signature: false }, plant))).toContain('The room needs exactly one signature prop; it has 0')
    expect(checkDesign(room(shelf, { ...plant, signature: true }))).toContain('The room needs exactly one signature prop; it has 2')
    expect(checkDesign(room({ ...shelf, tiers: [2, 3] }))).toContain('The signature prop "bookshelf" must stand in the back zone from tier 1')
  })

  it('fails neon colours, long labels and links', () => {
    const neon = { ...plant, parts: [{ ...plant.parts[0]!, color: '#00ff00' }] }
    expect(checkDesign(room(shelf, neon)).some((f) => f.includes('#00ff00'))).toBe(true)
    expect(checkDesign(room(shelf, { ...board, parts: [{ ...board.parts[0]!, text: 'visit www.example.com' }] })).some((f) => f.includes('link'))).toBe(true)
    expect(checkDesign(room(shelf, { ...board, parts: [{ ...board.parts[0]!, text: 'A label that is far too long' }] })).some((f) => f.includes('longer than'))).toBe(true)
    expect(checkDesign(room(shelf, { ...plant, parts: [{ ...plant.parts[0]!, text: 'Pot' }] })).some((f) => f.includes('only panels'))).toBe(true)
  })

  it('fails parts below the floor, and reports malformed parts instead of throwing', () => {
    expect(checkDesign(room(shelf, { ...plant, parts: [{ ...plant.parts[0]!, at: [0, 0, 0] }] })).some((f) => f.includes('below the floor'))).toBe(true)
    const broken = { ...plant, parts: [{ shape: 'blob', size: [1], at: [0, 0.5, 0], color: 'green' }] } as unknown as Prop
    const failures = checkDesign(room(shelf, broken))
    expect(failures.some((f) => f.includes('unknown shape'))).toBe(true)
    expect(failures.some((f) => f.includes('three numbers'))).toBe(true)
  })

  it('tidies small slips before the check: a garbled colour turns neutral, stray and extra labels go', () => {
    const garbled = { ...plant, parts: [{ ...plant.parts[0]!, color: '#9b8straight', text: 'Pot' }] }
    const boards = Array.from({ length: 8 }, (_, i) => ({ ...board, name: `board ${i}` }))
    const tidied = tidy(room(shelf, garbled, ...boards))
    expect(tidied.props[1]!.parts[0]).toMatchObject({ color: '#cfc8bd' })
    expect(tidied.props[1]!.parts[0]!.text).toBeUndefined()
    expect(tidied.props.flatMap((p) => p.parts).filter((p) => p.text)).toHaveLength(limits.labels)
    expect(checkDesign(tidied).filter((f) => f.includes('colour') || f.includes('label'))).toEqual([])
  })
})
