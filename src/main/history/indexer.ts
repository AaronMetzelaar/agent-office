import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import Database from 'better-sqlite3'
import { isSessionId } from '../outside/listener'
import { isTurn, promptText, textOf, titleOf, type Entry } from '../outside/transcripts'

export interface IndexHit {
  sessionId: string
  title: string
  cwd: string
  at: number
  snippet: [string, string, string]
}

interface FileRow {
  id: number
  offset: number
  title: string | null
  cwd: string | null
  at: number
}

interface MatchRow {
  session_id: string
  path: string
  title: string | null
  cwd: string | null
  at: number
  offset: number
  length: number
}

const schema = `
create table if not exists files (id integer primary key, path text unique not null, session_id text not null, offset integer not null default 0, title text, cwd text, at integer not null default 0);
create table if not exists docs (id integer primary key, file_id integer not null, offset integer not null, length integer not null);
create index if not exists docs_file on docs(file_id);
create virtual table if not exists terms using fts5(body, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');
`
const chunk = 4 * 1024 * 1024
const longestLine = 512 * 1024
const word = /[\p{L}\p{N}]/u

export function ftsQuery(text: string): string | undefined {
  const terms = text.match(/[\p{L}\p{N}]+/gu)
  return terms?.map((term, index) => `"${term}"${index === terms.length - 1 ? '*' : ''}`).join(' ')
}

function bodyOf(entry: Entry): string | undefined {
  if (!isTurn(entry)) return undefined
  return entry.type === 'user' ? promptText(entry) : textOf(entry.message?.content).trim() || undefined
}

export function snippetOf(text: string, terms: readonly string[]): [string, string, string] {
  const flat = text.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()
  let at = -1
  let length = 0
  for (const term of terms) {
    const index = lower.indexOf(term.toLowerCase())
    if (index !== -1 && (at === -1 || index < at)) [at, length] = [index, term.length]
  }
  if (at === -1) return [flat.slice(0, 150) + (flat.length > 150 ? '…' : ''), '', '']
  while (at + length < flat.length && word.test(flat[at + length]!)) length++
  const space = flat.indexOf(' ', Math.max(0, at - 50))
  const start = at > 50 && space !== -1 && space < at ? space + 1 : 0
  const end = at + length + 110
  return [(start ? '…' : '') + flat.slice(start, at), flat.slice(at, at + length), flat.slice(at + length, end) + (end < flat.length ? '…' : '')]
}

function readAt(path: string, offset: number, length: number): string | undefined {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(length)
    return buffer.toString('utf8', 0, readSync(fd, buffer, 0, length, offset))
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

const folders = (dir: string) => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

export function transcriptFiles(projectsDir: string): { path: string; sessionId: string }[] {
  return folders(projectsDir).flatMap((folder) =>
    folders(join(projectsDir, folder)).flatMap((name) => {
      const sessionId = name.replace(/\.jsonl$/, '')
      return name.endsWith('.jsonl') && isSessionId(sessionId) ? [{ path: join(projectsDir, folder, name), sessionId }] : []
    }),
  )
}

export type Index = ReturnType<typeof openIndex>

export function openIndex(file: string, projectsDir: string, log: (message: string) => void = (message) => console.warn(`[search] ${message}`)) {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec(schema)
  const fileRow = db.prepare('select id, offset, title, cwd, at from files where path = ?')
  const addFile = db.prepare('insert into files (path, session_id) values (?, ?)')
  const saveFile = db.prepare('update files set offset = ?, title = ?, cwd = ?, at = ? where id = ?')
  const addDoc = db.prepare('insert into docs (file_id, offset, length) values (?, ?, ?)')
  const addTerms = db.prepare('insert into terms (rowid, body) values (?, ?)')
  const dropTerms = db.prepare('delete from terms where rowid in (select id from docs where file_id = ?)')
  const dropDocs = db.prepare('delete from docs where file_id = ?')
  const dropFile = db.prepare('delete from files where id = ?')
  const allFiles = db.prepare('select id, path from files')
  const match = db.prepare(`
    select f.session_id, f.path, f.title, f.cwd, f.at, d.offset, d.length
    from terms join docs d on d.id = terms.rowid join files f on f.id = d.file_id
    where terms match ? order by bm25(terms) limit 500`)

  const clear = (id: number) => {
    dropTerms.run(id)
    dropDocs.run(id)
  }

  const indexFile = db.transaction((path: string, sessionId: string, size: number): number => {
    let row = fileRow.get(path) as FileRow | undefined
    if (!row) row = { id: Number(addFile.run(path, sessionId).lastInsertRowid), offset: 0, title: null, cwd: null, at: 0 }
    if (size < row.offset) {
      clear(row.id)
      Object.assign(row, { offset: 0, title: null, cwd: null })
    }
    if (size === row.offset) return 0
    let { title, cwd, at } = row
    let added = 0
    let malformed = 0
    const take = (line: Buffer, offset: number) => {
      if (!line.length || line.length > longestLine) return
      let entry: Entry
      try {
        entry = JSON.parse(line.toString('utf8'))
        if (!entry || typeof entry !== 'object') throw new Error('not an object')
      } catch {
        malformed++
        return
      }
      if (!cwd && typeof entry.cwd === 'string') cwd = entry.cwd
      at = Date.parse(entry.timestamp ?? '') || at
      const body = bodyOf(entry)
      if (!body) return
      if (!title && entry.type === 'user') title = titleOf(body)
      addTerms.run(addDoc.run(row.id, offset, line.length).lastInsertRowid, body)
      added++
    }
    const fd = openSync(path, 'r')
    let lineStart = row.offset
    try {
      const buffer = Buffer.alloc(chunk)
      let parts: Buffer[] = []
      for (let pos = row.offset; pos < size; ) {
        const read = readSync(fd, buffer, 0, Math.min(chunk, size - pos), pos)
        if (read <= 0) break
        const view = buffer.subarray(0, read)
        let from = 0
        for (let end = view.indexOf(10); end !== -1; end = view.indexOf(10, from)) {
          parts.push(view.subarray(from, end))
          take(parts.length === 1 ? parts[0]! : Buffer.concat(parts), lineStart)
          parts = []
          lineStart = pos + end + 1
          from = end + 1
        }
        if (from < read) parts.push(Buffer.from(view.subarray(from)))
        pos += read
      }
    } finally {
      closeSync(fd)
    }
    saveFile.run(lineStart, title, cwd, at, row.id)
    if (malformed) log(`skipped ${malformed} malformed line${malformed === 1 ? '' : 's'} in ${basename(path)}`)
    return added
  })

  return {
    async update(): Promise<number> {
      const files = transcriptFiles(projectsDir)
      const seen = new Set(files.map((entry) => entry.path))
      for (const stale of allFiles.all() as { id: number; path: string }[]) {
        if (seen.has(stale.path)) continue
        clear(stale.id)
        dropFile.run(stale.id)
      }
      let added = 0
      for (const { path, sessionId } of files) {
        const size = statSync(path, { throwIfNoEntry: false })?.size
        if (size === undefined) continue
        try {
          added += indexFile(path, sessionId, size)
        } catch (error) {
          log(`couldn’t index ${basename(path)}: ${error instanceof Error ? error.message : String(error)}`)
        }
        await new Promise((resolve) => setImmediate(resolve))
      }
      return added
    },

    search(text: string, limit = 20): IndexHit[] {
      const query = typeof text === 'string' ? ftsQuery(text) : undefined
      if (!query) return []
      const terms = text.match(/[\p{L}\p{N}]+/gu) ?? []
      const best = new Map<string, MatchRow>()
      for (const row of match.all(query) as MatchRow[]) if (!best.has(row.session_id)) best.set(row.session_id, row)
      return [...best.values()].slice(0, limit).flatMap((row) => {
        const line = readAt(row.path, row.offset, row.length)
        let body: string | undefined
        try {
          body = line ? bodyOf(JSON.parse(line)) : undefined
        } catch {
          body = undefined
        }
        return body ? [{ sessionId: row.session_id, title: row.title ?? 'Untitled chat', cwd: row.cwd ?? '', at: row.at, snippet: snippetOf(body, terms) }] : []
      })
    },

    close: () => db.close(),
  }
}
