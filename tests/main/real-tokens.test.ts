import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateWithSdk } from '../../src/main/accounts/health'

function spikeTokens(): [string, string][] {
  const raw = readFileSync(join(homedir(), '.config', 'agent-office', 'spike.env'), 'utf8')
  const vars = new Map(
    raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes('=') && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
  )
  return [
    ['main', vars.get('MAIN_TOKEN') ?? ''],
    ['research', vars.get('RESEARCH_TOKEN') ?? ''],
  ]
}

describe.skipIf(process.env.AGENT_OFFICE_REAL_TOKENS !== '1')('real token validation', () => {
  it('validates both accounts and reads their headroom', { timeout: 180_000 }, async () => {
    const results = await Promise.all(
      spikeTokens().map(async ([label, token]) => ({
        label,
        ...(await validateWithSdk(token).catch((error: unknown) => ({ status: 'error', message: String(error).split(token).join('[token]') }))),
      })),
    )
    console.log(JSON.stringify(results, null, 2))
    expect(results.map(({ label, status }) => ({ label, status }))).toEqual([
      { label: 'main', status: 'ok' },
      { label: 'research', status: 'ok' },
    ])
  })
})
