import { connect } from 'node:net'
import { createPeer, type Peer, type PeerHandlers } from './peer'
import type { Welcome } from './server'

export interface ClientOptions extends PeerHandlers {
  path: string
  secret: string
  spawn(): void
  status(welcome: Welcome | undefined): void
  spawnGapMs?: number
  maxDelayMs?: number
}

export type HostClient = ReturnType<typeof connectHost>

export function connectHost({ path, secret, spawn, status, spawnGapMs = 5000, maxDelayMs = 2000, ...handlers }: ClientOptions) {
  let open: (peer: Peer) => void = () => {}
  let ready = new Promise<Peer>((resolve) => (open = resolve))
  let connected = false
  let closed = false
  let delay = 50
  let lastSpawn = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const retry = () => {
    if (closed) return
    timer = setTimeout(attempt, delay)
    delay = Math.min(delay * 2, maxDelayMs)
  }

  function attempt() {
    const socket = connect(path)
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if ((error.code === 'ENOENT' || error.code === 'ECONNREFUSED') && Date.now() - lastSpawn > spawnGapMs) {
        lastSpawn = Date.now()
        spawn()
      }
    })
    socket.once('connect', () => {
      const peer = createPeer(socket, handlers)
      peer.call('hello', [secret]).then(
        (welcome) => {
          connected = true
          delay = 50
          open(peer)
          status(welcome as Welcome)
        },
        () => socket.destroy(),
      )
    })
    socket.once('close', () => {
      if (connected) {
        connected = false
        ready = new Promise<Peer>((resolve) => (open = resolve))
        status(undefined)
      }
      retry()
    })
  }

  attempt()

  return {
    connected: () => connected,
    call: async (name: string, args: unknown[] = []) => (await ready).call(name, args),
    close() {
      closed = true
      clearTimeout(timer)
      void ready.then((peer) => peer.socket.destroy())
    },
  }
}
