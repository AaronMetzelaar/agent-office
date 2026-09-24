import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateWithHeaders, validateWithSdk } from '../../src/main/accounts/health'

const sdk = vi.hoisted(() => ({
  messages: [] as unknown[],
  thrown: undefined as Error | undefined,
  usage: vi.fn(),
  options: undefined as { env: Record<string, string> } | undefined,
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ options }: { options: { env: Record<string, string> } }) => {
    sdk.options = options
    async function* stream() {
      yield* sdk.messages
      if (sdk.thrown) throw sdk.thrown
    }
    return Object.assign(stream(), {
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: sdk.usage,
      close: vi.fn(),
    })
  },
}))

const result = { type: 'result', subtype: 'success', is_error: false, result: 'ok' }
const fiveHourEvent = {
  type: 'rate_limit_event',
  rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.6, resetsAt: 1_790_000_000 },
}

afterEach(() => {
  sdk.messages = []
  sdk.thrown = undefined
  sdk.usage.mockReset()
})

describe('validateWithSdk', () => {
  it('runs with only the account token and merges headroom from rate limit events and the usage call', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-api-should-not-leak')
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/elsewhere')
    sdk.messages = [fiveHourEvent, result]
    sdk.usage.mockResolvedValue({
      rate_limits: {
        five_hour: { utilization: 58, resets_at: '2026-09-23T20:00:00.000Z' },
        seven_day: { utilization: 77, resets_at: '2026-09-26T12:00:00.000Z' },
      },
    })

    const check = await validateWithSdk('sk-ant-oat01-token')

    expect(check).toEqual({
      status: 'ok',
      headroom: {
        fiveHour: { utilization: 60, resetsAt: 1_790_000_000_000 },
        sevenDay: { utilization: 77, resetsAt: Date.parse('2026-09-26T12:00:00.000Z') },
      },
    })
    expect(sdk.options?.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-token')
    expect(sdk.options?.env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(sdk.options?.env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
    vi.unstubAllEnvs()
  })

  it('still validates when the experimental usage call fails', async () => {
    sdk.messages = [fiveHourEvent, result]
    sdk.usage.mockRejectedValue(new Error('unsupported'))

    expect(await validateWithSdk('token')).toEqual({ status: 'ok', headroom: { fiveHour: { utilization: 60, resetsAt: 1_790_000_000_000 } } })
  })

  it('maps a thrown 401 to needs-login', async () => {
    sdk.thrown = new Error('Failed to authenticate. API Error: 401 OAuth access token is invalid')

    expect(await validateWithSdk('token')).toEqual({ status: 'needs-login' })
  })

  it('maps an authentication_failed assistant error to needs-login', async () => {
    sdk.messages = [{ type: 'assistant', error: 'authentication_failed', message: { content: [] } }, result]

    expect(await validateWithSdk('token')).toEqual({ status: 'needs-login' })
  })

  it('treats a rate limit during validation as ok but limited, keeping the reset time', async () => {
    sdk.messages = [
      { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1_790_000_000 } },
      { type: 'assistant', error: 'rate_limit', message: { content: [] } },
      { ...result, is_error: true, result: 'You’ve hit your usage limit' },
    ]

    expect(await validateWithSdk('token')).toEqual({ status: 'ok', headroom: { fiveHour: { utilization: 100, resetsAt: 1_790_000_000_000 } } })
  })

  it('treats a thrown rate limit error as ok but limited', async () => {
    sdk.thrown = new Error('Claude Code returned an error result: API Error: 429 rate_limit_error')

    expect(await validateWithSdk('token')).toEqual({ status: 'ok', headroom: {} })
  })

  it('surfaces other failures as errors', async () => {
    sdk.messages = [{ ...result, is_error: true, result: 'API Error: 529 overloaded' }]

    await expect(validateWithSdk('token')).rejects.toThrow('529 overloaded')
  })
})

describe('validateWithHeaders', () => {
  const answer = (status: number, headers: Record<string, string> = {}) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status, headers })))
  const limits = {
    'anthropic-ratelimit-unified-5h-utilization': '0.42',
    'anthropic-ratelimit-unified-5h-reset': '1790280600',
    'anthropic-ratelimit-unified-7d-utilization': '1.0',
    'anthropic-ratelimit-unified-7d-reset': '1790470800',
  }
  afterEach(() => vi.unstubAllGlobals())

  it('reads both windows from the rate limit headers of a zero-token request', async () => {
    answer(200, limits)
    expect(await validateWithHeaders('token')).toEqual({ status: 'ok', headroom: { fiveHour: { utilization: 42, resetsAt: 1_790_280_600_000 }, sevenDay: { utilization: 100, resetsAt: 1_790_470_800_000 } } })
    const [, init] = vi.mocked(fetch).mock.calls[0]!
    expect(JSON.parse(String(init?.body))).toMatchObject({ max_tokens: 0 })
  })

  it('treats a rate limited answer with headers as a valid token out of headroom', async () => {
    answer(429, limits)
    expect(await validateWithHeaders('token')).toMatchObject({ status: 'ok' })
  })

  it('maps 401 to needs login and throws on anything else', async () => {
    answer(401)
    expect(await validateWithHeaders('token')).toEqual({ status: 'needs-login' })
    answer(400)
    await expect(validateWithHeaders('token')).rejects.toThrow('400')
  })
})
