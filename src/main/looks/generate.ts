import { readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { checkDesign, designSchema, limits, roomSize, tidy, type Design } from '../../shared/looks'
import { sessionEnv, spawnClaude } from '../sessions/manager'

const manifests = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'Gemfile', 'Podfile', 'composer.json', 'build.gradle', 'build.gradle.kts', 'pubspec.yaml', 'Package.swift']
const cap = (text: string, size: number) => (text.length > size ? `${text.slice(0, size)}\n[cut]` : text)
const read = (path: string, size: number) => {
  try {
    return cap(readFileSync(path, 'utf8'), size)
  } catch {
    return undefined
  }
}

export interface RepoInput {
  room?: string
  about?: string
  mws?: boolean
  folder: string
  readme?: string
  manifests: Record<string, string>
  files: string[]
}

export function repoInput(root: string): RepoInput {
  let names: string[] = []
  try {
    names = readdirSync(root).filter((name) => !name.startsWith('.') && !['node_modules', 'dist', 'coverage'].includes(name)).sort()
  } catch {}
  const readme = names.find((name) => /^readme(\.|$)/i.test(name))
  return {
    folder: basename(root),
    ...(readme ? { readme: read(join(root, readme), 6000) } : {}),
    manifests: Object.fromEntries(names.filter((name) => manifests.includes(name)).flatMap((name) => { const text = read(join(root, name), 2000); return text ? [[name, text]] : [] })),
    files: names.slice(0, 80),
  }
}

const sizes = ([1, 2, 3] as const).map((t) => { const { w, d } = roomSize(t); return `tier ${t}: ${w.toFixed(1)} m wide, ${d.toFixed(1)} m deep` }).join('; ')

export const guidelines = `You design the decoration for one room in Agent Office, a cute but professional isometric 3D office where each room belongs to a code repository. You return the room as data. The office checks it and draws it.

Style
- Chunky, rounded, low-poly, matte, in soft daylight colours, like a tidy toy model of a modern office. No glossy, glowing or see-through materials.
- Make the room unmistakably about this project, and a little over the top, like a themed set in a toy shop. Work out what the project is about from its name and README, before its tech stack. A launch tracker gets a launch pad with a rocket on its gantry, a weather app a rooftop weather station, a home server lab a humming rack wall with blinking lights and cable trays, a trading tool a ticker wall with a trading bell. Never make a room that only says "JavaScript" or "code".
- The signature piece is a showpiece, the one you'd point at from across the office, and it gets the stage: a spot in the middle of the back wall, up to ${limits.stage.width} m wide, ${limits.stage.depth} m deep and ${limits.height} m tall. Build it to fill the stage, with 10 to 20 parts and at least one picture.
- Fill the room: 4 or 5 props at tier 1. Supporting pieces stand either side of the stage, each up to about 2 m wide and 1.3 m deep, with a picture or two hung on the wall above them.
- Every other prop carries the theme too. No generic office filler: no plain bookshelves, filing cabinets or potted plants unless they're themed (a plant in a rocket-shaped pot is fine).
- When the input says mws is true, the room belongs to MWS (MatchWornShirt), a marketplace where fans buy and bid on match-worn football shirts. Theme it on that and on the room's own part of the product: framed shirts, auction boards, pitches, kit rooms, trophies, stadium lights. No real club crests, player names or MWS logos.
- Don't repeat the signature pieces of the rooms listed as already standing.
- No real logos, crests, brand names or people. Labels are short words, not sentences.

Scale
- Characters are about 1.1 m tall. Desks are 1.6 m wide, 0.76 m deep and 0.75 m high. A bookshelf is about 0.9 × 1.8 × 0.35 m, a potted plant about 0.5 m across.
- Keep props believable next to those, and no taller than ${limits.height} m.

The room
- Sizes: ${sizes}. Desks fill the middle of the room, and characters walk between them.
- You don't place props. You say which zone each prop belongs in and in what order, and the office lines them up, shrinking a prop that's too big for its zone and leaving out extras that don't fit at that size.
  - back: along the back wall. The signature piece goes here, plus the room's other big pieces. A prop whose parts all start at least 0.9 m up hangs on the wall above the floor props: frames, boards, screens, shelves.
  - side: a strip along the right wall, which exists from tier 2 only. Tall narrow things fit best: a cooler, a lamp, a tower, a statue.
- Keep floor props shallow enough for the back band: about ${(limits.backDepth - 0.15).toFixed(1)} m front to back at most. Width is fine up to ${limits.span} m.
- A prop's tiers say at which room sizes it appears. Tier 1 is a room with one to three agents, tier 2 four to six, tier 3 seven or more. At most ${limits.perTier[1]} props show at tier 1, ${limits.perTier[2]} at tier 2 and ${limits.perTier[3]} at tier 3, in the order you list them.
- Exactly one prop is the signature piece: the room's centrepiece, in the back zone from tier 1. Bigger tiers add supporting props.

Parts
- Each prop is up to ${limits.parts} parts, placed relative to the prop's centre on the floor. at is the centre of the part, so a part resting on the floor has at[1] equal to half its height, and nothing goes below 0.
- Build with fewer, bigger parts: 6 to 16 per prop, and nothing thinner than 5 cm except trims. The office is seen from above and far away, so small details vanish. Big shapes and pictures carry the theme.
- Only panels carry text, at most ${limits.labels} labels in the whole room.
- A panel can show a picture, which reads from across the office: shirt (a football shirt; accent is the shirt, textColor the sleeves, collar and number, text the number), pitch (accent is the grass, textColor the lines), dashboard, chart, code (a diff), or app (a phone screen). For the other pictures accent colours the drawing, textColor its ink, and text is a short caption under it. Use them on the showpiece and the wall: framed shirts, auction screens, diff walls, stat boards.
- Shapes: box and rounded (size = width, height, depth), cylinder (size = diameter, height, diameter; taper 0 to 1 narrows the top, 0 makes a cone), sphere (size = diameters, so it can be squashed), panel (a flat board 3 cm thick facing into the room, size = width, height, 0.03; text puts a short label on it, textColor colours the label).
- rot is a tilt in degrees around x, y and z. rotate turns the whole prop around y.
- Colours are #rrggbb. Big surfaces use a soft palette: warm whites, woods, sage, dusty blues, terracotta. One or two strong accent colours are fine on small parts. No neon, no pure black or pure white.
- finish is matte (default), satin or metal.`

export interface Attempt {
  design?: Design
  failures: string[]
  ms: number
  error?: string
  usage?: { input: number; output: number }
}

export type Ask = (system: string, prompt: string) => Promise<{ output?: unknown; error?: string; usage?: { input: number; output: number } }>

export const promptFor = (input: RepoInput, standing: string[], failures: string[] = []) =>
  [
    `Design this room. When it has a folder, the folder's files tell you what the work is about.\n\n${JSON.stringify(input, null, 1)}`,
    standing.length ? `Rooms already standing, with their signature pieces: ${standing.join('; ')}.` : '',
    failures.length ? `Your last design failed the office's check. Fix every point and return the whole room again:\n- ${failures.join('\n- ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

export async function designRoom(ask: Ask, input: RepoInput, standing: string[] = [], now = Date.now): Promise<Attempt[]> {
  const attempts: Attempt[] = []
  let failures: string[] = []
  for (let round = 0; round < 2; round++) {
    const started = now()
    const reply = await ask(guidelines, promptFor(input, standing, failures)).catch((error: unknown) => ({ error: String(error), output: undefined, usage: undefined }))
    const design = reply.output ? tidy(reply.output as Design) : undefined
    failures = design ? checkDesign(design) : [reply.error ?? 'No design came back']
    attempts.push({ ...(design ? { design } : {}), failures, ms: now() - started, ...(reply.error ? { error: reply.error } : {}), ...(reply.usage ? { usage: reply.usage } : {}) })
    if (!failures.length || !design) break
  }
  return attempts
}

export function askWith(token: string | null, model: string): Ask {
  return async (system, prompt) => {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const run = query({
      prompt,
      options: { model, cwd: tmpdir(), systemPrompt: system, tools: [], ...(model.includes('haiku') ? { thinking: { type: 'disabled' as const } } : { effort: 'low' as const }), maxTurns: 4, persistSession: false, settingSources: [], env: sessionEnv(token), spawnClaudeCodeProcess: spawnClaude, outputFormat: { type: 'json_schema', schema: designSchema as unknown as Record<string, unknown> } },
    })
    for await (const message of run) {
      if (message.type !== 'result') continue
      const usage = { input: message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0), output: message.usage.output_tokens }
      if (message.subtype !== 'success' || message.is_error) return { error: message.subtype, usage }
      return { output: message.structured_output ?? JSON.parse(message.result), usage }
    }
    return { error: 'The query ended without a result' }
  }
}
