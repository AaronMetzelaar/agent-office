import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { CanUseTool, PermissionMode, Query, RewindFilesResult, SDKMessage, SDKUserMessage, SlashCommand, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import type { ContextUsage, Effort } from '../../shared/chat'
import type { ImageBlock } from './attachments'

export const outsideAsar = (path: string) => path.replace(/\bapp\.asar(?=[/\\])/, 'app.asar.unpacked')

export const spawnClaude = ({ command, args, cwd, env, signal }: SpawnOptions) => {
  const child = spawn(outsideAsar(command), args, { cwd, env, signal, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stderr.resume()
  return child
}

export type SessionPermissions = { allow: string[]; ask: string[] }

export interface StartOptions {
  accountId: string
  cwd: string
  model?: string
  effort?: Effort
  permissionMode?: PermissionMode
  permissions?: SessionPermissions
  resume?: string
  forkSession?: boolean
}

export type EngineEvents = { message: [chatId: string, message: SDKMessage]; end: [chatId: string, error?: string]; commands: [chatId: string, commands: SlashCommand[]] }

export interface Engine {
  events: EventEmitter<EngineEvents>
  start(chatId: string, options: StartOptions): void
  send(chatId: string, text: string, id: string, images?: ImageBlock[]): void
  interrupt(chatId: string): Promise<void>
  stop(chatId: string): void
  setModel(chatId: string, model: string): Promise<void>
  setEffort(chatId: string, effort: Effort): Promise<void>
  setPermissionMode(chatId: string, mode: PermissionMode): Promise<void>
  setPermissions(chatId: string, permissions: SessionPermissions): Promise<void>
  stopTask(chatId: string, taskId: string): Promise<void>
  contextUsage(chatId: string): Promise<ContextUsage>
  rewindFiles(chatId: string, messageId: string, dryRun: boolean): Promise<RewindFilesResult>
  running(chatId: string): boolean
  pid(chatId: string): number | undefined
  commands(chatId: string): SlashCommand[] | undefined
  topic(accountId: string, prompt: string): Promise<string | undefined>
}

const topicPrompt = 'Name the topic of this request to a coding agent in 3 to 6 words, like a chat title. Reply with the title only: no quotes, no trailing period.'

const topicOf = (reply: string) => reply.trim().split('\n')[0]!.replace(/^["'`*#\s]+|["'`*.\s]+$/g, '').slice(0, 60) || undefined

export type ChatCanUseTool = (chatId: string, ...args: Parameters<CanUseTool>) => ReturnType<CanUseTool>

interface Session {
  input: ReturnType<typeof inputQueue>
  ready: Promise<Query>
  spawned: { pid?: number }
  stopped: boolean
}

export function sessionEnv(token: string | null): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  delete env.ANTHROPIC_API_KEY
  delete env.CLAUDE_CONFIG_DIR
  delete env.CLAUDE_CODE_ENTRYPOINT
  delete env.CLAUDE_CODE_OAUTH_TOKEN
  if (token !== null) env.CLAUDE_CODE_OAUTH_TOKEN = token
  return env
}

function inputQueue() {
  const pending: SDKUserMessage[] = []
  let wake = () => {}
  let done = false
  async function* messages(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      const next = pending.shift()
      if (next) yield next
      else if (done) return
      else await new Promise<void>((resolve) => (wake = resolve))
    }
  }
  return {
    messages: messages(),
    push(text: string, id: string, images: ImageBlock[] = []) {
      const content = images.length ? [...images, { type: 'text' as const, text }] : text
      pending.push({ type: 'user', uuid: id as SDKUserMessage['uuid'], message: { role: 'user', content }, parent_tool_use_id: null })
      wake()
    },
    end() {
      done = true
      wake()
    },
  }
}

export function createSessionManager(tokenFor: (accountId: string) => string | null | undefined, canUseTool: ChatCanUseTool): Engine {
  const events = new EventEmitter<EngineEvents>()
  const sessions = new Map<string, Session>()
  const commands = new Map<string, SlashCommand[]>()
  const learn = (chatId: string, list: SlashCommand[]) => {
    commands.set(chatId, list)
    events.emit('commands', chatId, list)
  }

  const live = (chatId: string) => {
    const session = sessions.get(chatId)
    if (!session) throw new Error('This chat has no running session')
    return session.ready
  }

  async function consume(chatId: string, session: Session, token: string | null) {
    let error: string | undefined
    try {
      const query = await session.ready
      void query.supportedCommands().then((list) => session.stopped || learn(chatId, list), () => {})
      for await (const message of query) {
        if (session.stopped) return
        if (message.type === 'system' && message.subtype === 'commands_changed') learn(chatId, message.commands)
        events.emit('message', chatId, message)
      }
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown)
      error = token === null ? message : message.split(token).join('[token]')
    }
    if (session.stopped) return
    if (sessions.get(chatId) === session) sessions.delete(chatId)
    events.emit('end', chatId, error)
  }

  function stop(chatId: string) {
    const session = sessions.get(chatId)
    if (!session) return
    session.stopped = true
    sessions.delete(chatId)
    session.input.end()
    void session.ready.then((query) => query.close(), () => {})
  }

  return {
    events,
    start(chatId, options) {
      stop(chatId)
      const token = tokenFor(options.accountId)
      if (token === undefined) throw new Error('401: no token is stored for this account')
      const input = inputQueue()
      const spawned: { pid?: number } = {}
      const ready = import('@anthropic-ai/claude-agent-sdk').then(({ query }) =>
        query({
          prompt: input.messages,
          options: {
            cwd: options.cwd,
            env: sessionEnv(token),
            extraArgs: token === null ? { chrome: null } : undefined,
            permissionMode: options.permissionMode ?? 'auto',
            model: options.model,
            effort: options.effort,
            resume: options.resume,
            forkSession: options.forkSession,
            settings: options.permissions ? { permissions: options.permissions } : undefined,
            includePartialMessages: true,
            forwardSubagentText: true,
            agentProgressSummaries: true,
            promptSuggestions: true,
            enableFileCheckpointing: true,
            perTaskStopAffordance: true,
            canUseTool: (...args) => canUseTool(chatId, ...args),
            spawnClaudeCodeProcess: (spawnOptions) => {
              const child = spawnClaude(spawnOptions)
              spawned.pid = child.pid
              return child
            },
          },
        }),
      )
      const session: Session = { input, ready, spawned, stopped: false }
      sessions.set(chatId, session)
      void consume(chatId, session, token)
    },
    send(chatId, text, id, images) {
      const session = sessions.get(chatId)
      if (!session) throw new Error('This chat has no running session')
      session.input.push(text, id, images)
    },
    async interrupt(chatId) {
      await (await live(chatId)).interrupt()
    },
    stop,
    async setModel(chatId, model) {
      await (await live(chatId)).setModel(model)
    },
    async setEffort(chatId, effort) {
      await (await live(chatId)).applyFlagSettings({ effortLevel: effort })
    },
    async setPermissionMode(chatId, mode) {
      await (await live(chatId)).setPermissionMode(mode)
    },
    async setPermissions(chatId, permissions) {
      await (await live(chatId)).applyFlagSettings({ permissions })
    },
    async stopTask(chatId, taskId) {
      await (await live(chatId)).stopTask(taskId)
    },
    async contextUsage(chatId) {
      const usage = await (await live(chatId)).getContextUsage({ detail: 'summary' })
      return { tokens: usage.totalTokens, max: usage.maxTokens, percent: Math.round(usage.percentage) }
    },
    async rewindFiles(chatId, messageId, dryRun) {
      return (await live(chatId)).rewindFiles(messageId, { dryRun })
    },
    running: (chatId) => sessions.has(chatId),
    pid: (chatId) => sessions.get(chatId)?.spawned.pid,
    commands: (chatId) => commands.get(chatId),
    async topic(accountId, prompt) {
      const token = tokenFor(accountId)
      if (token === undefined) return undefined
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const run = query({ prompt: prompt.slice(0, 4000), options: { model: 'haiku', systemPrompt: topicPrompt, tools: [], maxTurns: 1, persistSession: false, settingSources: [], env: sessionEnv(token), spawnClaudeCodeProcess: spawnClaude } })
      for await (const message of run) if (message.type === 'result') return message.subtype === 'success' && !message.is_error ? topicOf(message.result) : undefined
      return undefined
    },
  }
}
