import { readFileSync, statSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

export const TOKEN_FILE = join(homedir(), '.config', 'agent-office', 'spike.env')

export function loadTokens(): { main: string; research: string } {
  let raw: string
  try {
    raw = readFileSync(TOKEN_FILE, 'utf8')
  } catch {
    throw new Error(`Missing ${TOKEN_FILE}. Add MAIN_TOKEN=... and RESEARCH_TOKEN=... lines (from \`claude setup-token\`).`)
  }
  const mode = statSync(TOKEN_FILE).mode & 0o777
  if (mode & 0o077) console.warn(`warning: ${TOKEN_FILE} is readable by others (mode ${mode.toString(8)}); run chmod 600`)
  const vars = Object.fromEntries(
    raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('='))
      .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')])
  )
  if (!vars.MAIN_TOKEN || !vars.RESEARCH_TOKEN) throw new Error(`${TOKEN_FILE} needs both MAIN_TOKEN and RESEARCH_TOKEN`)
  return { main: vars.MAIN_TOKEN, research: vars.RESEARCH_TOKEN }
}

export function sessionEnv(token: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env.ANTHROPIC_API_KEY
  delete env.CLAUDE_CONFIG_DIR
  env.CLAUDE_CODE_OAUTH_TOKEN = token
  return env
}

export function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'agent-office-spike-'))
}

export function userMessage(text: string): SDKUserMessage {
  return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null } as SDKUserMessage
}

export function inputQueue() {
  const pending: SDKUserMessage[] = []
  let wake: (() => void) | null = null
  let done = false
  const iterable: AsyncIterable<SDKUserMessage> = {
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (pending.length) { yield pending.shift()!; continue }
        if (done) return
        await new Promise<void>(r => { wake = r })
        wake = null
      }
    }
  }
  return {
    iterable,
    push(text: string) { pending.push(userMessage(text)); wake?.() },
    end() { done = true; wake?.() }
  }
}

export function describe(msg: SDKMessage): string {
  const m = msg as Record<string, any>
  if (m.type === 'assistant') {
    const blocks = (m.message?.content ?? []).map((b: any) =>
      b.type === 'text' ? `text:${JSON.stringify(String(b.text).slice(0, 80))}` : b.type === 'tool_use' ? `tool_use:${b.name}` : b.type)
    return `assistant ${blocks.join(' ')}${m.error ? ` error:${m.error}` : ''}`
  }
  if (m.type === 'result') return `result ${m.subtype} turns=${m.num_turns} cost=${m.total_cost_usd}`
  if (m.type === 'system') return `system ${m.subtype}${m.model ? ` model=${m.model}` : ''}`
  return m.type
}

export function writeResult(name: string, data: unknown): string {
  const dir = join(import.meta.dirname, 'results')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}.json`)
  writeFileSync(file, JSON.stringify(data, null, 2))
  return file
}

export function maskEmail(email?: string): string | undefined {
  if (!email) return email
  const [user, domain] = email.split('@')
  return `${user.slice(0, 2)}…@${domain}`
}
