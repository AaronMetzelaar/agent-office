import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export const hookNames = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SubagentStop', 'SessionEnd'] as const
export type HookName = (typeof hookNames)[number]

export interface HookEvent {
  session_id: string
  hook_event_name: HookName
  cwd?: string
  prompt?: string
  tool_name?: string
  tool_input?: unknown
  tool_use_id?: string
  message?: string
  notification_type?: string
}

export interface Listener {
  port: number
  close(): Promise<void>
}

export const maxBody = 1024 * 1024
export const secretHeader = 'X-Agent-Office-Secret'

const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isSessionId = (value: unknown): value is string => typeof value === 'string' && sessionPattern.test(value)

const digest = (value: string) => createHash('sha256').update(value).digest()
const sameSecret = (given: unknown, secret: string) => typeof given === 'string' && timingSafeEqual(digest(given), digest(secret))
const loopbackHosts = (port: number) => [`127.0.0.1:${port}`, `localhost:${port}`]

export function parseEvent(body: string): HookEvent | undefined {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(body)
  } catch {
    return undefined
  }
  if (!raw || typeof raw !== 'object' || !isSessionId(raw.session_id) || !hookNames.includes(raw.hook_event_name as HookName)) return undefined
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
  return {
    session_id: raw.session_id,
    hook_event_name: raw.hook_event_name as HookName,
    cwd: text(raw.cwd),
    prompt: text(raw.prompt),
    tool_name: text(raw.tool_name),
    tool_input: raw.tool_input,
    tool_use_id: text(raw.tool_use_id),
    message: text(raw.message),
    notification_type: text(raw.notification_type),
  }
}

export function startListener({ secret, onEvent, log = (message) => console.warn(`[outside] ${message}`) }: { secret: string; onEvent(event: HookEvent): void; log?: (message: string) => void }): Promise<Listener> {
  const server = createServer((request, response) => {
    const reply = (status: number) => {
      request.resume()
      response.writeHead(status).end()
    }
    const hosts = loopbackHosts((server.address() as AddressInfo).port)
    const origin = request.headers.origin
    if (!hosts.includes(request.headers.host ?? '') || (origin !== undefined && !hosts.some((host) => origin === `http://${host}`))) return reply(403)
    if (request.method !== 'POST' || request.url !== '/hook') return reply(404)
    if (!sameSecret(request.headers[secretHeader.toLowerCase()], secret)) return reply(401)
    if (Number(request.headers['content-length'] ?? 0) > maxBody) return reply(413)
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= maxBody) chunks.push(chunk)
    })
    request.on('end', () => {
      if (size > maxBody) return reply(413)
      const event = parseEvent(Buffer.concat(chunks).toString('utf8'))
      reply(event ? 204 : 400)
      if (!event) return
      try {
        onEvent(event)
      } catch (error) {
        log(`couldn’t apply a ${event.hook_event_name} event: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections()
            server.close(() => done())
          }),
      }),
    )
  })
}
