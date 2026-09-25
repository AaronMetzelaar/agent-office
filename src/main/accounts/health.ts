import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import type { SDKRateLimitInfo, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AccountHealth, AccountView, AddAccountResult, Headroom, UsageWindow } from '../../shared/ipc'
import { sessionEnv, spawnClaude } from '../sessions/manager'
import { errorReason } from '../sessions/normalize'
import type { Account, Vault } from './tokens'

export type Check = { status: 'ok'; headroom: Headroom } | { status: 'needs-login' }
export type Validator = (token: string) => Promise<Check>

const validationTimeoutMs = 90_000

export interface HealthStore {
  loadHealth(): Map<string, AccountHealth>
  saveHealth(accountId: string, health: AccountHealth | undefined): void
}

export const validateWithSdk: Validator = async (token) => {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const abortController = new AbortController()
  const timer = setTimeout(() => abortController.abort(), validationTimeoutMs)
  let finish = () => {}
  const finished = new Promise<void>((resolve) => (finish = resolve))
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    yield { type: 'user', message: { role: 'user', content: 'Reply with exactly: ok' }, parent_tool_use_id: null }
    await finished
  }
  const session = query({
    prompt: prompt(),
    options: {
      cwd: tmpdir(),
      env: sessionEnv(token),
      model: 'haiku',
      tools: [],
      settingSources: [],
      persistSession: false,
      maxTurns: 1,
      abortController,
      spawnClaudeCodeProcess: spawnClaude,
    },
  })
  const fromEvents: Headroom = {}
  let limited = false
  try {
    for await (const message of session) {
      if (message.type === 'assistant' && message.error === 'authentication_failed') return { status: 'needs-login' }
      if (message.type === 'assistant' && message.error === 'rate_limit') limited = true
      if (message.type === 'rate_limit_event') Object.assign(fromEvents, headroomFromEvent(message.rate_limit_info))
      if (message.type !== 'result') continue
      if (message.is_error && limited) return { status: 'ok', headroom: fromEvents }
      if (message.is_error) throw new Error(message.subtype === 'success' ? message.result : message.errors.join('; '))
      const fromUsage = await session
        .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
        .then((usage) => headroomFromUsage(usage.rate_limits))
        .catch(() => ({}))
      return { status: 'ok', headroom: { ...fromUsage, ...fromEvents } }
    }
    throw new Error('Claude ended the session without replying')
  } catch (error) {
    const reason = errorReason(error)
    if (reason === 'needs-login') return { status: 'needs-login' }
    if (reason === 'rate-limited') return { status: 'ok', headroom: fromEvents }
    throw abortController.signal.aborted ? new Error('Validation timed out') : error
  } finally {
    clearTimeout(timer)
    finish()
    session.close()
  }
}

export const validateWithHeaders: Validator = async (token) => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 0, messages: [{ role: 'user', content: 'ok' }] }),
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 401) return { status: 'needs-login' }
  const headroom = headroomFromHeaders(response.headers)
  if (response.ok || (response.status === 429 && Object.keys(headroom).length)) return { status: 'ok', headroom }
  throw new Error(`Claude answered ${response.status}`)
}

export const validate: Validator = (token) => validateWithHeaders(token).catch(() => validateWithSdk(token))

function headroomFromHeaders(headers: Headers): Headroom {
  const window = (name: string): UsageWindow | undefined => {
    const utilization = Number.parseFloat(headers.get(`anthropic-ratelimit-unified-${name}-utilization`) ?? '')
    if (Number.isNaN(utilization)) return undefined
    const resetsAt = Number.parseInt(headers.get(`anthropic-ratelimit-unified-${name}-reset`) ?? '', 10)
    return Number.isNaN(resetsAt) ? { utilization: utilization * 100 } : { utilization: utilization * 100, resetsAt: resetsAt * 1000 }
  }
  const headroom: Headroom = {}
  const fiveHour = window('5h')
  const sevenDay = window('7d')
  if (fiveHour) headroom.fiveHour = fiveHour
  if (sevenDay) headroom.sevenDay = sevenDay
  return headroom
}

function headroomFromEvent(info: SDKRateLimitInfo): Headroom {
  const utilization = info.utilization ?? (info.status === 'rejected' ? 1 : undefined)
  if (utilization === undefined) return {}
  const window: UsageWindow = { utilization: utilization * 100 }
  if (info.resetsAt !== undefined) window.resetsAt = info.resetsAt * 1000
  if (info.rateLimitType === 'five_hour') return { fiveHour: window }
  if (info.rateLimitType === 'seven_day') return { sevenDay: window }
  return {}
}

type UsageLimit = { utilization: number | null; resets_at: string | null } | null | undefined

function headroomFromUsage(limits: { five_hour?: UsageLimit; seven_day?: UsageLimit } | null): Headroom {
  const window = (limit: UsageLimit): UsageWindow | undefined => {
    if (limit?.utilization == null) return undefined
    return limit.resets_at ? { utilization: limit.utilization, resetsAt: Date.parse(limit.resets_at) } : { utilization: limit.utilization }
  }
  const headroom: Headroom = {}
  const fiveHour = window(limits?.five_hour)
  const sevenDay = window(limits?.seven_day)
  if (fiveHour) headroom.fiveHour = fiveHour
  if (sevenDay) headroom.sevenDay = sevenDay
  return headroom
}

export const fakeValidator: Validator = async (token) =>
  token.includes('fake-ok')
    ? { status: 'ok', headroom: { fiveHour: { utilization: 42, resetsAt: Date.now() + 2 * 3600_000 }, sevenDay: { utilization: 81, resetsAt: Date.now() + 3 * 86400_000 } } }
    : { status: 'needs-login' }

const redact = (text: string, secret: string) => text.split(secret).join('[token]')

export function createAccounts(vault: Vault, validate: Validator, saved?: HealthStore) {
  const health = saved?.loadHealth() ?? new Map<string, AccountHealth>()
  const events = new EventEmitter<{ changed: [AccountView[]]; 'needs-login': [Account]; removed: [string] }>()

  const view = (account: Account): AccountView => ({
    id: account.id,
    label: account.label,
    createdAt: account.createdAt,
    health: health.get(account.id) ?? { status: 'unknown' },
  })
  const list = () => vault.list().map(view)
  const changed = () => events.emit('changed', list())
  const setHealth = (account: Account, next: AccountHealth) => {
    const wasNeedsLogin = health.get(account.id)?.status === 'needs-login'
    health.set(account.id, next)
    saved?.saveHealth(account.id, next)
    if (next.status === 'needs-login' && !wasNeedsLogin) events.emit('needs-login', account)
    changed()
  }
  const healthFrom = (check: Check): AccountHealth =>
    check.status === 'ok' ? { status: 'ok', headroom: check.headroom, lastCheckedAt: Date.now() } : { status: 'needs-login', lastCheckedAt: Date.now() }

  return {
    events,
    list,

    async add(label: unknown, token: unknown): Promise<AddAccountResult> {
      if (typeof label !== 'string' || typeof token !== 'string') return { error: 'Enter a label and a token.' }
      const name = label.trim()
      const secret = token.trim()
      if (!name || name.length > 32) return { error: 'Give the account a label of up to 32 characters.' }
      if (!secret || secret.length > 4096 || /\s/.test(secret)) return { error: 'That doesn’t look like a token. Paste the whole line that claude setup-token printed.' }
      try {
        const check = await validate(secret)
        if (check.status === 'needs-login') return { error: 'Claude rejected this token (401). Run claude setup-token again and paste the new token.' }
        const existing = vault.findByLabel(name)
        if (existing) vault.replaceToken(existing.id, secret)
        const account = existing ?? vault.add(name, secret)
        setHealth(account, healthFrom(check))
        return { account: view(account) }
      } catch (error) {
        return { error: `Couldn’t add the account: ${redact(error instanceof Error ? error.message : String(error), secret)}` }
      }
    },

    remove(id: unknown): void {
      if (typeof id !== 'string' || !vault.find(id)) return
      vault.remove(id)
      health.delete(id)
      saved?.saveHealth(id, undefined)
      events.emit('removed', id)
      changed()
    },

    async revalidate(id: unknown): Promise<void> {
      const account = typeof id === 'string' ? vault.find(id) : undefined
      if (!account) return
      const token = vault.token(account.id)
      if (!token) return setHealth(account, { status: 'needs-login', lastCheckedAt: Date.now() })
      const previous = health.get(account.id)
      const next = await validate(token).then(healthFrom, () => ({ ...previous, status: 'unknown' as const, lastCheckedAt: Date.now() }))
      if (vault.find(account.id)) setHealth(account, next)
    },

    loginFailed(id: string): void {
      const account = vault.find(id)
      if (account && health.get(id)?.status !== 'needs-login') setHealth(account, { ...health.get(id), status: 'needs-login' })
    },

    exists: (id: string) => vault.find(id) !== undefined,

    label: (id: string) => vault.find(id)?.label,

    needsLogin: (id: string) => health.get(id)?.status === 'needs-login',

    recordHeadroom(id: string, info: SDKRateLimitInfo): void {
      const account = vault.find(id)
      const update = headroomFromEvent(info)
      if (!account || !Object.keys(update).length) return
      const current = health.get(id) ?? { status: 'unknown' }
      setHealth(account, { ...current, status: current.status === 'unknown' ? 'ok' : current.status, headroom: { ...current.headroom, ...update } })
    },
  }
}
