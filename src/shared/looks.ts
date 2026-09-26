export const deskGrid = { cw: 3.2, cd: 2.6, left: 0.3, right: 0.3, back: 2, front: 1.3, side: 1.4 }

export const shapes = ['box', 'rounded', 'cylinder', 'sphere', 'panel'] as const
export const finishes = ['matte', 'satin', 'metal'] as const
export type Shape = (typeof shapes)[number]
export type Finish = (typeof finishes)[number]
export type Vec = [number, number, number]

export interface Part {
  shape: Shape
  size: Vec
  at: Vec
  rot?: Vec
  color: string
  finish?: Finish
  taper?: number
  text?: string
  textColor?: string
}

export interface Prop {
  name: string
  zone: 'back' | 'side'
  x?: number
  z?: number
  rotate?: number
  tiers: number[]
  signature?: boolean
  parts: Part[]
}

export interface Design {
  theme: string
  props: Prop[]
}

export const limits = { props: 14, perTier: [0, 5, 8, 12], parts: 24, allParts: 160, height: 2.8, span: 2.6, labels: 6, label: 18, backDepth: 1.45, sideWidth: 1.5, stretch: 4 }

const tiers = [1, 2, 3] as const
const grids = { 1: { cols: 2, rows: 1 }, 2: { cols: 2, rows: 2 }, 3: { cols: 3, rows: 3 } } as const

export function roomSize(tier: 1 | 2 | 3) {
  const { cols, rows } = grids[tier], g = deskGrid
  return { w: g.left + cols * g.cw + (tier >= 2 ? g.side : 0) + g.right, d: g.back + rows * g.cd + g.front, cols, rows }
}

type Rect = [x0: number, z0: number, x1: number, z1: number]
const overlaps = (a: Rect, b: Rect, pad = 0) => a[0] < b[2] + pad && b[0] < a[2] + pad && a[1] < b[3] + pad && b[1] < a[3] + pad
const area = (a: Rect, b: Rect) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
const rad = (deg = 0) => (deg * Math.PI) / 180

function partBox(part: Part, turn: number): Rect {
  const [w, , d] = part.size
  const [tx = 0, ty = 0, tz = 0] = part.rot ?? []
  const [hw, hd] = tx || tz ? [Math.hypot(w, part.size[1], d) / 2, Math.hypot(w, part.size[1], d) / 2] : [w / 2, (part.shape === 'panel' ? 0.03 : d) / 2]
  const a = rad(ty) + turn, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a))
  const ex = hw * c + hd * s, ez = hw * s + hd * c
  const px = part.at[0] * Math.cos(turn) + part.at[2] * Math.sin(turn), pz = -part.at[0] * Math.sin(turn) + part.at[2] * Math.cos(turn)
  return [px - ex, pz - ez, px + ex, pz + ez]
}

export function footprint(prop: Prop): Rect {
  const turn = rad(prop.rotate)
  return prop.parts.map((part) => partBox(part, turn)).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])])
}

export function placed(prop: Prop, w: number): Rect {
  const [x0, z0, x1, z1] = footprint(prop)
  const x = prop.zone === 'back' ? (prop.x ?? 0) : w - (prop.x ?? 0), z = prop.z ?? 0
  return [x + x0, z + z0, x + x1, z + z1]
}

const standing = (prop: Prop) => prop.parts.some((part) => part.at[1] - part.size[1] / 2 < 0.3)
const hex = /^#[0-9a-f]{6}$/i
const allowedText = /^[^\p{C}]+$/u
const linkish = /https?:|www\.|\.(com|org|io|net|nl|dev|app)\b/i

function colourProblem(color: string, big: boolean) {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1))
  if (l < 0.06 || l > 0.99) return 'too dark or too bright for the office palette'
  if (s > 0.9 && [r, g, b].every((c) => c === 0 || c === 1)) return 'a neon primary, not a soft office colour'
  if (big && s > 0.8) return 'too saturated for a part this big; keep strong colours to small accents'
}

function checkPart(where: string, part: Part): string[] {
  const out: string[] = []
  if (!shapes.includes(part.shape)) out.push(`${where} has an unknown shape "${part.shape}"`)
  const panel = part.shape === 'panel'
  if (part.size.length !== 3 && !(panel && part.size.length === 2)) out.push(`${where} needs three numbers for size`)
  if (part.at.length !== 3 || (part.rot && part.rot.length !== 3)) out.push(`${where} needs three numbers for at and rot`)
  if (part.size.slice(0, panel ? 2 : 3).some((n) => !Number.isFinite(n) || n < 0.005)) out.push(`${where} has a size that isn't a positive number of metres`)
  if ([...part.at, ...(part.rot ?? [])].some((n) => !Number.isFinite(n))) out.push(`${where} has a position or rotation that isn't a number`)
  if (part.at[1] - part.size[1] / 2 < -0.01) out.push(`${where} goes below the floor`)
  if (part.taper !== undefined && !(part.taper >= 0 && part.taper <= 1)) out.push(`${where} has a taper outside 0 to 1`)
  if (part.finish && !finishes.includes(part.finish)) out.push(`${where} has an unknown finish "${part.finish}"`)
  const big = part.size[0]! * part.size[1]! * (panel ? 0.03 : part.size[2] ?? 0) > 0.08
  for (const [color, large] of [[part.color, big], [part.textColor, false]] as const) {
    if (color === undefined) continue
    const problem = hex.test(color) ? colourProblem(color, large) : undefined
    if (!hex.test(color)) out.push(`${where} has a colour that isn't #rrggbb: "${color}"`)
    else if (problem) out.push(`${where} uses ${color}, which is ${problem}`)
  }
  if (part.text !== undefined) {
    if (part.shape !== 'panel') out.push(`${where} has text, but only panels carry text`)
    if (part.text.length > limits.label) out.push(`${where} has a label longer than ${limits.label} characters`)
    if (!allowedText.test(part.text) || linkish.test(part.text)) out.push(`${where} has a label with characters or a link that labels can't use`)
  }
  return out
}

const hanging = (prop: Prop) => prop.parts.every((part) => part.at[1] - part.size[1] / 2 >= 0.9)
const scaled = (prop: Prop, k: number): Prop => (k === 1 ? prop : { ...prop, parts: prop.parts.map((part) => ({ ...part, size: part.size.map((n) => n * k) as Vec, at: part.at.map((n) => n * k) as Vec })) })
const showpiece = 2.2

export function arrange(design: Design, tier: 1 | 2 | 3): Prop[] {
  const { w, d } = roomSize(tier), g = deskGrid, gap = 0.2, edge = 0.2
  const backEnd = tier >= 2 ? w - g.side - g.right - 0.05 : w - edge, room = backEnd - edge
  const here = design.props.filter((prop) => prop.tiers.includes(tier) && (prop.zone === 'back' || tier >= 2)).sort((a, b) => Number(!!b.signature) - Number(!!a.signature)).slice(0, limits.perTier[tier])
  const fit = (prop: Prop, depth: number, width: number) => {
    const [x0, , x1, ] = footprint(prop), [, z0, , z1] = footprint(prop), top = Math.max(...prop.parts.map((part) => part.at[1] + part.size[1] / 2))
    const up = prop.signature ? Math.max(1, Math.min(1.6, showpiece / (x1 - x0))) : 1
    const k = Math.min(up, limits.height / top, depth / (z1 - z0), width / (x1 - x0), limits.span / (x1 - x0))
    return { prop: scaled(prop, k), x0: x0 * k, z0: z0 * k, fw: (x1 - x0) * k, fd: (z1 - z0) * k }
  }
  const out: Prop[] = []
  let sideAt = 0.4
  for (const prop of here.filter((p) => p.zone === 'side')) {
    const f = fit(prop, limits.span, limits.sideWidth - edge)
    if (sideAt + f.fd > d - 2.3) continue
    out.push({ ...f.prop, x: f.x0 + f.fw + edge, z: sideAt - f.z0 })
    sideAt += f.fd + gap
  }
  for (const lane of ['floor', 'wall'] as const) {
    const items = here.filter((p) => p.zone === 'back' && (lane === 'wall') === hanging(p)).map((p) => fit(p, limits.backDepth - 0.15, room))
    while (items.length > 1 && items.reduce((n, f) => n + f.fw, 0) + gap * (items.length - 1) > room) items.pop()
    const [first, ...rest] = items
    const row = first?.prop.signature ? [...rest.filter((_, i) => i % 2), first, ...rest.filter((_, i) => !(i % 2))] : items
    const spacing = (room - row.reduce((n, f) => n + f.fw, 0)) / (row.length + 1)
    let at = edge + spacing
    for (const f of row) {
      out.push({ ...f.prop, x: at - f.x0, z: (lane === 'wall' ? 0.05 : 0.1) - f.z0 })
      at += f.fw + spacing
    }
  }
  return out
}

export function checkDesign(design: Design): string[] {
  const out: string[] = []
  const props = design.props ?? []
  if (props.length > limits.props) out.push(`The room has ${props.length} props; the budget is ${limits.props}`)
  if (props.reduce((n, p) => n + (p.parts?.length ?? 0), 0) > limits.allParts) out.push(`The room has more than ${limits.allParts} parts in total`)
  if (props.reduce((n, p) => n + (p.parts ?? []).filter((part) => part.text).length, 0) > limits.labels) out.push(`The room has more than ${limits.labels} labels`)
  const signature = props.filter((p) => p.signature)
  if (signature.length !== 1) out.push(`The room needs exactly one signature prop; it has ${signature.length}`)
  else if (signature[0]!.zone !== 'back' || !signature[0]!.tiers.includes(1)) out.push(`The signature prop "${signature[0]!.name}" must stand in the back zone from tier 1`)
  const shaped: Prop[] = []
  props.forEach((prop, i) => {
    const where = `Prop ${i + 1} ("${prop.name}")`
    const before = out.length
    if (prop.zone !== 'back' && prop.zone !== 'side') out.push(`${where} is in an unknown zone "${prop.zone}"`)
    if (!Array.isArray(prop.parts) || !prop.parts.length) out.push(`${where} has no parts`)
    else if (prop.parts.length > limits.parts) out.push(`${where} has ${prop.parts.length} parts; the budget is ${limits.parts}`)
    if (!Array.isArray(prop.tiers) || !prop.tiers.length || prop.tiers.some((t) => !tiers.includes(t as 1))) out.push(`${where} needs tiers from 1, 2 and 3`)
    if (!Number.isFinite(prop.rotate ?? 0)) out.push(`${where} has a rotation that isn't a number`)
    ;(prop.parts ?? []).forEach((part, k) => out.push(...checkPart(`${where}, part ${k + 1}`, part)))
    if (out.length === before) shaped.push(prop)
  })
  for (const tier of tiers) {
    const { w: narrow, d, cols, rows } = roomSize(tier)
    const here = arrange({ ...design, props: shaped }, tier)
    for (const w of [narrow, narrow + limits.stretch]) {
      const g = deskGrid
      const keepOut: [string, Rect][] = [['the sign', [0, d - 0.7, 1.5, d]], ['the entrance gap', [w - g.side - g.right, d - 2.2, w, d]], ['the front walkway', [0, d - g.front, w, d]]]
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const cx = g.left + g.cw * (c + 0.5), cz = g.back + g.cd * (r + 0.5)
          keepOut.push([`desk ${r * cols + c + 1}`, [cx - 0.8, cz - 0.38, cx + 0.8, cz + 0.38]], [`the chair at desk ${r * cols + c + 1}`, [cx - 0.35, cz - 1.15, cx + 0.35, cz - 0.38]])
        }
      const width = w === narrow ? 'narrowest' : 'stretched'
      here.forEach((prop) => {
        const box = placed(prop, w), where = `"${prop.name}" at tier ${tier} (${width})`
        if (box[0] < 0.05 || box[1] < 0 || box[2] > w - 0.05 || box[3] > d) out.push(`${where} sticks out of the room`)
        if (prop.parts.some((part) => part.at[1] + part.size[1] / 2 > limits.height + 0.001)) out.push(`${where} is taller than ${limits.height} m`)
        if (prop.zone === 'back' && box[3] > limits.backDepth) out.push(`${where} reaches ${box[3].toFixed(2)} m from the back wall; the back zone ends at ${limits.backDepth} m`)
        if (prop.zone === 'back' && tier >= 2 && box[2] > w - g.side - g.right) out.push(`${where} runs into the side zone`)
        if (prop.zone === 'side' && box[0] < w - limits.sideWidth - 0.15) out.push(`${where} reaches past the side zone toward the desks`)
        for (const [name, rect] of keepOut) if (overlaps(box, rect, 0.1)) out.push(`${where} covers or crowds ${name}`)
      })
      here.forEach((a, i) =>
        here.slice(i + 1).forEach((b) => {
          if (standing(a) && standing(b) && area(placed(a, w), placed(b, w)) > 0.02) out.push(`"${a.name}" and "${b.name}" overlap at tier ${tier} (${width})`)
        }),
      )
    }
  }
  return [...new Set(out)]
}

const vec = { type: 'array', items: { type: 'number' } }
export const designSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['theme', 'props'],
  properties: {
    theme: { type: 'string' },
    props: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'zone', 'tiers', 'parts'],
        properties: {
          name: { type: 'string' },
          zone: { enum: ['back', 'side'] },
          rotate: { type: 'number' },
          tiers: { type: 'array', items: { enum: [1, 2, 3] } },
          signature: { type: 'boolean' },
          parts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['shape', 'size', 'at', 'color'],
              properties: { shape: { enum: [...shapes] }, size: vec, at: vec, rot: vec, color: { type: 'string' }, finish: { enum: [...finishes] }, taper: { type: 'number' }, text: { type: 'string' }, textColor: { type: 'string' } },
            },
          },
        },
      },
    },
  },
} as const
