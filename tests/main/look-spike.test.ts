import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { askWith, designRoom, repoInput } from '../../src/main/looks/generate'

vi.mock('electron', () => import('../fakes/electron'))

const enabled = process.env.AGENT_OFFICE_LOOK_SPIKE === '1'
const repos = (process.env.AGENT_OFFICE_LOOK_REPOS ?? 'mws-gate,frontend-stp-Aaron-Metzelaar,portfolio,homelab,poseidon-q4').split(',').map((name) => join(homedir(), 'Documents', 'GitHub', name))
const models = (process.env.AGENT_OFFICE_LOOK_MODELS ?? 'claude-haiku-4-5,claude-sonnet-5,claude-opus-5').split(',')
const out = resolve(__dirname, '../../docs/solutions/look-spike')

function mainToken() {
  const raw = readFileSync(join(homedir(), '.config', 'agent-office', 'spike.env'), 'utf8')
  const line = raw.split('\n').find((l) => l.trim().startsWith('MAIN_TOKEN='))
  return line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') ?? ''
}

describe.skipIf(!enabled)('generated look spike', () => {
  it('designs a room for each repo on each model, and records the checks and timings', { timeout: 1_800_000 }, async () => {
    const token = mainToken()
    const rows = await Promise.all(
      models.map(async (model) => {
        const ask = askWith(token, model)
        const standing: string[] = []
        const results = []
        for (const root of repos) {
          const input = repoInput(root)
          const attempts = await designRoom(ask, input, standing)
          const last = attempts.at(-1)!
          const signature = last.design?.props.find((p) => p.signature)?.name
          if (signature) standing.push(`${input.folder}: ${signature}`)
          mkdirSync(join(out, model), { recursive: true })
          writeFileSync(join(out, model, `${input.folder}.json`), JSON.stringify({ attempts: attempts.map(({ error, ...a }) => ({ ...a, ...(error ? { error: error.split(token).join('[token]') } : {}) })) }, null, 1))
          results.push({ model, repo: input.folder, passed: !last.failures.length, tries: attempts.length, seconds: attempts.map((a) => Math.round(a.ms / 100) / 10), output: attempts.map((a) => a.usage?.output ?? 0), failures: attempts.map((a) => a.failures.length), signature })
        }
        return results
      }),
    )
    const flat = rows.flat()
    writeFileSync(join(out, 'summary.json'), JSON.stringify(flat, null, 1))
    console.table(flat.map(({ model, repo, passed, tries, seconds, output, failures, signature }) => ({ model, repo, passed, tries, seconds: seconds.join('+'), output: output.join('+'), failures: failures.join('>'), signature })))
    expect(flat).toHaveLength(models.length * repos.length)
  })
})
