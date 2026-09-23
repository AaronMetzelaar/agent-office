import { query } from '@anthropic-ai/claude-agent-sdk'
import { loadTokens, sessionEnv, scratchDir, inputQueue, writeResult } from './lib.ts'

async function probe(label: string, token: string) {
  const input = inputQueue()
  const q = query({ prompt: input.iterable, options: { cwd: scratchDir(), env: sessionEnv(token), canUseTool: async () => ({ behavior: 'deny', message: 'no tools' }) } })
  const rateLimitEvents: unknown[] = []
  let usage: unknown = null
  input.push('Reply with exactly: ok')
  for await (const msg of q) {
    const m = msg as Record<string, any>
    if (m.type === 'rate_limit_event') rateLimitEvents.push(m.rate_limit_info)
    if (m.type === 'result') {
      try {
        const u = await (q as any).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
        usage = u?.rate_limits ?? u
      } catch (e) {
        usage = `error: ${String(e).slice(0, 200)}`
      }
      input.end()
    }
  }
  return { label, rateLimitEvents, usage }
}

const tokens = loadTokens()
const sameToken = tokens.main === tokens.research
const [main, research] = await Promise.all([probe('main', tokens.main), probe('research', tokens.research)])
const fingerprint = (r: { usage: unknown; rateLimitEvents: unknown[] }) => JSON.stringify(r.usage ?? r.rateLimitEvents)
const verdict = {
  sameToken,
  usageDiffers: fingerprint(main) !== fingerprint(research),
  main: main.usage ?? main.rateLimitEvents,
  research: research.usage ?? research.rateLimitEvents
}
writeResult('account-identity', verdict)
console.log(JSON.stringify(verdict, null, 2))
