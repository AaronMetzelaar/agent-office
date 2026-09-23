import type Database from 'better-sqlite3'
import type { ChatStore } from '../store/chats'

export type WaitKind = 'request' | 'reply'
export type WaitMetrics = ReturnType<typeof createWaitMetrics>

export function median(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2
}

export function createWaitMetrics(sql: Database.Database, chats: Pick<ChatStore, 'events'>) {
  sql.exec('create table if not exists waits (kind text not null, chat_id text not null, started_at integer not null, ended_at integer not null)')
  const insert = sql.prepare('insert into waits (kind, chat_id, started_at, ended_at) values (?, ?, ?, ?)')
  const durations = sql.prepare('select ended_at - started_at as ms from waits where kind = ? and ended_at >= ?')

  const record = (kind: WaitKind, chatId: string, startedAt: number, endedAt: number) => void insert.run(kind, chatId, startedAt, endedAt)
  chats.events.on('read', (chatId, doneAt, readAt) => record('reply', chatId, doneAt, readAt))

  return {
    record,
    median: (kind: WaitKind, since = 0) => median((durations.all(kind, since) as { ms: number }[]).map((row) => row.ms)),
  }
}
