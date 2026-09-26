import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { askWith, designRoom, repoInput, type RepoInput } from '../../src/main/looks/generate'

vi.mock('electron', () => import('../fakes/electron'))

const enabled = process.env.AGENT_OFFICE_LOOK_REBUILD === '1'
const model = process.env.AGENT_OFFICE_LOOK_MODELS ?? 'claude-opus-5'
const code = join(homedir(), 'Documents', 'GitHub')
const mono = join(code, 'monorepo')
const out = resolve(__dirname, '../../docs/solutions/look-spike/rebuild', model)

const rooms: RepoInput[] = [
  { room: 'Marketplace', about: 'The customer-facing marketplace website: shop pages, listings, bidding, checkout, accounts', mws: true, ...repoInput(join(mono, 'frontend', 'marketplace')) },
  { room: 'Admin', about: 'The internal admin portal: back-office tools for staff', mws: true, ...repoInput(join(mono, 'frontend', 'admin')) },
  { room: 'Mobile', about: 'The mobile app', mws: true, ...repoInput(join(mono, 'frontend', 'mobile')) },
  { room: 'Backend / infra', about: 'Backend services, APIs, databases, infrastructure and CI of the monorepo', mws: true, ...repoInput(mono) },
  { room: 'PR reviews', about: 'Agents review other people’s pull requests here: reading diffs, leaving comments, approving or asking for changes', folder: 'PR reviews', manifests: {}, files: [] },
  { room: 'UX Lab', about: 'Refining the app’s forms, menus, interactions and layouts to improve how it feels to use', ...repoInput(join(code, 'agent-office')) },
]

function mainToken() {
  const raw = readFileSync(join(homedir(), '.config', 'agent-office', 'spike.env'), 'utf8')
  const line = raw.split('\n').find((l) => l.trim().startsWith('MAIN_TOKEN='))
  return line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') ?? ''
}

describe.skipIf(!enabled)('rebuilding the current rooms as generated looks', () => {
  it('designs each room in turn and records the checks and timings', { timeout: 1_800_000 }, async () => {
    const token = mainToken(), ask = askWith(token, model), standing: string[] = [], rows = []
    mkdirSync(out, { recursive: true })
    for (const input of rooms) {
      const attempts = await designRoom(ask, input, standing)
      const last = attempts.at(-1)!, signature = last.design?.props.find((p) => p.signature)?.name
      if (signature) standing.push(`${input.room}: ${signature}`)
      writeFileSync(join(out, `${input.room!.replace(/\W+/g, '-')}.json`), JSON.stringify({ room: input.room, attempts: attempts.map(({ error, ...a }) => ({ ...a, ...(error ? { error: error.split(token).join('[token]') } : {}) })) }, null, 1))
      rows.push({ room: input.room, passed: !last.failures.length, seconds: attempts.map((a) => Math.round(a.ms / 1000)).join('+'), signature, theme: last.design?.theme })
    }
    console.table(rows)
    expect(rows).toHaveLength(rooms.length)
  })
})
