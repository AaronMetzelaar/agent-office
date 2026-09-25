import { isAbsolute, join } from 'node:path'
import { app } from 'electron'
import { playgroundRoom } from '../../shared/departments'
import type { SettingName } from '../../shared/ipc'
import { isEditor } from '../../shared/review'
import { createAccounts, fakeValidator, validate } from '../accounts/health'
import { openVault } from '../accounts/tokens'
import { wireCommands } from '../commands'
import { createPlacement } from '../departments/classifier'
import { loadConfig } from '../departments/config'
import { createJev } from '../departments/jev'
import { createRooms } from '../departments/rooms'
import { upgradeRooms } from '../departments/upgrade'
import { wireHandoff } from '../handoff'
import { wireTerminal } from '../terminal'
import { createSearch, wireHistory } from '../history'
import { createHousekeeping, realSystem, wireHousekeeping } from '../housekeeping'
import type { Hub } from '../ipc'
import { loginShellPath } from '../login-path'
import { createWaitMetrics } from '../metrics/wait'
import { createNotifier } from '../notify'
import { pinnedFolders } from '../folders'
import { configDir, createPhonePush, defaultQuietEnd, defaultQuietStart } from '../notify/ntfy'
import { claudeDir, createOutside, wireOutside } from '../outside'
import { desktopDir } from '../outside/desktop-meta'
import { createBroker, windowResolver } from '../permissions/registry'
import { createRules } from '../permissions/rules'
import { wireReview } from '../review'
import { run } from '../review/git'
import { createSessionManager, type Engine } from '../sessions/manager'
import { createChatStore } from '../store/chats'
import { openDb } from '../store/db'
import { loginItems, wireChats } from '../store/ipc-sync'
import { stripState } from '../tray/strip'
import { wireWorkflow } from '../workflow'
import { createLinear } from '../workflow/linear'
import type { Ui } from './ui'

export type Core = ReturnType<typeof createCore>
export type Prepared = Awaited<ReturnType<typeof prepareCore>>

export async function prepareCore() {
  if (app.isPackaged) process.env.PATH = await loginShellPath()
  const fakeEngine = !app.isPackaged && process.env.AGENT_OFFICE_FAKE_ENGINE === '1' ? (await import('../../../tests/fakes/fake-engine')).createFakeEngine({ auto: true }) : undefined
  const fakeGithub = !app.isPackaged && process.env.AGENT_OFFICE_FAKE_GH === '1' ? (await import('../../../tests/fakes/github')).createFakeGithub() : undefined
  return { fakeEngine, fakeGithub }
}

export function createCore(dataDir: string, hub: Hub, ui: Ui, { fakeEngine, fakeGithub }: Prepared) {
  const vault = openVault(dataDir)
  const db = openDb(join(dataDir, 'office.db'))
  const useFakeValidator = !app.isPackaged && process.env.AGENT_OFFICE_FAKE_VALIDATOR === '1'
  const accounts = createAccounts(vault, useFakeValidator ? fakeValidator : validate, db)
  const engine: Engine = fakeEngine ?? createSessionManager((accountId) => vault.token(accountId), (...args) => broker.canUseTool(...args))
  const rules = createRules(db.sql, engine)
  upgradeRooms(db, accounts.list().map((account) => account.label), configDir())
  const loaded = loadConfig(configDir())
  for (const problem of [...(loaded.unreadable ? [`departments.json can’t be read: ${loaded.unreadable}`] : []), ...loaded.skipped]) console.warn(`[rooms] ${problem}`)
  const rooms = createRooms(db, loaded, () => [...store.views(), ...outside.visitors.views()].flatMap((chat) => (chat.archived || !chat.department ? [] : [chat.department])), engine.ask)
  const store = createChatStore(engine, db, accounts, rooms, rules.forSession)
  const broker = createBroker(engine, store, rules, createWaitMetrics(db.sql, store))
  if (fakeEngine) fakeEngine.canUseTool = broker.canUseTool
  const outside = createOutside({ store, accounts: accounts.list, rooms, settings: db, claudeDir: claudeDir(), desktopDir: desktopDir(), configDir: configDir() })
  const sync = wireChats(hub, store, outside.visitors, rooms, () => placement.release())
  const placement = createPlacement(engine, store, rooms, (chatId) => sync.openChat() === chatId)
  const search = createSearch(join(dataDir, 'search.db'), join(claudeDir(), 'projects'), join(app.getAppPath(), 'out/main/indexer.js'))
  wireHistory(hub, search, { store, visitors: outside.visitors })
  hub.handle('roomFor', (cwd, accountId) => (typeof cwd === 'string' && isAbsolute(cwd) ? rooms.roomFor(cwd, typeof accountId === 'string' ? accounts.label(accountId) : undefined) : playgroundRoom))
  sync.setAccounts(accounts.list())
  hub.handle('resolveRequest', windowResolver(broker, () => ui.state().focused))
  hub.handle('listRules', rules.list)
  hub.handle('revokeRule', rules.revoke)
  hub.handle('listAccounts', accounts.list)
  hub.handle('addAccount', accounts.add)
  hub.handle('removeAccount', accounts.remove)
  hub.handle('revalidateAccount', accounts.revalidate)
  hub.handle('setLinearKey', (key) => {
    if (typeof key === 'string' && key.trim()) vault.setLinearKey(key.trim())
  })
  hub.handle('clearLinearKey', vault.clearLinearKey)
  hub.handle('hasLinearKey', () => vault.linearKey() !== undefined)
  hub.handle('setJevKey', (key) => {
    if (typeof key === 'string' && key.trim()) vault.setJevKey(key.trim())
  })
  hub.handle('clearJevKey', vault.clearJevKey)
  hub.handle('hasJevKey', () => vault.jevKey() !== undefined)
  hub.handle('recentFolders', () => [...new Set([...store.recentFolders(), ...pinnedFolders()])])

  const phone = createPhonePush({ dir: configDir(), vault, settings: db, resolve: broker.resolveRequest, onOpen: () => console.info('[ntfy] listening for phone decisions') })
  const editor = () => {
    const saved = db.setting('editor')
    return isEditor(saved) ? saved : 'code'
  }
  const settings = () => ({
    phonePush: phone.enabled(),
    phonePushAvailable: phone.available,
    alertsHintSeen: db.setting('alertsHintSeen') === true,
    editor: editor(),
    outsideChats: outside.installed(),
    quietHoursEnabled: db.setting('quietHoursEnabled') === true,
    quietHoursStart: (db.setting('quietHoursStart') as string) || defaultQuietStart,
    quietHoursEnd: (db.setting('quietHoursEnd') as string) || defaultQuietEnd,
  })
  hub.handle('getSettings', settings)
  wireReview(hub, { view: (chatId) => store.view(chatId) ?? outside.visitors.view(chatId) }, editor)
  const linear = createLinear(() => vault.linearKey())
  const commands = wireCommands(hub, { engine, store, db, claudeDir: claudeDir() })
  const reviews = wireWorkflow(hub, { store, commandNames: commands.names, commands: loaded.config.commands, accounts: accounts.list, tiedRoom: rooms.tiedRoom, linear, jev: createJev(() => vault.jevKey(), rooms), rooms, gh: fakeGithub?.run ?? run, confirm: ui.confirm })
  wireOutside(hub, outside, { store, accounts: accounts.list, rooms, settings, confirm: ui.confirm })
  wireHandoff(hub, { store, visitors: outside.visitors, vault, accounts: accounts.list })
  const terminals = wireTerminal(hub, { chat: (chatId) => store.view(chatId) ?? outside.visitors.view(chatId) })
  hub.handle('setSetting', (name: SettingName, value: boolean | string) => {
    if (name === 'editor' && isEditor(value)) db.saveSetting(name, value)
    if ((name === 'quietHoursStart' || name === 'quietHoursEnd') && typeof value === 'string') db.saveSetting(name, value)
    if (typeof value !== 'boolean') return settings()
    if (name === 'phonePush') phone.set(value)
    if (name === 'alertsHintSeen') db.saveSetting(name, value)
    if (name === 'quietHoursEnabled') db.saveSetting(name, value)
    return settings()
  })

  const notifier = createNotifier({
    store,
    department: (chat) => rooms.nameOf(chat.department),
    resolve: (requestId, decision) => broker.resolveRequest(requestId, decision, 'notification'),
    sendMessage: store.sendMessage,
    open: ui.show,
    notification: ui.notification,
    push: phone.post,
    shown: (chatId) => {
      const { visible, focused } = ui.state()
      return visible && focused && sync.openChat() === chatId
    },
  })
  const house = createHousekeeping(store, engine, db, fakeEngine ? { ...realSystem(), ...fakeEngine.processes, graceMs: 1000 } : realSystem(), notifier.cleanup, outside.visitors)
  wireHousekeeping(hub, house, ui.confirm)
  house.start()
  const strip = () => ui.strip(stripState([...store.views(), ...outside.visitors.views()], loginItems(accounts.list())))
  strip()
  store.events.on('patch', (patch) => {
    if (patch.fields && ('state' in patch.fields || 'pendingRequests' in patch.fields || 'archived' in patch.fields)) strip()
  })
  const stripTimer = setInterval(strip, 60_000)
  const usageTimer = setInterval(() => {
    for (const account of accounts.list()) if (account.health.status !== 'needs-login') void accounts.revalidate(account.id)
  }, 10 * 60_000)
  ui.onChange(({ visible, focused }) => {
    sync.setVisible(visible)
    if (focused) reviews.focus()
  })
  accounts.events.on('needs-login', notifier.login)
  accounts.events.on('headroom', notifier.headroom)
  accounts.events.on('changed', (list) => {
    hub.send('accountsChanged', list)
    sync.setAccounts(list)
    outside.rescan()
    strip()
    for (const account of list) if (account.health.status !== 'needs-login') notifier.loginFixed(account.id)
  })
  accounts.events.on('removed', store.accountRemoved)
  Object.assign(globalThis, { notifier, phone, store, fakeEngine, fakeGithub, reviews, outside })

  let stopped = false
  return {
    store,
    busy: store.busy,
    shutdown() {
      if (stopped) return
      stopped = true
      clearInterval(stripTimer)
      clearInterval(usageTimer)
      void search.stop()
      house.stop()
      phone.stop()
      void outside.stop()
      store.shutdown()
      terminals.close()
    },
  }
}
