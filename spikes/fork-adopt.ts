import { query } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadTokens, sessionEnv, scratchDir, inputQueue, describe, writeResult } from './lib.ts'

const env = sessionEnv(loadTokens().main)
const cwd = scratchDir()
const log: string[] = []
const SECRET = `pelican-${Math.floor(Math.random() * 9000 + 1000)}`

function openSession(name: string, extra: Record<string, unknown> = {}) {
  const input = inputQueue()
  const q = query({ prompt: input.iterable, options: { cwd, env, permissionMode: 'default', canUseTool: async () => ({ behavior: 'deny', message: 'no tools' }), ...extra } })
  let sessionId: string | undefined
  let lastText = ''
  const pending: { waiting: (() => void) | null } = { waiting: null }
  const done = (async () => {
    for await (const msg of q) {
      const m = msg as Record<string, any>
      log.push(`[${name}] ${describe(msg)}`)
      if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id
      if (m.type === 'assistant') lastText = (m.message?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') || lastText
      if (m.type === 'result') { const f = pending.waiting; pending.waiting = null; f?.() }
    }
  })()
  return {
    get id() { return sessionId },
    get text() { return lastText },
    say(text: string) { return new Promise<void>(r => { pending.waiting = r; input.push(text) }) },
    async close() { input.end(); await done }
  }
}

function transcriptPath(sessionId: string): string | undefined {
  const root = join(homedir(), '.claude', 'projects')
  for (const dir of readdirSync(root)) {
    const p = join(root, dir, `${sessionId}.jsonl`)
    if (existsSync(p)) return p
  }
}

function lineCount(sessionId?: string): number {
  const p = sessionId && transcriptPath(sessionId)
  return p ? readFileSync(p, 'utf8').split('\n').filter(Boolean).length : -1
}

const original = openSession('original')
await original.say(`Remember this secret word for later: ${SECRET}. Reply with just: noted.`)
const originalId = original.id!
const linesBeforeFork = lineCount(originalId)

const fork = openSession('fork', { resume: originalId, forkSession: true })
await fork.say('What was the secret word I gave you? Reply with just the word.')
const linesAfterFork = lineCount(originalId)

await original.say('Reply with just: still here.')
const linesAfterOriginalContinues = lineCount(originalId)

const plain = openSession('plain-resume', { resume: originalId })
let plainResumeError: string | undefined
try {
  await Promise.race([plain.say('Reply with just: second writer.'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 90_000))])
} catch (e) {
  plainResumeError = String(e)
}
const linesAfterPlainResume = lineCount(originalId)

await Promise.allSettled([fork.close(), original.close(), plain.close()])

const verdict = {
  forkGotNewSessionId: !!fork.id && fork.id !== originalId,
  forkRemembersContext: fork.text.toLowerCase().includes(SECRET),
  forkDidNotTouchOriginal: linesAfterFork === linesBeforeFork,
  originalKeptWorkingAfterFork: original.text.toLowerCase().includes('still here'),
  plainResumeWhileOpen: {
    sameSessionId: plain.id === originalId,
    error: plainResumeError ?? null,
    originalLinesGrewBy: linesAfterPlainResume - linesAfterOriginalContinues,
    note: 'A plain resume while the original is open writes to the same transcript if originalLinesGrewBy > 0 — the two-writer case adoption must avoid.'
  }
}
const file = writeResult('fork-adopt', { verdict, originalId, forkId: fork.id, plainId: plain.id, lines: { linesBeforeFork, linesAfterFork, linesAfterOriginalContinues, linesAfterPlainResume }, log, cwd })
console.log(JSON.stringify(verdict, null, 2))
console.log(`details: ${file}`)
