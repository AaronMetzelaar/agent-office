import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { CanUseTool, PermissionResult, SDKMessage, SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk'
import { run, type Run } from '../../src/main/review/git'
import type { ImageBlock } from '../../src/main/sessions/attachments'
import type { ChatCanUseTool, Engine, EngineEvents, SessionPermissions, StartOptions } from '../../src/main/sessions/manager'

const message = (fields: Record<string, unknown>) => ({ uuid: randomUUID(), session_id: 'fake', ...fields }) as unknown as SDKMessage

export const sdk = {
  init: (sessionId: string, model = 'claude-fake-1', permissionMode?: string) => message({ type: 'system', subtype: 'init', session_id: sessionId, model, ...(permissionMode ? { permissionMode } : {}) }),
  status: (permissionMode: string) => message({ type: 'system', subtype: 'status', status: null, permissionMode }),
  delta: (text: string) => message({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } }),
  text: (text: string, parent: string | null = null) => message({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'text', text }] } }),
  toolUse: (tools: { id: string; name: string; input: unknown }[], parent: string | null = null) =>
    message({ type: 'assistant', parent_tool_use_id: parent, message: { content: tools.map((tool) => ({ type: 'tool_use', ...tool })) } }),
  toolResult: (toolUseId: string, content: unknown, isError = false) =>
    message({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }] } }),
  result: (inputTokens = 100, outputTokens = 20, costUsd = 0.01) =>
    message({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'ok',
      total_cost_usd: costUsd,
      modelUsage: { 'claude-fake-1': { inputTokens, outputTokens, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: costUsd } },
    }),
  errorResult: (text: string) => message({ type: 'result', subtype: 'success', is_error: true, result: text, total_cost_usd: 0, modelUsage: {} }),
  apiError: (error: string) => message({ type: 'assistant', parent_tool_use_id: null, error, message: { content: [] } }),
  rateLimit: (info: SDKRateLimitInfo) => message({ type: 'rate_limit_event', rate_limit_info: info }),
  taskStarted: (toolUseId: string) => message({ type: 'system', subtype: 'task_started', task_id: 't', tool_use_id: toolUseId, description: '', is_backgrounded: true }),
  taskProgress: (toolUseId: string, summary: string) => message({ type: 'system', subtype: 'task_progress', task_id: 't', tool_use_id: toolUseId, description: '', usage: { total_tokens: 0, tool_uses: 0, duration_ms: 0 }, summary }),
  backgroundTasks: (...tasks: { ambient?: boolean; task_type?: string; description?: string }[]) => message({ type: 'system', subtype: 'background_tasks_changed', tasks: tasks.map((task, index) => ({ task_id: `t${index}`, task_type: 'local_bash', description: '', ...task })) }),
  taskNotification: (toolUseId: string) => message({ type: 'system', subtype: 'task_notification', task_id: 't', tool_use_id: toolUseId, status: 'completed', output_file: '', summary: '' }),
}

interface FakeSession {
  options: StartOptions
  sessionId: string
  initialized: boolean
  permissions?: SessionPermissions
  pid: number
}

interface FakeProcess {
  ppid: number
  kb: number
  args: string
}

type AskOptions = Partial<Parameters<CanUseTool>[2]>

const tick = () => new Promise((resolve) => setTimeout(resolve, 15))
const pastIpcFlush = () => new Promise((resolve) => setTimeout(resolve, 40))

export function ruleMatches(rule: string, toolName: string, input: Record<string, unknown>): boolean {
  const [, name, content] = /^([^(]+)(?:\((.*)\))?$/.exec(rule) ?? []
  if (name !== toolName) return false
  if (content === undefined) return true
  const value = String(input.command ?? input.file_path ?? input.url ?? '')
  return content.endsWith(':*') ? value.startsWith(content.slice(0, -2)) : value === content
}

export function createFakeEngine({ auto = false } = {}) {
  const events = new EventEmitter<EngineEvents>()
  const live = new Map<string, FakeSession>()
  const starts: { chatId: string; options: StartOptions }[] = []
  const sent: { chatId: string; text: string; images?: ImageBlock[] }[] = []
  const sentIds: string[] = []
  const calls: string[] = []
  const topics: (string | undefined)[] = []
  const table = new Map<number, FakeProcess>()
  const signals: { pid: number; signal: string }[] = []
  const ignoresTerm = new Set<number>()
  let nextPid = 70_000
  let supported = ['compact', 'review', 'mws-test-cases', 'mws-verify', 'mws-review', 'mws-pr', 'pr-comment-rundown', 'gh-fix-ci', 'pr-review-rundown']
  const context = { tokens: 42_000, max: 200_000, percent: 21 }
  const emit = (chatId: string, sdkMessage: SDKMessage) => events.emit('message', chatId, sdkMessage)
  const listed = () => supported.map((name) => ({ name, description: '', argumentHint: '' }))

  function ask(chatId: string, toolName: string, input: Record<string, unknown>, options: AskOptions = {}): Promise<PermissionResult | null> {
    const session = live.get(chatId)
    if (!session) throw new Error(`no fake session for ${chatId}`)
    const permissions = session.permissions
    if (!permissions?.ask.includes(toolName) && permissions?.allow.some((rule) => ruleMatches(rule, toolName, input))) return Promise.resolve({ behavior: 'allow', updatedInput: input })
    if (!fake.canUseTool) throw new Error('the fake engine has no canUseTool')
    return fake.canUseTool(chatId, toolName, input, { signal: new AbortController().signal, toolUseID: randomUUID(), requestId: randomUUID(), ...options })
  }

  const init = (chatId: string) => {
    const session = live.get(chatId)
    if (!session) throw new Error(`no fake session for ${chatId}`)
    session.initialized = true
    emit(chatId, sdk.init(session.sessionId))
    events.emit('commands', chatId, listed())
  }

  async function play(chatId: string, text: string) {
    const session = live.get(chatId)
    const still = () => live.get(chatId) === session
    await tick()
    if (!still()) return
    if (!session?.initialized) init(chatId)
    if (text.includes('[hang]')) return
    if (text.includes('[simulator]')) return void emit(chatId, sdk.toolUse([{ id: randomUUID(), name: 'mcp__Claude_Code_iOS_Simulator__control', input: { action: 'screenshot', device: 'C4E6C1AB-97B3-410B-98C9-2F544E48EE48' } }]))
    if (text.includes('[ask]') || text.includes('[danger]')) {
      const command = text.includes('[danger]') ? 'rm -rf dist' : 'pnpm test'
      const suggestions = [{ type: 'addRules' as const, rules: [{ toolName: 'Bash', ruleContent: command }], behavior: 'allow' as const, destination: 'localSettings' as const }]
      const decision = await ask(chatId, 'Bash', { command }, { suggestions })
      if (!still()) return
      emit(chatId, sdk.text(decision?.behavior === 'allow' ? 'Tests pass.' : 'Skipped the tests.'))
    }
    if (text.includes('[plan]')) {
      const decision = await ask(chatId, 'ExitPlanMode', { plan: '## Plan\n\n1. Read `BidFlow.vue`\n2. Fix the rounding\n3. Run the tests' })
      if (!still()) return
      emit(chatId, sdk.text(decision?.behavior === 'allow' ? 'Plan approved, starting.' : `Back to planning: ${decision?.behavior === 'deny' ? decision.message : ''}`))
    }
    for (const piece of ['Sure', ', ', 'done', '.']) {
      await tick()
      if (!still()) return
      emit(chatId, sdk.delta(piece))
    }
    await pastIpcFlush()
    if (!still()) return
    emit(chatId, sdk.text('Sure, done.'))
    emit(chatId, sdk.result())
  }

  const engine = {
    events,
    start(chatId, options) {
      starts.push({ chatId, options })
      const pid = (nextPid += 10)
      table.set(pid, { ppid: process.pid, kb: 250_000, args: '/fake/bin/claude --output-format stream-json' })
      table.set(pid + 1, { ppid: pid, kb: 300_000, args: 'node /fake/node_modules/.bin/vite --port 5173' })
      live.set(chatId, { options, sessionId: options.resume && !options.forkSession ? options.resume : randomUUID(), initialized: false, permissions: options.permissions, pid })
    },
    send(chatId, text, id, images) {
      if (!live.has(chatId)) throw new Error('This chat has no running session')
      sent.push({ chatId, text, ...(images?.length ? { images } : {}) })
      sentIds.push(id)
      if (auto) void play(chatId, text)
    },
    async interrupt(chatId) {
      calls.push(`interrupt:${chatId}`)
      if (auto && live.has(chatId)) emit(chatId, sdk.errorResult('[Request interrupted by user]'))
    },
    stop(chatId) {
      const pid = live.get(chatId)?.pid
      live.delete(chatId)
      if (!pid) return
      table.delete(pid)
      for (const proc of table.values()) if (proc.ppid === pid) proc.ppid = 1
    },
    async setModel(chatId, model) {
      calls.push(`setModel:${chatId}:${model}`)
    },
    async setEffort(chatId, effort) {
      calls.push(`setEffort:${chatId}:${effort}`)
    },
    async setPermissionMode(chatId, mode) {
      calls.push(`setPermissionMode:${chatId}:${mode}`)
    },
    async setPermissions(chatId, permissions) {
      const session = live.get(chatId)
      if (!session) throw new Error('This chat has no running session')
      session.permissions = permissions
      calls.push(`setPermissions:${chatId}:${permissions.allow.join(',')}`)
    },
    async stopTask(chatId, taskId) {
      calls.push(`stopTask:${chatId}:${taskId}`)
    },
    contextUsage: async () => context,
    async rewindFiles(chatId, messageId, dryRun) {
      calls.push(`rewind:${chatId}:${messageId}:${dryRun ? 'dry' : 'real'}`)
      return { canRewind: true, filesChanged: ['a.ts', 'b.ts'], insertions: 3, deletions: 7 }
    },
    running: (chatId) => live.has(chatId),
    pid: (chatId) => live.get(chatId)?.pid,
    commands: (chatId) => (starts.some((start) => start.chatId === chatId) ? listed() : undefined),
    topic: async () => topics.shift(),
  } satisfies Engine

  const processes = {
    table,
    signals,
    ignoresTerm,
    run: (async (command, args, cwd) => (command === 'ps' ? [...table].map(([pid, proc]) => `${pid} ${proc.ppid} ${proc.kb} ${proc.args}`).join('\n') : run(command, args, cwd))) as Run,
    kill(pid: number, signal: NodeJS.Signals) {
      signals.push({ pid, signal })
      if (!table.has(pid)) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
      if (!ignoresTerm.has(pid)) table.delete(pid)
    },
    alive: (pid: number) => table.has(pid),
  }

  const fake = Object.assign(engine, {
    canUseTool: undefined as ChatCanUseTool | undefined,
    ask,
    permissions: (chatId: string) => live.get(chatId)?.permissions,
    starts,
    sent,
    sentIds,
    calls,
    topics,
    emit,
    init,
    processes,
    supports(commands: string[]) {
      supported = commands
    },
    sessionId: (chatId: string) => live.get(chatId)?.sessionId,
    exit(chatId: string, error?: string) {
      live.delete(chatId)
      events.emit('end', chatId, error)
    },
  })
  return fake
}

export type FakeEngine = ReturnType<typeof createFakeEngine>
