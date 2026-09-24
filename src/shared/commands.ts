export type CommandKind = 'skill' | 'command' | 'plugin' | 'builtin'

export interface CommandEntry {
  name: string
  description: string
  argumentHint: string
  kind: CommandKind
}

export type CommandSource = 'live' | 'last-session' | 'scan'

export interface CommandList {
  entries: CommandEntry[]
  source: CommandSource
}

export type CommandTarget = { chatId: string } | { cwd: string }

export const kindLabels: Record<CommandKind, string> = { skill: 'Skills', command: 'Custom commands', plugin: 'Plugin skills', builtin: 'Built-in commands' }

export const sourceNotes: Record<CommandSource, string> = { live: '', 'last-session': 'from last session', scan: 'may be incomplete' }
