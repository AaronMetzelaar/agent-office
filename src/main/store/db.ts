import Database from 'better-sqlite3'
import { safeStorage } from 'electron'
import type { ChatState, Effort, Stuck, Usage } from '../../shared/chat'
import type { AccountHealth } from '../../shared/ipc'

export interface ChatRecord {
  id: string
  sessionId?: string
  accountId: string
  cwd: string
  worktree?: string
  title: string
  colour?: string
  department?: string
  model?: string
  effort?: Effort
  state: ChatState
  stuck?: Stuck
  archived: boolean
  unread: boolean
  createdAt: number
  lastActivityAt: number
  doneAt?: number
  readAt?: number
  usage: Usage
}

type Row = Record<string, string | number | null>

const schema = `
create table if not exists chats (
  id text primary key,
  session_id text,
  account_id text not null,
  cwd text not null,
  worktree text,
  title text not null,
  colour text,
  department text,
  model text,
  effort text,
  state text not null,
  stuck text,
  archived integer not null default 0,
  unread integer not null default 0,
  created_at integer not null,
  last_activity_at integer not null,
  done_at integer,
  read_at integer,
  usage text not null
);
create table if not exists drafts (chat_id text primary key, body blob not null, updated_at integer not null);
create table if not exists account_health (account_id text primary key, health text not null);
create table if not exists settings (key text primary key, value text not null);
`

const columns: [keyof ChatRecord, string][] = [
  ['id', 'id'],
  ['sessionId', 'session_id'],
  ['accountId', 'account_id'],
  ['cwd', 'cwd'],
  ['worktree', 'worktree'],
  ['title', 'title'],
  ['colour', 'colour'],
  ['department', 'department'],
  ['model', 'model'],
  ['effort', 'effort'],
  ['state', 'state'],
  ['stuck', 'stuck'],
  ['archived', 'archived'],
  ['unread', 'unread'],
  ['createdAt', 'created_at'],
  ['lastActivityAt', 'last_activity_at'],
  ['doneAt', 'done_at'],
  ['readAt', 'read_at'],
  ['usage', 'usage'],
]
const json = new Set<keyof ChatRecord>(['stuck', 'usage'])
const flags = new Set<keyof ChatRecord>(['archived', 'unread'])

function toRow(record: ChatRecord): Row {
  const row: Row = {}
  for (const [key, column] of columns) {
    const value = record[key]
    row[column] = value === undefined ? null : json.has(key) ? JSON.stringify(value) : flags.has(key) ? Number(value) : (value as string | number)
  }
  return row
}

function fromRow(row: Row): ChatRecord {
  const record: Record<string, unknown> = {}
  for (const [key, column] of columns) {
    const value = row[column]
    if (value === null || value === undefined) continue
    record[key] = json.has(key) ? JSON.parse(String(value)) : flags.has(key) ? value === 1 : value
  }
  return record as unknown as ChatRecord
}

export type Db = ReturnType<typeof openDb>

export function openDb(file: string) {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.exec(schema)
  const names = columns.map(([, column]) => column)
  const saveChat = db.prepare(`insert or replace into chats (${names.join(', ')}) values (${names.map((name) => `@${name}`).join(', ')})`)
  const listChats = db.prepare('select * from chats order by created_at')
  const saveDraft = db.prepare('insert or replace into drafts (chat_id, body, updated_at) values (?, ?, ?)')
  const readDraft = db.prepare('select body from drafts where chat_id = ?')
  const deleteDraft = db.prepare('delete from drafts where chat_id = ?')
  const saveHealth = db.prepare('insert or replace into account_health (account_id, health) values (?, ?)')
  const deleteHealth = db.prepare('delete from account_health where account_id = ?')
  const listHealth = db.prepare('select account_id, health from account_health')
  const readSetting = db.prepare('select value from settings where key = ?')
  const saveSetting = db.prepare('insert or replace into settings (key, value) values (?, ?)')

  return {
    sql: db,
    saveChat: (record: ChatRecord) => void saveChat.run(toRow(record)),
    listChats: () => (listChats.all() as Row[]).map(fromRow),
    saveDraft(chatId: string, text: string) {
      if (!text) return void deleteDraft.run(chatId)
      saveDraft.run(chatId, safeStorage.encryptString(text), Date.now())
    },
    draft(chatId: string): string | undefined {
      const row = readDraft.get(chatId) as { body: Buffer } | undefined
      return row ? safeStorage.decryptString(row.body) : undefined
    },
    saveHealth(accountId: string, health: AccountHealth | undefined) {
      if (health) saveHealth.run(accountId, JSON.stringify(health))
      else deleteHealth.run(accountId)
    },
    loadHealth: () => new Map((listHealth.all() as { account_id: string; health: string }[]).map((row) => [row.account_id, JSON.parse(row.health) as AccountHealth])),
    setting: (key: string): unknown => {
      const row = readSetting.get(key) as { value: string } | undefined
      return row ? JSON.parse(row.value) : undefined
    },
    saveSetting: (key: string, value: unknown) => void saveSetting.run(key, JSON.stringify(value)),
    close: () => db.close(),
  }
}
