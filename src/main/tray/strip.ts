import type { ChatFields, LoginItem } from '../../shared/chat'
import { parkAfterMs } from '../../shared/office'
import { buildQueue } from '../../shared/queue'

export type Dot = 'working' | 'done'

export interface StripState {
  needs: number
  dots: Dot[]
}

export const maxDots = 8

export function stripState(chats: readonly Readonly<ChatFields>[], logins: readonly LoginItem[], now: number): StripState {
  const live = chats.filter((chat) => !chat.archived)
  const queue = buildQueue(
    live.map((chat) => ({ id: chat.id, accountId: chat.accountId, state: chat.state, since: chat.oldestPendingAt ?? chat.stateSince, stuckReason: chat.stuck?.reason })),
    logins,
  )
  const working = live.filter((chat) => chat.state === 'working' || chat.state === 'starting').map((): Dot => 'working')
  const done = live.filter((chat) => chat.state === 'done' && now - chat.lastActivityAt < parkAfterMs).map((): Dot => 'done')
  return { needs: queue.length, dots: [...working, ...done].slice(0, maxDots) }
}

export function stripBitmap({ needs, dots }: StripState): { pixels: Buffer; width: number; height: number } {
  const height = 32
  const columns = Math.ceil(dots.length / 2)
  const width = 32 + (columns ? 4 + columns * 11 : 0)
  const pixels = Buffer.alloc(width * height * 4)
  const disc = (cx: number, cy: number, radius: number, stroke?: number) => {
    for (let y = Math.floor(cy - radius - 2); y <= Math.ceil(cy + radius + 2); y++) {
      for (let x = Math.floor(cx - radius - 2); x <= Math.ceil(cx + radius + 2); x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        const edge = stroke === undefined ? radius - distance : stroke / 2 - Math.abs(distance - radius)
        const alpha = Math.round(Math.min(1, Math.max(0, edge + 0.5)) * 255)
        const at = (y * width + x) * 4 + 3
        pixels[at] = Math.max(pixels[at]!, alpha)
      }
    }
  }
  if (needs > 0) disc(16, 16, 12.5)
  else disc(16, 16, 10.24, 4.48)
  dots.forEach((dot, index) => {
    const cx = 36 + Math.floor(index / 2) * 11 + 4.5
    const cy = index % 2 ? 22 : 10
    if (dot === 'working') disc(cx, cy, 4)
    else disc(cx, cy, 3.4, 1.8)
  })
  return { pixels, width, height }
}
