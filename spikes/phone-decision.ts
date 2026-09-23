import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dir = join(homedir(), '.config', 'agent-office')
const read = (name: string) => readFileSync(join(dir, name), 'utf8').trim()
const topic = read('ntfy-topic')
const replyTopic = read('ntfy-reply-topic')
const key = Buffer.from(read('ntfy-hmac-key'), 'hex')
const server = 'https://ntfy.sh'

const sign = (payload: string) => createHmac('sha256', key).update(payload).digest('base64url')

function decisionBody(requestId: string, decision: 'allow' | 'deny', expiresAt: number): string {
  const payload = `${requestId}.${decision}.${expiresAt}`
  return JSON.stringify({ r: requestId, d: decision, e: expiresAt, s: sign(payload) })
}

function verify(body: string, requestId: string): { ok: boolean; decision?: string; reason?: string } {
  try {
    const { r, d, e, s } = JSON.parse(body)
    if (r !== requestId) return { ok: false, reason: 'other request' }
    if (Date.now() > e) return { ok: false, reason: 'expired' }
    const expected = Buffer.from(sign(`${r}.${d}.${e}`))
    const got = Buffer.from(String(s))
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return { ok: false, reason: 'bad signature' }
    return { ok: true, decision: d }
  } catch {
    return { ok: false, reason: 'unparseable' }
  }
}

const requestId = randomUUID()
const expiresAt = Date.now() + 30 * 60_000
const replyUrl = `${server}/${replyTopic}`
const since = Math.floor(Date.now() / 1000)

const res = await fetch(server, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    topic,
    title: 'Dialog flow CI fix needs you',
    message: 'Marketplace · Auto mode wants to run: pnpm test --filter marketplace (test)',
    priority: 4,
    tags: ['rotating_light'],
    actions: [
      { action: 'http', label: 'Allow once', url: replyUrl, method: 'POST', body: decisionBody(requestId, 'allow', expiresAt), clear: true },
      { action: 'http', label: 'Deny', url: replyUrl, method: 'POST', body: decisionBody(requestId, 'deny', expiresAt), clear: true }
    ]
  })
})
console.log(`sent: HTTP ${res.status}; waiting up to 3 minutes for a tap…`)

const deadline = Date.now() + 3 * 60_000
while (Date.now() < deadline) {
  const poll = await fetch(`${replyUrl}/json?poll=1&since=${since}`)
  const lines = (await poll.text()).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(m => m.event === 'message')
  for (const m of lines) {
    const v = verify(m.message, requestId)
    if (v.ok) {
      console.log(`received and verified: ${v.decision}`)
      process.exit(0)
    }
    console.log(`ignored a reply: ${v.reason}`)
  }
  await new Promise(r => setTimeout(r, 3000))
}
console.log('no tap received within 3 minutes')
process.exit(1)
