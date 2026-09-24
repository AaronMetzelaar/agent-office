import { createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNotifier } from '../../src/main/notify'
import {
  batchMaxDelayMs,
  batchWindowMs,
  createBatcher,
  createNtfy,
  createPhonePush,
  decisionBody,
  decisionTtlMs,
  publishBody,
  type Push,
  type QuietHours,
} from '../../src/main/notify/ntfy'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

const key = randomBytes(32)
const hmac = (payload: string) => createHmac('sha256', key).update(payload).digest('base64url')

let dir: string
let office: ReturnType<typeof openOffice>
let logs: string[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-ntfy-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  office = openOffice(dir)
  logs = []
})

afterEach(() => {
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

function replyStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) })
  const encode = (event: object) => new TextEncoder().encode(`${JSON.stringify(event)}\n`)
  return {
    response: new Response(body),
    open: () => controller.enqueue(encode({ id: 'o', event: 'open', topic: 'reply' })),
    message: (id: string, message: string) => controller.enqueue(encode({ id, event: 'message', topic: 'reply', message })),
    end: () => controller.close(),
  }
}

function fakeFetch(streams: ReturnType<typeof replyStream>[]) {
  const posts: Record<string, unknown>[] = []
  const urls: string[] = []
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url))
    if (String(url).includes('/json')) return streams.shift()?.response ?? new Response(null, { status: 503 })
    posts.push(JSON.parse(String(init?.body)))
    return new Response('{}', { status: 200 })
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, posts, urls }
}

function asking(command = 'pnpm test') {
  const id = office.start('Run the tests')
  office.engine.init(id)
  const decision = office.engine.ask(id, 'Bash', { command })
  return { id, decision, request: office.chat(id).pendingRequests[0]! }
}

describe('ntfy payloads', () => {
  const now = 1_800_000_000_000
  const push = (kind: Push['kind']): Push => ({ kind, title: 't', message: 'm' })

  it('maps needs-you and stuck to high, done and review to default, housekeeping to low', () => {
    expect(['needs', 'stuck', 'done', 'review', 'housekeeping'].map((kind) => publishBody('topic', 'reply', key, push(kind as Push['kind']), now).priority)).toEqual([4, 4, 3, 3, 2])
  })

  it('signs Allow once and Deny as http actions that post to the reply topic and clear the notification', () => {
    const body = publishBody('topic', 'reply-topic', key, { kind: 'needs', title: 'Run the tests needs you', message: 'm', request: { id: 'req-1', dangerous: false } }, now)
    expect(body).toMatchObject({ topic: 'topic', title: 'Run the tests needs you', message: 'm', priority: 4 })
    expect(body.actions!.map(({ label, action, url, method, clear }) => ({ label, action, url, method, clear }))).toEqual([
      { label: 'Allow once', action: 'http', url: 'https://ntfy.sh/reply-topic', method: 'POST', clear: true },
      { label: 'Deny', action: 'http', url: 'https://ntfy.sh/reply-topic', method: 'POST', clear: true },
    ])
    const [allow, deny] = body.actions!.map((action) => JSON.parse(action.body))
    const e = now + decisionTtlMs
    expect(allow).toEqual({ r: 'req-1', d: 'allow', e, s: hmac(`req-1.allow.${e}`) })
    expect(deny).toEqual({ r: 'req-1', d: 'deny', e, s: hmac(`req-1.deny.${e}`) })
  })

  it('gives a dangerous request only Deny, and says to allow it from the Mac', () => {
    const body = publishBody('topic', 'reply', key, { kind: 'needs', title: 't', message: 'Side projects · Auto mode wants to run: rm -rf …', request: { id: 'r', dangerous: true } }, now)
    expect(body.actions!.map((action) => action.label)).toEqual(['Deny'])
    expect(body.message).toBe('Side projects · Auto mode wants to run: rm -rf …\nAllow from your Mac')
    expect(body.tags).toEqual(['warning'])
  })

  it('posts a redacted summary: agent, department, tool and a short request, never the full command', async () => {
    const { fetch, posts, urls } = fakeFetch([])
    const ntfy = createNtfy({ topic: 'topic', replyTopic: 'reply', key, resolve: office.broker.resolveRequest, fetch, log: (m) => logs.push(m) })
    const notifier = createNotifier({ store: office.store, department: () => 'Marketplace', resolve: () => ({ ok: true }), sendMessage: () => {}, open: () => {}, notification: () => ({ on: () => {}, show: () => {}, close: () => {} }), push: ntfy.post })
    const secret = 'sk-ant-oat01-abcdefghijklmnopqrstuvwxyz0123456789'
    asking(`CLAUDE_CODE_OAUTH_TOKEN=${secret} pnpm test --filter marketplace && cat notes/private.md`)
    await vi.waitFor(() => expect(posts).toHaveLength(1))
    expect(urls).toEqual(['https://ntfy.sh'])
    const text = JSON.stringify(posts[0])
    expect(text).not.toContain(secret)
    expect(text).not.toContain('private.md')
    expect(posts[0]).toMatchObject({ title: 'Run the tests needs you', message: 'Marketplace · Auto mode wants to run: … pnpm …', priority: 4 })
    notifier.stop()
  })
})

describe('phone decisions', () => {
  function listen(streams: ReturnType<typeof replyStream>[], resolve = office.broker.resolveRequest) {
    const net = fakeFetch(streams)
    const ntfy = createNtfy({ topic: 'topic', replyTopic: 'reply', key, resolve, fetch: net.fetch, log: (m) => logs.push(m) })
    return { ...net, stop: ntfy.subscribe() }
  }

  it('a signed Allow once from the phone resolves the request as the phone', async () => {
    const stream = replyStream()
    const { stop, urls } = listen([stream])
    const { id, decision, request } = asking()
    stream.open()
    stream.message('m1', decisionBody(key, request.id, 'allow', Date.now() + decisionTtlMs))
    expect(await decision).toEqual({ behavior: 'allow', updatedInput: { command: 'pnpm test' } })
    expect(office.chat(id).state).toBe('working')
    expect(office.broker.resolveRequest(request.id, { kind: 'deny' }, 'inbox')).toEqual({ error: 'already answered (phone)' })
    expect(urls[0]).toMatch(/^https:\/\/ntfy\.sh\/reply\/json\?since=\d{10}$/)
    stop()
  })

  it('ignores and logs a bad signature, an expired decision, a replay and an already-answered request', async () => {
    const stream = replyStream()
    const resolve = vi.fn(office.broker.resolveRequest)
    const { stop } = listen([stream], resolve)
    const { id, decision, request } = asking()
    const later = Date.now() + decisionTtlMs
    const forged = { ...JSON.parse(decisionBody(key, request.id, 'allow', later)), s: hmac(`${request.id}.deny.${later}`) }
    stream.message('m1', JSON.stringify(forged))
    stream.message('m2', decisionBody(randomBytes(32), request.id, 'allow', later))
    stream.message('m3', decisionBody(key, request.id, 'allow', Date.now() - 1))
    stream.message('m4', 'not json')
    await vi.waitFor(() => expect(logs).toHaveLength(4))
    expect(resolve).not.toHaveBeenCalled()
    expect(office.chat(id).state).toBe('needs-you')

    const deny = decisionBody(key, request.id, 'deny', later)
    stream.message('m5', deny)
    expect(await decision).toMatchObject({ behavior: 'deny' })
    stream.message('m6', deny)

    const second = asking()
    office.broker.resolveRequest(second.request.id, { kind: 'allow' }, 'inbox')
    stream.message('m7', decisionBody(key, second.request.id, 'deny', later))
    await vi.waitFor(() => expect(logs).toHaveLength(6))
    expect(logs).toEqual([
      'ignored a phone decision: bad signature',
      'ignored a phone decision: bad signature',
      'ignored a phone decision: expired',
      'ignored a phone decision: not JSON',
      'ignored a phone decision: replayed',
      'ignored a phone decision: already answered (inbox)',
    ])
    expect(resolve).toHaveBeenCalledTimes(2)
    stop()
  })

  it('reconnects with backoff and picks up after the last message it saw', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const first = replyStream()
    const second = replyStream()
    const { urls, stop } = listen([first, second])
    first.open()
    first.message('abc123', 'noise')
    first.end()
    await vi.waitFor(() => expect(logs).toEqual(['ignored a phone decision: not JSON']))
    expect(urls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(urls[1]).toBe('https://ntfy.sh/reply/json?since=abc123')
    stop()
  })
})

describe('phone push setup', () => {
  const settingsStore = () => {
    const values = new Map<string, unknown>()
    return { setting: (k: string) => values.get(k), saveSetting: (k: string, v: unknown) => void values.set(k, v) }
  }
  const vaultStore = () => {
    let stored: string | undefined
    return { ntfyKey: () => stored, setNtfyKey: vi.fn((value: string) => void (stored = value)) }
  }

  it('is unavailable without the topic files and never posts', async () => {
    const { fetch } = fakeFetch([])
    const phone = createPhonePush({ dir, vault: vaultStore(), settings: settingsStore(), resolve: office.broker.resolveRequest, fetch })
    expect(phone.available).toBe(false)
    expect(phone.enabled()).toBe(false)
    expect(await phone.post({ kind: 'needs', title: 't', message: 'm' })).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('imports the HMAC key into safe storage once, is on by default, and the toggle stops posting and listening', async () => {
    writeFileSync(join(dir, 'ntfy-topic'), 'topic\n')
    writeFileSync(join(dir, 'ntfy-reply-topic'), 'reply\n')
    writeFileSync(join(dir, 'ntfy-hmac-key'), `${key.toString('hex')}\n`)
    const vault = vaultStore()
    const settings = settingsStore()
    const { fetch, posts, urls } = fakeFetch([replyStream()])
    const phone = createPhonePush({ dir, vault, settings, resolve: office.broker.resolveRequest, fetch, log: (m) => logs.push(m) })
    expect(phone.enabled()).toBe(true)
    expect(vault.setNtfyKey).toHaveBeenCalledWith(key.toString('hex'))
    expect(await phone.post({ kind: 'needs', title: 't', message: 'm' })).toBe(200)
    expect(posts).toMatchObject([{ topic: 'topic', priority: 4 }])
    await vi.waitFor(() => expect(urls.some((url) => url.includes('/reply/json'))).toBe(true))

    phone.set(false)
    expect(await phone.post({ kind: 'needs', title: 't', message: 'm' })).toBeUndefined()
    expect(posts).toHaveLength(1)

    writeFileSync(join(dir, 'ntfy-hmac-key'), 'ff'.repeat(32))
    const again = createPhonePush({ dir, vault, settings, resolve: office.broker.resolveRequest, fetch })
    expect(vault.setNtfyKey).toHaveBeenCalledTimes(1)
    expect(again.enabled()).toBe(false)
  })
})

describe('batcher', () => {
  const off: QuietHours = { enabled: false, start: '00:00', end: '00:00' }
  const doneOf = (agent: string): Push => ({ kind: 'done', title: `${agent} is done`, message: 'm', agent })

  afterEach(() => vi.useRealTimers())

  it('merges a burst landing within the window into one summary', async () => {
    vi.useFakeTimers()
    const post = vi.fn(async (_push: Push) => 200)
    const batcher = createBatcher({ post, quietHours: () => off })
    batcher.push(doneOf('A'))
    await vi.advanceTimersByTimeAsync(20_000)
    batcher.push(doneOf('B'))
    await vi.advanceTimersByTimeAsync(20_000)
    batcher.push({ kind: 'review', title: 'C needs review', message: 'm', agent: 'C' })
    expect(post).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(batchWindowMs)
    expect(post).toHaveBeenCalledTimes(1)
    const sent = post.mock.calls[0]![0] as Push
    expect(sent.title).toBe('3 updates')
    expect(sent.message).toBe('2 done: A, B · 1 review: C')
  })

  it('sends needs-you and stuck at once, never merged, even during quiet hours', async () => {
    vi.useFakeTimers()
    const posts: Push[] = []
    const post = vi.fn(async (push: Push) => (posts.push(push), 200))
    const alwaysQuiet: QuietHours = { enabled: true, start: '00:00', end: '23:59' }
    const batcher = createBatcher({ post, quietHours: () => alwaysQuiet })
    void batcher.push({ kind: 'needs', title: 'req1', message: 'm', request: { id: 'r1', dangerous: false } })
    void batcher.push({ kind: 'stuck', title: 'req2', message: 'm' })
    expect(post).toHaveBeenCalledTimes(2)
    expect(posts.map((push) => push.title)).toEqual(['req1', 'req2'])
  })

  it('holds normal pushes during quiet hours and flushes one summary when they end', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 23, 0, 0))
    const post = vi.fn(async (_push: Push) => 200)
    const quiet: QuietHours = { enabled: true, start: '22:00', end: '07:00' }
    const batcher = createBatcher({ post, quietHours: () => quiet })
    batcher.push(doneOf('A'))
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    batcher.push(doneOf('B'))
    expect(post).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(7 * 60 * 60_000)
    expect(post).toHaveBeenCalledTimes(1)
    const sent = post.mock.calls[0]![0] as Push
    expect(sent.message).toContain('A')
    expect(sent.message).toContain('B')
  })

  it('caps a continuous burst at the max delay instead of extending forever', async () => {
    vi.useFakeTimers()
    const post = vi.fn(async (_push: Push) => 200)
    const batcher = createBatcher({ post, quietHours: () => off })
    batcher.push(doneOf('agent-0'))
    for (let i = 1; i <= 5; i++) {
      await vi.advanceTimersByTimeAsync(20_000)
      batcher.push(doneOf(`agent-${i}`))
    }
    expect(post).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(batchMaxDelayMs - 5 * 20_000)
    expect(post).toHaveBeenCalledTimes(1)
    const sent = post.mock.calls[0]![0] as Push
    expect(sent.title).toBe('6 updates')
  })
})
