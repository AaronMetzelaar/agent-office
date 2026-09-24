import { join } from 'node:path'
import { app } from 'electron'
import { departmentOf, deptNames, isResearch } from '../../shared/office'
import type { SettingName } from '../../shared/ipc'
import { limitsOf } from '../../shared/guardrails'
import { isEditor } from '../../shared/review'
import { createAccounts, fakeValidator, validate } from '../accounts/health'
import { openVault } from '../accounts/tokens'
import { wireCommands } from '../commands'
import { createPlacement, loadRules } from '../departments/classifier'
import { createJev } from '../departments/jev'
import { wireHandoff } from '../handoff'
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
  const deptRules = loadRules(configDir())
  const store = createChatStore(engine, db, accounts, rules.forSession, deptRules)
  const broker = createBroker(engine, store, rules, createWaitMetrics(db.sql, store))
  if (fakeEngine) fakeEngine.canUseTool = broker.canUseTool
  const outside = createOutside({ store, accounts: accounts.list, rules: deptRules, settings: db, claudeDir: claudeDir(), desktopDir: desktopDir(), configDir: configDir() })
  const sync = wireChats(hub, store, outside.visitors)
  createPlacement(engine, store, deptRules, (chatId) => sync.openChat() === chatId)
  hub.handle('departmentRules', () => deptRules)
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
    paused: store.paused(),
    limits: limitsOf(db.setting('limits')),
  })
  hub.handle('getSettings', settings)
  wireReview(hub, { view: (chatId) => store.view(chatId) ?? outside.visitors.view(chatId) }, editor)
  const linear = createLinear(() => vault.linearKey())
  const commands = wireCommands(hub, { engine, store, db, claudeDir: claudeDir() })
  const reviews = wireWorkflow(hub, { store, commandNames: commands.names, accounts: accounts.list, linear, jev: createJev(() => vault.jevKey(), deptRules), gh: fakeGithub?.run ?? run, confirm: ui.confirm })
  wireOutside(hub, outside, { store, accounts: accounts.list, rules: deptRules, settings, confirm: ui.confirm })
  wireHandoff(hub, { store, visitors: outside.visitors, vault, accounts: accounts.list })
  hub.handle('setPaused', (on) => {
    store.setPaused(on)
    return settings()
  })
  hub.handle('setLimits', store.setLimits)
  hub.handle('setSetting', (name: SettingName, value: boolean | string | object) => {
    if (name === 'editor' && isEditor(value)) db.saveSetting(name, value)
    if ((name === 'quietHoursStart' || name === 'quietHoursEnd') && typeof value === 'string') db.saveSetting(name, value)
    if (name === 'limits') db.saveSetting(name, limitsOf(value))
    if (typeof value !== 'boolean') return settings()
    if (name === 'phonePush') phone.set(value)
    if (name === 'alertsHintSeen') db.saveSetting(name, value)
    if (name === 'quietHoursEnabled') db.saveSetting(name, value)
    return settings()
  })

  const research = () => new Set(accounts.list().filter(isResearch).map((account) => account.id))
  const notifier = createNotifier({
    store,
    department: (chat) => deptNames[departmentOf(chat, research().has(chat.accountId))],
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
      house.stop()
      phone.stop()
      void outside.stop()
      store.shutdown()
    },
  }
}
