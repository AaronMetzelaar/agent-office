import { chmodSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { userInfo } from 'node:os'
import type { IPty } from 'node-pty'
import type { ChatView } from '../shared/chat'
import type { Hub } from './ipc'
import { outsideAsar } from './sessions/manager'

export interface TerminalDeps {
  chat(chatId: string): Readonly<ChatView> | undefined
}

const maxBuffer = 200_000
const maxCommand = 20_000

export const commandInput = (command: string) => `${command.replace(/\r?\n/g, '\r')}\r`

function makeHelperExecutable() {
  const helper = join(outsideAsar(dirname(require.resolve('node-pty/package.json'))), 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
  if (existsSync(helper)) chmodSync(helper, 0o755)
}

export function wireTerminal(hub: Hub, { chat }: TerminalDeps) {
  let spawn: typeof import('node-pty').spawn | undefined
  const terminals = new Map<string, { pty: IPty; buffer: string }>()

  function open(chatId: string, cwd: string) {
    const existing = terminals.get(chatId)
    if (existing) return existing
    if (!spawn) {
      makeHelperExecutable()
      spawn = (require('node-pty') as typeof import('node-pty')).spawn
    }
    const shell = process.env.SHELL || userInfo().shell || '/bin/zsh'
    const pty = spawn(shell, ['-l'], { name: 'xterm-256color', cols: 100, rows: 30, cwd, env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string> })
    const terminal = { pty, buffer: '' }
    terminals.set(chatId, terminal)
    pty.onData((data) => {
      terminal.buffer = (terminal.buffer + data).slice(-maxBuffer)
      hub.send('terminalData', { chatId, data })
    })
    pty.onExit(() => {
      if (terminals.get(chatId) === terminal) terminals.delete(chatId)
      hub.send('terminalExit', { chatId })
    })
    return terminal
  }

  hub.handle('runInTerminal', (chatId, command) => {
    const view = typeof chatId === 'string' ? chat(chatId) : undefined
    if (!view) return { error: 'That chat isn’t open any more.' }
    if (typeof command !== 'string' || !command.trim() || command.length > maxCommand) return { error: 'Nothing to run.' }
    if (!existsSync(view.cwd)) return { error: `${view.cwd} doesn’t exist any more.` }
    const terminal = open(chatId as string, view.cwd)
    terminal.pty.write(commandInput(command.trim()))
    return { buffer: terminal.buffer }
  })
  hub.handle('terminalBuffer', (chatId) => (typeof chatId === 'string' ? terminals.get(chatId)?.buffer : undefined))
  hub.handle('terminalInput', (chatId, data) => {
    if (typeof chatId === 'string' && typeof data === 'string') terminals.get(chatId)?.pty.write(data)
  })
  hub.handle('terminalResize', (chatId, cols, rows) => {
    const valid = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 1 && (n as number) < 1000
    if (typeof chatId === 'string' && valid(cols) && valid(rows)) terminals.get(chatId)?.pty.resize(cols, rows)
  })
  hub.handle('closeTerminal', (chatId) => {
    if (typeof chatId === 'string') terminals.get(chatId)?.pty.kill()
  })

  return { close: () => terminals.forEach(({ pty }) => pty.kill()) }
}
