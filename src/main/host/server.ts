import { EventEmitter } from 'node:events'
import { chmodSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { sameSecret } from './identity'
import { createPeer, type Peer } from './peer'

export interface Welcome {
  build: string
  pid: number
}

export type HostServer = ReturnType<typeof createHostServer>

export function createHostServer(secret: string, build: string) {
  const commands = new Map<string, (...args: never[]) => unknown>()
  const clients: Peer[] = []
  const events = new EventEmitter<{ connect: [Peer]; disconnect: [Peer] }>()

  const server = createServer((socket) => {
    let peer: Peer | undefined
    const connection = createPeer(socket, {
      call(name, args) {
        if (peer) {
          const command = commands.get(name)
          if (!command) throw new Error(`The agent host has no command ${name}`)
          return Reflect.apply(command, undefined, args)
        }
        if (name !== 'hello' || !sameSecret(secret, args[0])) {
          setImmediate(() => socket.destroy())
          throw new Error('The agent host refused this connection')
        }
        peer = connection
        clients.push(peer)
        setImmediate(() => events.emit('connect', connection))
        return { build, pid: process.pid } satisfies Welcome
      },
    })
    socket.on('close', () => {
      const index = peer ? clients.indexOf(peer) : -1
      if (index === -1) return
      clients.splice(index, 1)
      events.emit('disconnect', connection)
    })
  })

  return {
    events,
    clients: () => clients.length,
    handle(name: string, command: (...args: never[]) => unknown): void {
      commands.set(name, command)
    },
    send(name: string, payload: unknown): void {
      for (const client of clients) client.emit(name, payload)
    },
    ask(name: string, args: unknown[]): Promise<unknown> {
      const latest = clients.at(-1)
      return latest ? latest.call(name, args) : Promise.resolve(undefined)
    },
    listen(path: string): Promise<void> {
      rmSync(path, { force: true })
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(path, () => {
          chmodSync(path, 0o600)
          resolve()
        })
      })
    },
    close(): Promise<void> {
      for (const client of clients) client.socket.destroy()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}
