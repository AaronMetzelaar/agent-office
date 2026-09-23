import { tmpdir } from 'node:os'
import type { Options, SDKUserMessage, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionManager } from '../../src/main/sessions/manager'

const sdk = vi.hoisted(() => ({
  options: undefined as Options | undefined,
  prompt: undefined as AsyncIterable<SDKUserMessage> | undefined,
  messages: [] as unknown[],
  thrown: undefined as Error | undefined,
  hold: undefined as Promise<void> | undefined,
  control: { interrupt: vi.fn(), setModel: vi.fn(), applyFlagSettings: vi.fn(), setPermissionMode: vi.fn(), close: vi.fn() },
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
    sdk.options = options
    sdk.prompt = prompt
    async function* stream() {
      yield* sdk.messages
      await sdk.hold
      if (sdk.thrown) throw sdk.thrown
    }
    return Object.assign(stream(), sdk.control)
  },
}))

const token = 'sk-ant-oat01-SECRET-abc123'
const tokens: Record<string, string> = { main: token }

afterEach(() => {
  sdk.options = undefined
  sdk.prompt = undefined
  sdk.messages = []
  sdk.thrown = undefined
  sdk.hold = undefined
  vi.unstubAllEnvs()
})

function manager(canUseTool = vi.fn()) {
  const engine = createSessionManager((id) => tokens[id], canUseTool)
  const seen: unknown[] = []
  const ended: (string | undefined)[] = []
  engine.events.on('message', (chatId, message) => seen.push([chatId, message]))
  engine.events.on('end', (_chatId, error) => ended.push(error))
  return { engine, seen, ended, canUseTool }
}

describe('session manager', () => {
  it('starts a streaming query with only the account token, Auto mode by default and partial messages', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-api-should-not-leak')
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/elsewhere')
    const { engine, seen } = manager()
    sdk.messages = [{ type: 'system', subtype: 'init' }]

    const permissions = { allow: ['Bash(pnpm test)'], ask: ['WebFetch', 'WebSearch'] }
    engine.start('c1', { accountId: 'main', cwd: tmpdir(), model: 'haiku', effort: 'low', resume: 'sess-1', permissions })
    await vi.waitFor(() => expect(seen).toHaveLength(1))

    expect(sdk.options).toMatchObject({ cwd: tmpdir(), permissionMode: 'auto', model: 'haiku', effort: 'low', resume: 'sess-1', includePartialMessages: true, settings: { permissions } })
    expect(sdk.options?.forkSession).toBeUndefined()
    expect(sdk.options?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe(token)
    expect(sdk.options?.env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(sdk.options?.env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
  })

  it('feeds sent text into the prompt stream and routes controls to the live query', async () => {
    let release = () => {}
    sdk.hold = new Promise((resolve) => (release = resolve))
    const { engine } = manager()
    engine.start('c1', { accountId: 'main', cwd: tmpdir() })
    engine.send('c1', 'hello')
    await vi.waitFor(() => expect(sdk.prompt).toBeDefined())

    const first = await sdk.prompt![Symbol.asyncIterator]().next()
    expect(first.value).toEqual({ type: 'user', message: { role: 'user', content: 'hello' }, parent_tool_use_id: null })

    await engine.interrupt('c1')
    await engine.setModel('c1', 'sonnet')
    await engine.setEffort('c1', 'high')
    await engine.setPermissionMode('c1', 'plan')
    await engine.setPermissions('c1', { allow: [], ask: ['WebFetch'] })
    expect(sdk.control.interrupt).toHaveBeenCalled()
    expect(sdk.control.setModel).toHaveBeenCalledWith('sonnet')
    expect(sdk.control.applyFlagSettings).toHaveBeenCalledWith({ effortLevel: 'high' })
    expect(sdk.control.setPermissionMode).toHaveBeenCalledWith('plan')
    expect(sdk.control.applyFlagSettings).toHaveBeenCalledWith({ permissions: { allow: [], ask: ['WebFetch'] } })
    release()
  })

  it('reports a thrown iterator error as the end of that chat, with the token redacted', async () => {
    sdk.thrown = new Error(`401 OAuth access token is invalid: ${token}`)
    const { engine, ended } = manager()
    engine.start('c1', { accountId: 'main', cwd: tmpdir() })

    await vi.waitFor(() => expect(ended).toEqual(['401 OAuth access token is invalid: [token]']))
    expect(engine.running('c1')).toBe(false)
  })

  it('stays quiet about a session it was asked to stop', async () => {
    let release = () => {}
    sdk.hold = new Promise((resolve) => (release = resolve))
    sdk.thrown = new Error('aborted')
    const { engine, ended } = manager()
    engine.start('c1', { accountId: 'main', cwd: tmpdir() })
    await vi.waitFor(() => expect(sdk.prompt).toBeDefined())

    engine.stop('c1')
    release()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(sdk.control.close).toHaveBeenCalled()
    expect(ended).toEqual([])
  })

  it('refuses to start without a token for the account', () => {
    const { engine } = manager()
    expect(() => engine.start('c1', { accountId: 'gone', cwd: tmpdir() })).toThrow('401')
  })

  it('routes permission asks with the chat id and tracks the spawned process id', async () => {
    let release = () => {}
    sdk.hold = new Promise((resolve) => (release = resolve))
    const { engine, canUseTool } = manager(vi.fn(async () => ({ behavior: 'deny' as const, message: 'no' })))
    engine.start('c1', { accountId: 'main', cwd: tmpdir() })
    await vi.waitFor(() => expect(sdk.options).toBeDefined())

    await sdk.options!.canUseTool!('Bash', { command: 'ls' }, { signal: new AbortController().signal, toolUseID: 't1' } as never)
    expect(canUseTool).toHaveBeenCalledWith('c1', 'Bash', { command: 'ls' }, expect.anything())

    const child = sdk.options!.spawnClaudeCodeProcess!({ command: '/bin/sh', args: ['-c', 'exit 0'], cwd: tmpdir(), env: {}, signal: new AbortController().signal }) as SpawnedProcess & { pid: number }
    expect(engine.pid('c1')).toBe(child.pid)
    await new Promise((resolve) => child.once('exit', resolve))
    release()
  })
})
