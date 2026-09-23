import { query, type CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadTokens, sessionEnv, scratchDir, inputQueue, describe, writeResult } from './lib.ts'

type Ask = { step: string; toolName: string; title?: string; displayName?: string; defaultToNo?: boolean; suppressAlwaysAllowRule?: boolean; suggestions?: unknown; decision: string }

const cwd = scratchDir()
writeFileSync(join(cwd, 'notes.txt'), 'spike file\n')
const asks: Ask[] = []
const systemSubtypes = new Set<string>()
const models = new Set<string>()
const log: string[] = []
const checks: Record<string, unknown> = {}
let step = 'boot'

const decide: Record<string, (toolName: string) => 'allow' | 'deny'> = {
  write: t => (t === 'Write' ? 'allow' : 'deny'),
  plan: t => (t === 'ExitPlanMode' ? 'allow' : 'deny'),
  danger: () => 'deny',
  interrupt: () => 'deny'
}

const canUseTool: CanUseTool = async (toolName, input, opts) => {
  const d = decide[step]?.(toolName) ?? 'deny'
  asks.push({ step, toolName, title: opts.title, displayName: opts.displayName, defaultToNo: opts.defaultToNo, suppressAlwaysAllowRule: opts.suppressAlwaysAllowRule, suggestions: opts.suggestions, decision: d })
  return d === 'allow' ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Spike denied this on purpose.' }
}

const input = inputQueue()
const q = query({ prompt: input.iterable, options: { cwd, env: sessionEnv(loadTokens().main), permissionMode: 'default', canUseTool, includePartialMessages: true } })

const hooks: { turnDone: (() => void) | null; onText: (() => void) | null } = { turnDone: null, onText: null }
const consume = (async () => {
  for await (const msg of q) {
    const m = msg as Record<string, any>
    if (m.type !== 'stream_event') log.push(`[${step}] ${describe(msg)}`)
    if (m.type === 'system') { systemSubtypes.add(m.subtype); if (m.model) models.add(m.model) }
    if (m.type === 'assistant' && m.message?.model) models.add(m.message.model)
    if (m.type === 'stream_event' && hooks.onText) { const f = hooks.onText; hooks.onText = null; f() }
    if (m.type === 'result') { const f = hooks.turnDone; hooks.turnDone = null; f?.() }
  }
})()

function turn(name: string, text: string, opts: { interruptOnFirstText?: boolean } = {}) {
  step = name
  return new Promise<void>(resolve => {
    hooks.turnDone = resolve
    if (opts.interruptOnFirstText) hooks.onText = () => { q.interrupt().then(r => { checks.interruptResponse = r ?? 'undefined' }).catch(e => { checks.interruptResponse = `error: ${e}` }) }
    input.push(text)
  })
}

async function attempt(name: string, fn: () => Promise<unknown>) {
  try { checks[name] = (await fn()) ?? 'ok' } catch (e) { checks[name] = `error: ${String(e).slice(0, 200)}` }
}

await turn('write', 'Use the Write tool to create hello.txt containing exactly: hi. Then say done.')
checks.helloWritten = existsSync(join(cwd, 'hello.txt'))

await attempt('setModel', () => q.setModel('sonnet'))
await turn('model', 'Reply with one word: ready.')
await attempt('applyFlagSettings_effort', () => q.applyFlagSettings({ effortLevel: 'low' }))
await turn('effort', 'Reply with one word: fine.')

await attempt('setPermissionMode_plan', () => q.setPermissionMode('plan'))
await turn('plan', 'Plan how you would rename notes.txt to notes.md. Present the plan with ExitPlanMode; do not rename anything yourself.')
await attempt('setPermissionMode_default', () => q.setPermissionMode('default'))

await turn('danger', 'Run this exact bash command and nothing else: rm -rf ./build-cache')

await turn('interrupt', 'Count from 1 to 400, one number per line, no other text.', { interruptOnFirstText: true })

await attempt('supportedCommands', async () => (await q.supportedCommands()).map(c => c.name).slice(0, 60))
await attempt('mcpServerStatus', async () => (await q.mcpServerStatus()).map(s => ({ name: s.name, status: s.status })))

input.end()
await consume

const verdict = {
  allowOnceWorked: checks.helloWritten === true && asks.some(a => a.step === 'write' && a.toolName === 'Write'),
  modelsSeen: [...models],
  setModel: checks.setModel,
  effortSetter: checks.applyFlagSettings_effort,
  planApprovalViaCanUseTool: asks.some(a => a.toolName === 'ExitPlanMode'),
  dangerFlags: asks.filter(a => a.step === 'danger').map(a => ({ toolName: a.toolName, defaultToNo: a.defaultToNo, suppressAlwaysAllowRule: a.suppressAlwaysAllowRule, title: a.title })),
  interrupt: checks.interruptResponse,
  hooksFired: [...systemSubtypes].filter(s => s.startsWith('hook')),
  systemSubtypes: [...systemSubtypes],
  slashCommandCount: Array.isArray(checks.supportedCommands) ? (checks.supportedCommands as unknown[]).length : checks.supportedCommands,
  mcpServers: checks.mcpServerStatus
}
const file = writeResult('controls', { verdict, asks, checks, log, cwd })
console.log(JSON.stringify(verdict, null, 2))
console.log(`details: ${file}`)
