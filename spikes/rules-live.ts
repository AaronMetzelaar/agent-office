import { query, type CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { loadTokens, sessionEnv, scratchDir, inputQueue, writeResult } from './lib.ts'

const RULE = 'Bash(touch agent-office-rule-marker)'
const cwd = scratchDir()
const marker = join(cwd, 'agent-office-rule-marker')
const asked: string[] = []
let step = 'boot'
const canUseTool: CanUseTool = async (toolName, input) => {
  asked.push(`${step}:${toolName}:${String((input as { command?: string }).command ?? '')}`)
  return { behavior: 'deny', message: 'spike: denied' }
}

const input = inputQueue()
const q = query({ prompt: input.iterable, options: { cwd, env: sessionEnv(loadTokens().main), permissionMode: 'default', canUseTool } })
const pending: { done: (() => void) | null } = { done: null }
const ran: string[] = []
const consume = (async () => {
  try {
    for await (const msg of q) {
      const m = msg as Record<string, any>
      if (m.type === 'result') { const f = pending.done; pending.done = null; f?.() }
    }
  } catch (e) { ran.push(`error:${String(e).slice(0, 120)}`) }
})()
const turn = async (name: string) => { step = name; rmSync(marker, { force: true }); await new Promise<void>(r => { pending.done = r; input.push('Run exactly this bash command and nothing else: touch agent-office-rule-marker') }); if (existsSync(marker)) ran.push(name) }
const checks: Record<string, unknown> = {}
const attempt = async (name: string, fn: () => Promise<unknown>) => { try { checks[name] = (await fn()) ?? 'ok' } catch (e) { checks[name] = `error: ${String(e).slice(0, 200)}` } }

await turn('no-rule')
await attempt('addRule', () => q.applyFlagSettings({ permissions: { allow: [RULE] } } as never))
await turn('with-rule')
await attempt('removeRule', () => q.applyFlagSettings({ permissions: { allow: [] } } as never))
await turn('after-revoke')
input.end()
await consume

const verdict = {
  askedWithoutRule: asked.some(a => a.startsWith('no-rule:')),
  ranWithRuleWithoutAsking: ran.includes('with-rule') && !asked.some(a => a.startsWith('with-rule:')),
  askedAgainAfterRevoke: asked.some(a => a.startsWith('after-revoke:')),
  checks, asked, ran
}
writeResult('rules-live', verdict)
console.log(JSON.stringify(verdict, null, 2))
