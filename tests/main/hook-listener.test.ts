import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { connect } from 'node:net'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { doingNow, type ChatPatch } from '../../src/shared/chat'
import { createRooms } from '../../src/main/departments/rooms'
import { createDesktopMeta } from '../../src/main/outside/desktop-meta'
import { install, scriptPath, writeEndpoint } from '../../src/main/outside/installer'
import { secretHeader, startListener, type Listener } from '../../src/main/outside/listener'
import { createDiscovery } from '../../src/main/outside/transcripts'
import { createVisitors, type Visitors } from '../../src/main/outside/visitors'
import { configOf } from '../fakes/office'
import { line, writeTranscript } from '../fakes/outside'

const secret = 'b'.repeat(64)
const lan = Object.values(networkInterfaces())
  .flat()
  .find((address) => address?.family === 'IPv4' && !address.internal)?.address

let root: string
let cwd: string
let outsideId: string
let office: Set<string>
let logs: string[]
let patches: ChatPatch[]
let visitors: Visitors
let listener: Listener

function memorySettings() {
  const values = new Map<string, unknown>()
  return { setting: (key: string) => values.get(key), saveSetting: (key: string, value: unknown) => void values.set(key, value) }
}

function post(body: unknown, headers: Record<string, string | undefined> = {}): Promise<number> {
  const all: Record<string, string> = {}
  for (const [key, value] of Object.entries({ 'content-type': 'application/json', [secretHeader]: secret, ...headers })) if (value !== undefined) all[key] = value
  return new Promise((resolve, reject) => {
    let answered = false
    const req = request({ host: '127.0.0.1', port: listener.port, path: '/hook', method: 'POST', headers: all }, (response) => {
      answered = true
      response.resume()
      resolve(response.statusCode!)
    })
    req.on('error', (error) => answered || reject(error))
    req.end(typeof body === 'string' ? body : JSON.stringify(body))
  })
}

const event = (hook_event_name: string, fields: Record<string, unknown> = {}, session_id = outsideId) => ({ session_id, hook_event_name, cwd, transcript_path: '/ignored', ...fields })

function runHook(path: string, input: string): Promise<{ code: number | null; stdout: string; ms: number }> {
  const started = Date.now()
  return new Promise((resolve) => {
    const child = spawn(path, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.on('close', (code) => resolve({ code, stdout, ms: Date.now() - started }))
    child.stdin.end(input)
  })
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'agent-office-hooks-'))
  cwd = join(root, 'repo')
  mkdirSync(cwd)
  const claudeDir = join(root, 'claude')
  outsideId = randomUUID()
  writeTranscript(claudeDir, outsideId, [line.user('Fix the bid rounding'), line.text('On it.')], { cwd, entrypoint: 'cli', at: Date.now() - 60 * 60_000 })
  office = new Set()
  logs = []
  patches = []
  const discovery = createDiscovery({ projectsDir: join(claudeDir, 'projects'), desktop: createDesktopMeta(join(root, 'desktop')).read })
  const settings = memorySettings()
  visitors = createVisitors({
    patch: (patch) => patches.push(patch),
    accounts: () => [{ id: 'main', label: 'main' }],
    instances: () => [],
    rooms: createRooms(settings, configOf(), () => []),
    officeSessions: () => office,
    describe: (id) => discovery.describe(id, Date.now()),
    settings,
    log: (message) => logs.push(message),
  })
  listener = await startListener({ secret, onEvent: visitors.hook, log: (message) => logs.push(message) })
})

afterEach(async () => {
  await listener.close()
  rmSync(root, { recursive: true, force: true })
})

describe('hook listener', () => {
  it('shows an outside chat Working, then Needs you (read-only), then Done', async () => {
    expect(await post(event('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'pnpm test' }, tool_use_id: 'toolu_1' }))).toBe(204)
    expect(visitors.view(outsideId)).toMatchObject({ visitor: 'terminal', accountId: 'unknown', title: 'Fix the bid rounding', state: 'working', activity: 'Running pnpm test' })

    expect(await post(event('Notification', { message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' }))).toBe(204)
    const waiting = visitors.view(outsideId)!
    expect(waiting).toMatchObject({ state: 'needs-you', pending: [{ id: 'toolu_1', toolName: 'Bash' }], pendingRequests: [] })
    expect(doingNow(waiting, Date.now())).toBe('Waiting for you · Bash')

    expect(await post(event('PostToolUse', { tool_name: 'Bash', tool_response: { stdout: 'ok' } }))).toBe(204)
    expect(visitors.view(outsideId)?.state).toBe('working')

    expect(await post(event('Stop'))).toBe(204)
    expect(visitors.view(outsideId)).toMatchObject({ state: 'done', unread: true, pending: [] })
  })

  it('ignores events for a session the office hosts, with no duplicate character', async () => {
    const officeId = randomUUID()
    office.add(officeId)
    writeTranscript(join(root, 'claude'), officeId, [line.user('Office chat')], { cwd })
    expect(await post(event('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'a.ts' } }, officeId))).toBe(204)
    expect(visitors.views()).toEqual([])
    expect(patches.filter((patch) => patch.id === officeId)).toEqual([])
  })

  it('drops and logs an event for a session with no transcript', async () => {
    const stranger = randomUUID()
    expect(await post(event('Stop', {}, stranger))).toBe(204)
    expect(visitors.view(stranger)).toBeUndefined()
    expect(logs.join('\n')).toContain(`session ${stranger} has no outside transcript`)
  })

  it('rejects a request without the secret or with the wrong one', async () => {
    expect(await post(event('Stop'), { [secretHeader]: undefined })).toBe(401)
    expect(await post(event('Stop'), { [secretHeader]: 'c'.repeat(64) })).toBe(401)
    expect(visitors.views()).toEqual([])
  })

  it('answers 403 to a non-loopback Host or Origin, the DNS-rebinding defence', async () => {
    expect(await post(event('Stop'), { host: `evil.example:${listener.port}` })).toBe(403)
    expect(await post(event('Stop'), { origin: 'http://evil.example' })).toBe(403)
    expect(visitors.views()).toEqual([])
    expect(await post(event('Stop'), { origin: `http://127.0.0.1:${listener.port}` })).toBe(204)
  })

  it('answers 413 to an oversized body and 400 to a malformed event', async () => {
    expect(await post(JSON.stringify({ ...event('PreToolUse'), tool_input: { content: 'x'.repeat(2 * 1024 * 1024) } }))).toBe(413)
    expect(await post('not json')).toBe(400)
    expect(await post(event('Stop', {}, '../../etc/passwd'))).toBe(400)
    expect(await post(event('Explode'))).toBe(400)
    expect(visitors.views()).toEqual([])
  })

  it.skipIf(!lan)('doesn’t accept connections on the LAN interface', async () => {
    const outcome = await new Promise<string>((resolve) => {
      const socket = connect({ host: lan!, port: listener.port }, () => {
        socket.destroy()
        resolve('connected')
      })
      socket.setTimeout(1500, () => {
        socket.destroy()
        resolve('no answer')
      })
      socket.on('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'))
    })
    expect(outcome).not.toBe('connected')
  })
})

describe('hook script', () => {
  const hookPaths = () => ({ settings: join(root, 'claude', 'settings.json'), dir: join(root, 'config') })

  it('delivers the event through curl while the office runs, and prints nothing', async () => {
    const paths = hookPaths()
    install(paths)
    writeEndpoint(paths.dir, listener.port, secret)
    const result = await runHook(scriptPath(paths.dir), JSON.stringify(event('UserPromptSubmit', { prompt: 'Add a test' })))
    expect(result).toMatchObject({ code: 0, stdout: '' })
    expect(visitors.view(outsideId)).toMatchObject({ state: 'working', activity: 'Thinking' })
  })

  it('exits at once, quietly and successfully, when the office isn’t running', async () => {
    const paths = hookPaths()
    install(paths)
    const input = JSON.stringify(event('Stop'))
    expect(await runHook(scriptPath(paths.dir), input)).toMatchObject({ code: 0, stdout: '' })

    const closed = listener.port
    await listener.close()
    writeEndpoint(paths.dir, closed, secret)
    const result = await runHook(scriptPath(paths.dir), input)
    expect(result).toMatchObject({ code: 0, stdout: '' })
    expect(result.ms).toBeLessThan(1500)
    listener = await startListener({ secret, onEvent: visitors.hook })
  })
})
