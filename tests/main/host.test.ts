import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatPatchBatch, ChatSnapshot } from '../../src/shared/chat'
import { connectHost, type HostClient } from '../../src/main/host/client'
import { whenIdle } from '../../src/main/host/idle'
import { hostBuild, hostSecret, socketPath } from '../../src/main/host/identity'
import { createPeer } from '../../src/main/host/peer'
import { createHostServer, type HostServer, type Welcome } from '../../src/main/host/server'
import { remoteUi } from '../../src/main/host/ui'
import { wireChats } from '../../src/main/store/ipc-sync'
import type { Visitors } from '../../src/main/outside/visitors'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let office: ReturnType<typeof openOffice>
const servers: HostServer[] = []
const clients: HostClient[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-host-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  office = openOffice(dir)
})

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close())
  await Promise.all(servers.splice(0).map((server) => server.close()))
  office.store.shutdown()
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

const noVisitors = { snapshot: () => [], has: () => false, open: () => {} } as unknown as Visitors

async function startHost(build = 'build-a') {
  const server = createHostServer(hostSecret(dir), build)
  servers.push(server)
  const sync = wireChats(server, office.store, noVisitors)
  server.handle('startChat', (prompt: string) => office.start(prompt))
  server.handle('busy', office.store.busy)
  const ui = remoteUi(server)
  ui.onChange((state) => sync.setVisible(state.visible))
  await server.listen(socketPath(dir))
  return server
}

function client(options: { secret?: string; spawn?: () => void } = {}) {
  const batches: ChatPatchBatch[] = []
  const welcomes: (Welcome | undefined)[] = []
  const host = connectHost({
    path: socketPath(dir),
    secret: options.secret ?? hostSecret(dir),
    spawn: options.spawn ?? (() => {}),
    status: (welcome) => welcomes.push(welcome),
    event: (name, payload) => name === 'chatPatches' && batches.push(payload as ChatPatchBatch),
    call: (name) => name === 'confirm',
    maxDelayMs: 20,
    spawnGapMs: 0,
  })
  clients.push(host)
  return { host, batches, welcomes }
}

describe('agent host protocol', () => {
  it('keeps the socket and secret private to the user', async () => {
    await startHost()
    expect(statSync(socketPath(dir)).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, 'host.secret')).mode & 0o777).toBe(0o600)
    expect(hostSecret(dir)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a wrong secret and any command sent before hello', async () => {
    await startHost()
    const refused = await new Promise<string>((resolve) => {
      const socket = connect(socketPath(dir), () => {
        const peer = createPeer(socket, { call: () => undefined })
        peer.call('hello', ['not-the-secret']).catch((error: Error) => resolve(error.message))
      })
    })
    expect(refused).toMatch(/refused/)

    const early = await new Promise<{ error: string; closed: boolean }>((resolve) => {
      const socket = connect(socketPath(dir), () => {
        const peer = createPeer(socket, { call: () => undefined })
        peer.call('busy').catch((error: Error) => socket.once('close', () => resolve({ error: error.message, closed: true })))
      })
    })
    expect(early).toEqual({ error: 'The agent host refused this connection', closed: true })
    expect(servers[0]!.clients()).toBe(0)
  })

  it('round-trips commands, errors and the host asking the UI to confirm', async () => {
    const server = await startHost('build-a')
    server.handle('fails', () => {
      throw new Error('nope')
    })
    const { host, welcomes } = client()
    expect(await host.call('startChat', ['Round trip'])).toMatch(/[0-9a-f-]{36}/)
    await expect(host.call('fails')).rejects.toThrow('nope')
    await expect(host.call('missing')).rejects.toThrow('no command missing')
    expect(welcomes).toEqual([{ build: 'build-a', pid: process.pid }])
    expect(await remoteUi(server).confirm('Move?', 'detail')).toBe(true)
  })

  it('delivers a reply the window forwards without attachments', async () => {
    await startHost()
    const { host } = client()
    const chatId = (await host.call('startChat', ['First'])) as string
    office.finish(chatId)
    expect(await host.call('sendMessage', [chatId, 'Follow up', undefined])).toBeUndefined()
    expect(office.engine.sent.at(-1)).toEqual({ chatId, text: 'Follow up' })
    expect(office.chat(chatId).rows.at(-1)).toMatchObject({ kind: 'user', text: 'Follow up' })
  })

  it('gives a reconnecting UI a full snapshot, then patches', async () => {
    await startHost()
    const first = client()
    const chatId = (await first.host.call('startChat', ['Before the restart [hang]'])) as string
    await first.host.call('uiState', [{ visible: true, focused: true }])
    first.host.close()
    await vi.waitFor(() => expect(servers[0]!.clients()).toBe(0))

    office.engine.init(chatId)
    const second = client()
    const snapshot = (await second.host.call('getSnapshot')) as ChatSnapshot
    expect(snapshot.chats.find((chat) => chat.id === chatId)?.state).toBe('working')
    await second.host.call('uiState', [{ visible: true, focused: true }])
    office.finish(chatId)
    await vi.waitFor(() => expect(second.batches.some((batch) => batch.seq > snapshot.seq && batch.patches.some((patch) => patch.id === chatId && patch.fields?.state === 'done'))).toBe(true))
  })

  it('reconnects with backoff after the host goes away, spawning a new one', async () => {
    const server = await startHost('build-a')
    let spawned = false
    const spawn = vi.fn(() => {
      if (!spawned) void startHost('build-b')
      spawned = true
    })
    const { host, welcomes } = client({ spawn })
    await vi.waitFor(() => expect(welcomes).toHaveLength(1))
    await server.close()
    servers.splice(servers.indexOf(server), 1)
    await vi.waitFor(() => expect(welcomes.at(-1)?.build).toBe('build-b'))
    expect(welcomes.map((welcome) => welcome?.build)).toEqual(['build-a', undefined, 'build-b'])
    expect(spawn).toHaveBeenCalled()
    expect(await host.call('busy')).toBe(false)
  })

  it('keeps a chat working when the UI disconnects', async () => {
    await startHost()
    const { host } = client()
    const chatId = (await host.call('startChat', ['Keep going [hang]'])) as string
    office.engine.init(chatId)
    host.close()
    await vi.waitFor(() => expect(servers[0]!.clients()).toBe(0))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(office.chat(chatId).state).toBe('working')
    expect(office.chat(chatId).stuck).toBeUndefined()
    expect(office.engine.running(chatId)).toBe(true)
  })
})

describe('host restart', () => {
  it('waits until no office chat is starting, working or waiting', () => {
    const fire = vi.fn()
    const chatId = office.start('Busy [hang]')
    whenIdle(office.store, fire)
    expect(fire).not.toHaveBeenCalled()
    office.finish(chatId)
    expect(fire).toHaveBeenCalledTimes(1)
    office.store.markRead(chatId)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('fires at once when nothing is running, and can be cancelled', () => {
    const fire = vi.fn()
    whenIdle(office.store, fire)
    expect(fire).toHaveBeenCalledTimes(1)
    const later = vi.fn()
    const chatId = office.start('Busy')
    whenIdle(office.store, later)()
    office.finish(chatId)
    expect(later).not.toHaveBeenCalled()
  })

  it('compares the host bundle by content', () => {
    expect(hostBuild(dir)).toBe('unknown')
    writeFileSync(join(dir, 'host.js'), 'require("./chunks/core-A1.js")')
    const a = hostBuild(dir)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(hostBuild(dir)).toBe(a)
    writeFileSync(join(dir, 'host.js'), 'require("./chunks/core-B2.js")')
    expect(hostBuild(dir)).not.toBe(a)
  })
})
