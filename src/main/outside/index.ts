import { statSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defaultAccount, homeDept, isResearch, type DeptId, type DeptRule } from '../../shared/departments'
import type { AccountView, Settings } from '../../shared/ipc'
import type { Hub } from '../ipc'
import type { ChatStore } from '../store/chats'
import { createDesktopMeta } from './desktop-meta'
import { endpointSecret, install, isInstalled, uninstall, writeEndpoint, type HookPaths } from './installer'
import { isSessionId, startListener } from './listener'
import { createDiscovery } from './transcripts'
import { createVisitors, type VisitorOptions } from './visitors'

export interface OutsideDeps {
  store: Pick<ChatStore, 'events' | 'views'>
  accounts(): readonly AccountView[]
  rules: readonly DeptRule[]
  settings: VisitorOptions['settings']
  claudeDir: string
  desktopDir: string
  configDir: string
  log?: (message: string) => void
}

export interface WireOutsideDeps {
  store: Pick<ChatStore, 'adopt' | 'views'>
  accounts(): readonly AccountView[]
  rules: readonly DeptRule[]
  settings(): Settings
  confirm(message: string, detail: string, action?: string): Promise<boolean>
}

export type Outside = ReturnType<typeof createOutside>

export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
export const consentText =
  'Agent Office adds one marked hook entry to ~/.claude/settings.json and backs the file up first. Every Claude Code session on this Mac, in the desktop app or a terminal, then sends its status to Agent Office on 127.0.0.1 with a secret only your user can read. When Agent Office isn’t running, the hook exits at once. Uninstalling removes exactly that entry.'

const rescanMs = 2000
const refreshMs = 60_000
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

function watchQuietly(path: string, wanted: (file: string) => boolean, onChange: () => void): () => void {
  try {
    const watcher = watch(path, { recursive: true }, (_event, file) => file && wanted(file) && onChange())
    return () => watcher.close()
  } catch {
    return () => {}
  }
}

export function createOutside({ store, accounts, rules, settings, claudeDir, desktopDir, configDir, log = (message) => console.warn(`[outside] ${message}`) }: OutsideDeps) {
  const projectsDir = join(claudeDir, 'projects')
  const desktop = createDesktopMeta(desktopDir)
  const discovery = createDiscovery({ projectsDir, desktop: desktop.read })
  const officeSessions = () => new Set(store.views().flatMap((view) => (view.sessionId && !view.forkPending ? [view.sessionId] : [])))
  const visitors = createVisitors({ patch: (patch) => store.events.emit('patch', patch), accounts, rules, officeSessions, describe: (id) => discovery.describe(id, Date.now()), settings, log })
  const paths: HookPaths = { settings: join(claudeDir, 'settings.json'), dir: configDir }

  const rescan = () => {
    try {
      visitors.sync(discovery.scan(Date.now(), officeSessions()))
    } catch (error) {
      log(`couldn’t scan outside chats: ${errorText(error)}`)
    }
  }
  let pending: ReturnType<typeof setTimeout> | undefined
  const soon = () => {
    pending ??= setTimeout(() => {
      pending = undefined
      rescan()
    }, rescanMs)
  }

  rescan()
  const unwatch = [desktop.watch(soon), watchQuietly(projectsDir, (file) => file.endsWith('.jsonl') && !file.includes('subagents'), soon)]
  const timer = setInterval(rescan, refreshMs)
  timer.unref()

  const secret = endpointSecret(configDir)
  const listening = startListener({ secret, onEvent: visitors.hook, log }).then(
    (listener) => {
      writeEndpoint(configDir, listener.port, secret)
      return listener
    },
    (error: unknown) => {
      log(`the hook listener didn’t start: ${errorText(error)}`)
      return undefined
    },
  )

  return {
    visitors,
    paths,
    listening,
    rescan,
    transcript: (sessionId: string) => discovery.describe(sessionId, Date.now(), true),
    installed: () => isInstalled(paths.settings),
    async stop() {
      clearInterval(timer)
      clearTimeout(pending)
      unwatch.forEach((close) => close())
      await (await listening)?.close()
    },
  }
}

export function wireOutside(hub: Hub, { visitors, paths, transcript }: Outside, { store, accounts, rules, settings, confirm }: WireOutsideDeps): void {
  const attempt = (change: () => unknown): Settings | { error: string } => {
    try {
      change()
      return settings()
    } catch (error) {
      return { error: errorText(error) }
    }
  }

  hub.handle('installHook', async () => ((await confirm('Show outside chats in the office?', consentText, 'Install')) ? attempt(() => install(paths)) : settings()))
  hub.handle('uninstallHook', () => attempt(() => uninstall(paths)))

  hub.handle('moveIntoOffice', async (chatId) => {
    const visitor = typeof chatId === 'string' ? visitors.view(chatId) : undefined
    if (!visitor || visitor.moved) return undefined
    if (!statSync(visitor.cwd, { throwIfNoEntry: false })?.isDirectory()) return { error: 'This chat’s folder no longer exists, so it can’t move into the office.' }
    const list = accounts()
    const accountId = list.some((account) => account.id === visitor.accountId && account.health.status !== 'needs-login') ? visitor.accountId : defaultAccount(list, visitor.department as DeptId)
    if (!accountId) return { error: 'Add an account that can run it first.' }
    const busy = visitor.state === 'working' || visitor.state === 'needs-you'
    const detail = `The original stays as it is; the office continues a copy from your next message.${busy ? ' It’s still running outside, so stop it there first or both copies will work in the same folder.' : ''}`
    if (!(await confirm('Move this chat into the office?', detail)) || visitors.view(visitor.id)?.moved) return undefined
    const research = isResearch({ label: list.find((account) => account.id === accountId)?.label ?? '' })
    const department = research ? 'gym' : visitor.department && visitor.department !== 'gym' ? visitor.department : homeDept(visitor.cwd, false, rules)
    const moved = store.adopt({ accountId, cwd: visitor.cwd, title: visitor.title, department, sessionId: visitor.id })
    visitors.markMoved(visitor.id)
    return { chatId: moved }
  })

  hub.handle('openTranscript', (sessionId) => {
    if (!isSessionId(sessionId)) return { error: 'That isn’t a chat.' }
    const office = store.views().find((view) => view.sessionId === sessionId && !view.forkPending)
    if (office) return { chatId: office.id }
    if (!visitors.has(sessionId)) {
      const seed = transcript(sessionId)
      if (!seed) return { error: 'That chat’s transcript is gone.' }
      visitors.summon(seed)
    }
    return { chatId: sessionId }
  })

  hub.handle('archiveVisitor', async (chatId) => {
    const visitor = typeof chatId === 'string' ? visitors.view(chatId) : undefined
    if (!visitor) return { error: 'That chat isn’t in the office any more.' }
    const detail = visitor.visitor === 'terminal' ? 'Hidden from the office. It comes back if the chat gets new activity.' : 'Hidden from the office. It stays in the desktop app until you archive it there.'
    if (!(await confirm('Archive this chat in the office?', detail, 'Archive'))) return undefined
    visitors.archive(visitor.id)
    return {}
  })
}
