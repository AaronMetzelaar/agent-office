import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [question, ...options] = process.argv.slice(2)
if (!question || options.length < 1 || options.length > 3) {
  console.error('usage: tsx ask-phone.ts "<question>" "<option 1>" ["<option 2>"] ["<option 3>"]  (env WAIT_MINUTES, default 30)')
  process.exit(2)
}

const dir = join(homedir(), '.config', 'agent-office')
const read = (name: string) => readFileSync(join(dir, name), 'utf8').trim()
const topic = read('ntfy-topic')
const replyUrl = `https://ntfy.sh/${read('ntfy-reply-topic')}`
const key = Buffer.from(read('ntfy-hmac-key'), 'hex')
const sign = (payload: string) => createHmac('sha256', key).update(payload).digest('base64url')

const id = randomUUID()
const waitMs = Number(process.env.WAIT_MINUTES ?? 30) * 60_000
const expiresAt = Date.now() + waitMs
const since = Math.floor(Date.now() / 1000)
const body = (option: string) => JSON.stringify({ r: id, d: option, e: expiresAt, s: sign(`${id}.${option}.${expiresAt}`) })

const res = await fetch('https://ntfy.sh', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    topic,
    title: 'Agent Office build needs a decision',
    message: question,
    priority: 4,
    tags: ['question'],
    actions: options.map(o => ({ action: 'http', label: o.slice(0, 40), url: replyUrl, method: 'POST', body: body(o), clear: true }))
  })
})
if (!res.ok) { console.error(`ntfy send failed: HTTP ${res.status}`); process.exit(1) }
console.log('sent; waiting for a tap…')

const valid = (raw: string) => {
  try {
    const { r, d, e, s } = JSON.parse(raw)
    if (r !== id || Date.now() > e) return undefined
    const a = Buffer.from(sign(`${r}.${d}.${e}`)), b = Buffer.from(String(s))
    return a.length === b.length && timingSafeEqual(a, b) ? String(d) : undefined
  } catch { return undefined }
}

while (Date.now() < expiresAt) {
  const text = await (await fetch(`${replyUrl}/json?poll=1&since=${since}`)).text()
  for (const line of text.split('\n').filter(Boolean)) {
    const m = JSON.parse(line)
    const answer = m.event === 'message' ? valid(m.message) : undefined
    if (answer) { console.log(`answer: ${answer}`); process.exit(0) }
  }
  await new Promise(r => setTimeout(r, 5000))
}
console.log('no answer yet')
process.exit(1)
