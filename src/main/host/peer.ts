import type { Socket } from 'node:net'

type Frame = { id: number; call: string; args: unknown[] } | { id: number; result?: unknown; error?: string } | { event: string; payload: unknown }

export interface PeerHandlers {
  call(name: string, args: unknown[]): unknown
  event?(name: string, payload: unknown): void
}

export type Peer = ReturnType<typeof createPeer>

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createPeer(socket: Socket, handlers: PeerHandlers) {
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  let buffer = ''
  let nextId = 0

  const write = (frame: Frame) => {
    if (socket.writable) socket.write(`${JSON.stringify(frame)}\n`)
  }

  const receive = (frame: Frame) => {
    if ('event' in frame) return handlers.event?.(frame.event, frame.payload)
    if ('call' in frame) {
      const { id, call, args } = frame
      return void Promise.resolve()
        .then(() => handlers.call(call, Array.isArray(args) ? args : []))
        .then(
          (result) => write({ id, result }),
          (error: unknown) => write({ id, error: errorText(error) }),
        )
    }
    const pending = waiting.get(frame.id)
    waiting.delete(frame.id)
    if (frame.error !== undefined) pending?.reject(new Error(frame.error))
    else pending?.resolve(frame.result)
  }

  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    const lines = (buffer + chunk).split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      try {
        receive(JSON.parse(line) as Frame)
      } catch {
        socket.destroy()
        return
      }
    }
  })
  socket.on('error', () => {})
  socket.on('close', () => {
    for (const pending of waiting.values()) pending.reject(new Error('Lost the connection to the agent host'))
    waiting.clear()
  })

  return {
    socket,
    call(name: string, args: unknown[] = []): Promise<unknown> {
      if (!socket.writable) return Promise.reject(new Error('Lost the connection to the agent host'))
      const id = ++nextId
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject })
        write({ id, call: name, args })
      })
    },
    emit(name: string, payload: unknown): void {
      write({ event: name, payload: payload ?? null })
    },
  }
}
