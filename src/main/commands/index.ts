import { isAbsolute } from 'node:path'
import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import type { CommandEntry, CommandList, CommandTarget } from '../../shared/commands'
import type { Hub } from '../ipc'
import { repoRoot } from '../permissions/repo-root'
import type { Engine } from '../sessions/manager'
import type { ChatStore } from '../store/chats'
import type { Db } from '../store/db'
import { scanCommands } from './scan'

export interface Known {
  live?: SlashCommand[]
  running: boolean
  saved?: SlashCommand[]
}

export function commandList({ live, running, saved }: Known, scanned: CommandEntry[]): CommandList {
  const list = live ?? saved
  if (!list) return { entries: scanned, source: 'scan' }
  const kinds = new Map(scanned.map((entry) => [entry.name, entry.kind]))
  const entries = new Map<string, CommandEntry>()
  for (const command of list) {
    const taken = entries.get(command.name)
    if (taken && (taken.kind === 'builtin' || !command.builtin)) continue
    const kind = command.builtin ? 'builtin' : (kinds.get(command.name) ?? (command.name.includes(':') ? 'plugin' : 'skill'))
    entries.set(command.name, { name: command.name, description: command.description ?? '', argumentHint: command.argumentHint ?? '', kind })
  }
  return { entries: [...entries.values()], source: live && running ? 'live' : 'last-session' }
}

export interface CommandDeps {
  engine: Pick<Engine, 'events' | 'commands' | 'running'>
  store: Pick<ChatStore, 'view'>
  db: Pick<Db, 'commands' | 'saveCommands'>
  claudeDir: string
}

export function wireCommands(hub: Hub, { engine, store, db, claudeDir }: CommandDeps) {
  engine.events.on('commands', (chatId, list) => {
    const cwd = store.view(chatId)?.cwd
    try {
      if (cwd) db.saveCommands(repoRoot(cwd), list)
    } catch (error) {
      console.warn(`[commands] couldn’t save the command list: ${String(error)}`)
    }
  })

  const forFolder = (cwd: string, chatId?: string) => {
    const root = repoRoot(cwd)
    const known = { live: chatId ? engine.commands(chatId) : undefined, running: !!chatId && engine.running(chatId), saved: db.commands(root) }
    return commandList(known, scanCommands(claudeDir, [cwd, root]))
  }

  hub.handle('getCommands', (target: CommandTarget) => {
    if (target && 'chatId' in target && typeof target.chatId === 'string') {
      const cwd = store.view(target.chatId)?.cwd
      if (!cwd) throw new Error('There’s no chat with that id')
      return forFolder(cwd, target.chatId)
    }
    if (target && 'cwd' in target && typeof target.cwd === 'string' && isAbsolute(target.cwd)) return forFolder(target.cwd)
    throw new Error('getCommands needs a chat id or an absolute folder')
  })

  return {
    names(chatId: string): string[] {
      const cwd = store.view(chatId)?.cwd
      return cwd ? forFolder(cwd, chatId).entries.map((entry) => entry.name) : []
    },
  }
}
