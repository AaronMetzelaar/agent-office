import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Decision, RequestSource, ResolveResult } from '../../shared/permissions'

export const ntfyServer = 'https://ntfy.sh'
export const decisionTtlMs = 30 * 60_000
export const priorities = { needs: 4, stuck: 4, done: 3, review: 3, housekeeping: 2 } as const

export type PushKind = keyof typeof priorities
export type PhoneDecision = 'allow' | 'deny'

export interface Push {
  kind: PushKind
  title: string
  message: string
  request?: { id: string; dangerous: boolean }
}

export interface NtfyOptions {
  topic: string
  replyTopic: string
  key: Buffer
  resolve(requestId: string, decision: Decision, source: RequestSource): ResolveResult
  fetch?: typeof fetch
  log?: (message: string) => void
  now?: () => number
  onOpen?: () => void
}

export const configDir = () => process.env.AGENT_OFFICE_CONFIG_DIR ?? join(homedir(), '.config', 'agent-office')

export function readConfig(dir: string, name: string): string | undefined {
  try {
    return readFileSync(join(dir, name), 'utf8').trim() || undefined
  } catch {
    return undefined
  }
}

export const sign = (key: Buffer, payload: string) => createHmac('sha256', key).update(payload).digest('base64url')

export function decisionBody(key: Buffer, requestId: string, decision: PhoneDecision, expiresAt: number): string {
  return JSON.stringify({ r: requestId, d: decision, e: expiresAt, s: sign(key, `${requestId}.${decision}.${expiresAt}`) })
}

export function verifyDecision(key: Buffer, raw: string, now: number): { requestId: string; decision: PhoneDecision } | { reason: string } {
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return { reason: 'not JSON' }
  }
  const { r, d, e, s } = body ?? {}
  if (typeof r !== 'string' || (d !== 'allow' && d !== 'deny') || typeof e !== 'number' || typeof s !== 'string') return { reason: 'malformed' }
  const expected = Buffer.from(sign(key, `${r}.${d}.${e}`))
  const given = Buffer.from(s)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { reason: 'bad signature' }
  if (now > e) return { reason: 'expired' }
  return { requestId: r, decision: d }
}

export function publishBody(topic: string, replyTopic: string, key: Buffer, push: Push, now: number) {
  const request = push.request
  const expiresAt = now + decisionTtlMs
  const url = `${ntfyServer}/${replyTopic}`
  const button = (label: string, decision: PhoneDecision) => ({ action: 'http', label, url, method: 'POST', body: decisionBody(key, request!.id, decision, expiresAt), clear: true })
  return {
    topic,
    title: push.title,
    message: request?.dangerous ? `${push.message}\nAllow from your Mac` : push.message,
    priority: priorities[push.kind],
    ...(request?.dangerous ? { tags: ['warning'] } : {}),
    ...(request ? { actions: [...(request.dangerous ? [] : [button('Allow once', 'allow')]), button('Deny', 'deny')] } : {}),
  }
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((done) => {
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', () => (clearTimeout(timer), done()), { once: true })
  })

export function createNtfy({ topic, replyTopic, key, resolve, fetch: request = fetch, log = (message) => console.warn(`[ntfy] ${message}`), now = Date.now, onOpen }: NtfyOptions) {
  async function post(push: Push): Promise<number | undefined> {
    try {
      const response = await request(ntfyServer, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(publishBody(topic, replyTopic, key, push, now())) })
      if (!response.ok) log(`post failed: HTTP ${response.status}`)
      return response.status
    } catch (error) {
      log(`post failed: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  function subscribe(): () => void {
    const controller = new AbortController()
    const seen = new Set<string>()
    let since = String(Math.floor(now() / 1000))
    let delay = 1000

    const handle = (line: string) => {
      let event: { id?: string; event?: string; message?: string }
      try {
        event = JSON.parse(line)
      } catch {
        return
      }
      if (event.event === 'open') {
        delay = 1000
        onOpen?.()
      }
      if (event.event !== 'message' || typeof event.message !== 'string') return
      if (event.id) since = event.id
      const verdict = verifyDecision(key, event.message, now())
      if ('reason' in verdict) return log(`ignored a phone decision: ${verdict.reason}`)
      if (seen.has(event.message)) return log('ignored a phone decision: replayed')
      seen.add(event.message)
      const result = resolve(verdict.requestId, { kind: verdict.decision }, 'phone')
      if ('error' in result) log(`ignored a phone decision: ${result.error}`)
    }

    const listen = async () => {
      const response = await request(`${ntfyServer}/${replyTopic}/json?since=${since}`, { signal: controller.signal })
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        const lines = (buffer + value).split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) if (line.trim()) handle(line)
      }
    }

    void (async () => {
      while (!controller.signal.aborted) {
        await listen().catch((error) => {
          if (!controller.signal.aborted) log(`reply stream dropped: ${error instanceof Error ? error.message : String(error)}`)
        })
        await wait(delay, controller.signal)
        delay = Math.min(delay * 2, 60_000)
      }
    })()
    return () => controller.abort()
  }

  return { post, subscribe }
}

export interface PhonePushOptions {
  dir: string
  vault: { ntfyKey(): string | undefined; setNtfyKey(key: string): void }
  settings: { setting(key: string): unknown; saveSetting(key: string, value: unknown): void }
  resolve: NtfyOptions['resolve']
  fetch?: typeof fetch
  log?: (message: string) => void
  onOpen?: () => void
}

function importKey(dir: string, vault: PhonePushOptions['vault'], log: (message: string) => void): string | undefined {
  const stored = vault.ntfyKey()
  if (stored) return stored
  const fromFile = readConfig(dir, 'ntfy-hmac-key')
  if (fromFile) {
    try {
      vault.setNtfyKey(fromFile)
    } catch (error) {
      log(`kept the HMAC key file only: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return fromFile
}

export function createPhonePush({ dir, vault, settings, log = (message) => console.warn(`[ntfy] ${message}`), ...rest }: PhonePushOptions) {
  const topic = readConfig(dir, 'ntfy-topic')
  const replyTopic = readConfig(dir, 'ntfy-reply-topic')
  const keyHex = topic && replyTopic ? importKey(dir, vault, log) : undefined
  const ntfy = topic && replyTopic && keyHex ? createNtfy({ topic, replyTopic, key: Buffer.from(keyHex, 'hex'), log, ...rest }) : undefined
  let unsubscribe: (() => void) | undefined

  const enabled = () => !!ntfy && settings.setting('phonePush') !== false
  const apply = () => {
    if (enabled() && !unsubscribe) unsubscribe = ntfy!.subscribe()
    if (!enabled() && unsubscribe) {
      unsubscribe()
      unsubscribe = undefined
    }
  }
  apply()

  return {
    available: !!ntfy,
    enabled,
    set(on: boolean) {
      settings.saveSetting('phonePush', on)
      apply()
    },
    post: (push: Push) => (enabled() ? ntfy!.post(push) : Promise.resolve(undefined)),
    stop: () => unsubscribe?.(),
  }
}
