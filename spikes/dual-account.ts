import { query } from '@anthropic-ai/claude-agent-sdk'
import { loadTokens, sessionEnv, scratchDir, inputQueue, describe, writeResult, maskEmail } from './lib.ts'

type Run = { label: string; startedAt: number; firstTokenAt?: number; endedAt?: number; sessionId?: string; account?: unknown; reply?: string; result?: string; error?: string; log: string[] }

async function run(label: string, token: string, prompt: string): Promise<Run> {
  const r: Run = { label, startedAt: Date.now(), log: [] }
  const input = inputQueue()
  const q = query({
    prompt: input.iterable,
    options: {
      cwd: scratchDir(),
      env: sessionEnv(token),
      permissionMode: 'default',
      canUseTool: async () => ({ behavior: 'deny', message: 'Spike: no tools needed.' })
    }
  })
  input.push(prompt)
  try {
    for await (const msg of q) {
      r.log.push(describe(msg))
      const m = msg as Record<string, any>
      if (m.type === 'system' && m.subtype === 'init') r.sessionId = m.session_id
      if (m.type === 'assistant') {
        r.firstTokenAt ??= Date.now()
        if (m.error) r.error = String(m.error)
        const text = (m.message?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
        if (text) r.reply = (r.reply ?? '') + text
      }
      if (m.type === 'result') {
        r.result = m.subtype
        if (m.subtype !== 'success') r.error ??= m.terminal_reason ?? m.subtype
        try {
          const info = await q.accountInfo()
          r.account = { email: maskEmail(info.email), organization: info.organization, subscriptionType: info.subscriptionType, tokenSource: info.tokenSource }
        } catch (e) {
          r.account = { error: String(e) }
        }
        input.end()
      }
    }
  } catch (e) {
    r.error = String(e).slice(0, 300)
  }
  r.endedAt = Date.now()
  return r
}

const tokens = loadTokens()
const t0 = Date.now()
const [main, research, invalid] = await Promise.all([
  run('main', tokens.main, 'Reply with exactly: ok-main'),
  run('research', tokens.research, 'Reply with exactly: ok-research'),
  run('invalid', 'sk-ant-oat01-invalid-spike-token', 'Reply with exactly: ok-invalid')
])
const overlapMs = Math.min(main.endedAt!, research.endedAt!) - Math.max(main.startedAt, research.startedAt)

const verdict = {
  concurrent: overlapMs > 0,
  overlapMs,
  bothSucceeded: main.result === 'success' && research.result === 'success',
  distinctAccounts: JSON.stringify(main.account) !== JSON.stringify(research.account),
  invalidTokenErrorSurface: invalid.error ?? invalid.result ?? 'no error surfaced',
  totalMs: Date.now() - t0
}
const file = writeResult('dual-account', { verdict, runs: [main, research, invalid] })
console.log(JSON.stringify(verdict, null, 2))
console.log(`details: ${file}`)
