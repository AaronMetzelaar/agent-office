import type { ChatPatchBatch, ChatSnapshot, Effort, OlderRows, Refusal, StartChatResult } from './chat'
import type { DeptRule, StartOptions } from './departments'
import type { Decision, ResolveResult, RuleView, WindowSource } from './permissions'
import type { CiLog, Editor, Review } from './review'

export interface AppInfo {
  name: string
  version: string
}

export type AccountStatus = 'ok' | 'needs-login' | 'unknown'

export interface UsageWindow {
  utilization: number
  resetsAt?: number
}

export interface Headroom {
  fiveHour?: UsageWindow
  sevenDay?: UsageWindow
}

export interface AccountHealth {
  status: AccountStatus
  headroom?: Headroom
  lastCheckedAt?: number
}

export interface AccountView {
  id: string
  label: string
  createdAt: number
  health: AccountHealth
}

export type AddAccountResult = { account: AccountView } | { error: string }

export type Navigate = { to: 'inbox' } | { to: 'chat'; chatId: string } | { to: 'new' } | { to: 'accounts' }

export interface Settings {
  phonePush: boolean
  phonePushAvailable: boolean
  alertsHintSeen: boolean
  editor: Editor
}

export type SettingName = 'phonePush' | 'alertsHintSeen' | 'editor'

export interface Commands {
  getAppInfo(): AppInfo
  listAccounts(): AccountView[]
  addAccount(label: string, token: string): Promise<AddAccountResult>
  removeAccount(id: string): void
  revalidateAccount(id: string): Promise<void>
  setLinearKey(key: string): void
  clearLinearKey(): void
  hasLinearKey(): boolean
  getSnapshot(): ChatSnapshot
  startChat(accountId: string, cwd: string, prompt: string, model?: string, effort?: Effort, options?: StartOptions): StartChatResult
  continueOnAccount(chatId: string, accountId: string): Refusal | undefined
  departmentRules(): DeptRule[]
  sendMessage(chatId: string, text: string): Refusal | undefined
  interruptChat(chatId: string): Promise<void>
  stopChat(chatId: string): void
  setModel(chatId: string, model: string): Promise<void>
  setEffort(chatId: string, effort: Effort): Promise<void>
  setPlanMode(chatId: string, on: boolean): Promise<void>
  setOpenChat(chatId?: string): void
  olderRows(chatId: string, beforeId?: string): Promise<OlderRows>
  getDraft(chatId: string): string
  saveDraft(chatId: string, text: string): void
  resumeChat(chatId: string): Refusal | undefined
  markRead(chatId: string): void
  resolveRequest(requestId: string, decision: Decision, source: WindowSource): ResolveResult
  listRules(): RuleView[]
  revokeRule(id: number): Promise<void>
  recentFolders(): string[]
  pickFolder(): Promise<string | undefined>
  getSettings(): Settings
  setSetting(name: SettingName, value: boolean | string): Settings
  openNotificationSettings(): void
  getReview(chatId: string): Promise<Review>
  getCiLog(chatId: string, checkId: string): Promise<CiLog>
  openInEditor(chatId: string, path: string, line?: number): Promise<{ error: string } | undefined>
}

export interface Events {
  windowVisibility: { visible: boolean }
  accountsChanged: AccountView[]
  chatPatches: ChatPatchBatch
  navigate: Navigate
}

export type OfficeApi = {
  [K in keyof Commands]: (...args: Parameters<Commands[K]>) => Promise<Awaited<ReturnType<Commands[K]>>>
} & {
  onWindowVisibility(listener: (payload: Events['windowVisibility']) => void): () => void
  onAccountsChanged(listener: (payload: Events['accountsChanged']) => void): () => void
  onChatPatches(listener: (payload: Events['chatPatches']) => void): () => void
  onNavigate(listener: (payload: Events['navigate']) => void): () => void
}
