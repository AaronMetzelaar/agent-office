import { randomUUID } from 'node:crypto'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Line = Record<string, unknown>

export const line = {
  user: (text: string, fields: Line = {}): Line => ({ type: 'user', message: { role: 'user', content: text }, ...fields }),
  text: (text: string, stop = 'end_turn'): Line => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: stop } }),
  tool: (name: string, input: Line, id = `toolu_${randomUUID()}`): Line => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' } }),
  result: (id: string): Line => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }),
}

export interface TranscriptOptions {
  cwd: string
  entrypoint?: string
  project?: string
  at?: number
}

export function writeTranscript(claudeDir: string, sessionId: string, lines: Line[], { cwd, entrypoint = 'claude-desktop', project = cwd.replace(/[^\w]/g, '-'), at = Date.now() }: TranscriptOptions): string {
  const dir = join(claudeDir, 'projects', project)
  mkdirSync(dir, { recursive: true })
  let parentUuid: string | null = null
  const body = lines.map((fields, index) => {
    const uuid = randomUUID()
    const entry = { parentUuid, isSidechain: false, uuid, timestamp: new Date(at - (lines.length - index) * 1000).toISOString(), sessionId, cwd, entrypoint, version: '2.1.280', ...fields }
    if (fields.message) parentUuid = uuid
    return JSON.stringify(entry)
  })
  const path = join(dir, `${sessionId}.jsonl`)
  writeFileSync(path, `${body.join('\n')}\n`)
  utimesSync(path, new Date(at), new Date(at))
  return path
}

export function writeDesktopChat(desktopDir: string, instance: string, fields: Line): string {
  const dir = join(desktopDir, instance, 'claude-code-sessions', randomUUID(), randomUUID())
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `local_${randomUUID()}.json`)
  writeFileSync(path, JSON.stringify({ sessionId: `local_${randomUUID()}`, model: 'opus', permissionMode: 'auto', isArchived: false, createdAt: Date.now(), ...fields }))
  return path
}
