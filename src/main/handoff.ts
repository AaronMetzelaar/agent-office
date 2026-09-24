import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ChatView } from '../shared/chat'
import { isResearch } from '../shared/departments'
import type { AccountView } from '../shared/ipc'
import type { Hub } from './ipc'
import { launch } from './review'
import type { Vault } from './accounts/tokens'
import type { ChatStore } from './store/chats'
import type { Visitors } from './outside/visitors'

const exec = promisify(execFile)
const psArgs = ['ax', '-o', 'pid=,command=']
const researchDir = /--user-data-dir=.*Claude-Research/
const claudeProcess = /\/Claude\.app\/Contents\/MacOS\/Claude(\s|$)/

export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function handoffScript({ cwd, token, sessionId }: { cwd: string; token: string; sessionId: string }): string {
  return [
    '#!/bin/bash',
    'rm -f -- "$0"',
    `cd -- ${shQuote(cwd)} || exit 1`,
    `export CLAUDE_CODE_OAUTH_TOKEN=${shQuote(token)}`,
    `exec claude --resume ${shQuote(sessionId)} --fork-session`,
    '',
  ].join('\n')
}

export function appleScriptQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export type TerminalApp = 'iTerm2' | 'Terminal'

export function pickTerminalApp(exists: (path: string) => boolean = existsSync): TerminalApp {
  return exists('/Applications/iTerm.app') ? 'iTerm2' : 'Terminal'
}

export function terminalAppleScript(app: TerminalApp, command: string): string {
  const action = app === 'iTerm2' ? `create window with default profile command ${appleScriptQuote(command)}` : `do script ${appleScriptQuote(command)}`
  return `tell application ${appleScriptQuote(app)}\n  activate\n  ${action}\nend tell`
}

export function findInstancePid(psOutput: string, research: boolean): number | undefined {
  for (const line of psOutput.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (!match) continue
    const pid = match[1]!
    const command = match[2]!
    if (!claudeProcess.test(command) || command.includes('Helper')) continue
    if (researchDir.test(command) === research) return Number(pid)
  }
  return undefined
}

export interface HandoffDeps {
  store: Pick<ChatStore, 'view'>
  visitors: Pick<Visitors, 'view'>
  vault: Pick<Vault, 'token'>
  accounts(): readonly AccountView[]
}

export function wireHandoff(hub: Hub, { store, visitors, vault, accounts }: HandoffDeps): void {
  const chatOf = (chatId: unknown): ChatView | undefined => (typeof chatId === 'string' ? (store.view(chatId) ?? visitors.view(chatId)) : undefined)

  hub.handle('openInTerminal', async (chatId) => {
    const chat = chatOf(chatId)
    if (!chat) return { error: 'That chat isn’t open any more.' }
    if (!chat.sessionId) return { error: 'This chat hasn’t started a session yet.' }
    const token = vault.token(chat.accountId)
    if (!token) return { error: 'No token is stored for this chat’s account.' }
    const path = join(tmpdir(), `agent-office-handoff-${randomUUID()}.sh`)
    writeFileSync(path, handoffScript({ cwd: chat.cwd, token, sessionId: chat.sessionId }), { mode: 0o600 })
    const script = terminalAppleScript(pickTerminalApp(), `bash ${shQuote(path)}`)
    const error = await launch('osascript', ['-e', script])
    return error ? { error } : undefined
  })

  hub.handle('openInDesktop', async (chatId) => {
    const chat = chatOf(chatId)
    if (!chat || chat.visitor !== 'desktop') return { error: 'Only chats running in the desktop app can reopen there.' }
    const research = isResearch({ label: accounts().find((account) => account.id === chat.accountId)?.label ?? '' })
    const { stdout } = await exec('ps', psArgs).catch(() => ({ stdout: '' }))
    const pid = findInstancePid(stdout, research)
    const error =
      pid !== undefined
        ? await launch('osascript', ['-e', `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`])
        : await launch('open', ['-a', research ? 'Claude Research' : 'Claude'])
    return error ? { error } : undefined
  })
}
