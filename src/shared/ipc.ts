import type { CommandList, CommandTarget } from './commands'
import type { Attachment, ChatPatchBatch, ChatSnapshot, Effort, OlderRows, Refusal, RewindPreview, SimulatorShot, StartChatResult } from './chat'
import type { DeptRule, StartOptions } from './departments'
import type { SearchHit } from './history'
import type { CleanupSummary, Finished, FinishedMany, HousekeepingView, StopReport, Thresholds } from './housekeeping'
import type { Decision, ResolveResult, RuleView, WindowSource } from './permissions'
import type { CiLog, Editor, FilePreview, Review } from './review'
import type { ReviewQueue, ShipIt, TicketLookup } from './workflow'

export interface AppInfo {
  name: string
  version: string
  commit?: string
}

export interface AppUpdate {
  behind: number
  subjects: string[]
  stage?: 'building' | 'waiting' | 'installing'
  error?: string
}

export type AccountStatus = 'ok' | 'needs-login' | 'unknown'

export interface UsageWindow {
  utilization: number
  resetsAt?: number
  warn?: boolean
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
  claudeLogin?: true
  health: AccountHealth
}

const percent = (value?: number) => (value === undefined ? '–' : `${Math.round(value)}%`)
export const usageLine = (account: AccountView) =>
  account.health.status === 'needs-login' ? 'needs login' : `5h ${percent(account.health.headroom?.fiveHour?.utilization)} · week ${percent(account.health.headroom?.sevenDay?.utilization)}`

export type AddAccountResult = { account: AccountView } | { error: string }

export type Navigate = { to: 'inbox' } | { to: 'chat'; chatId: string } | { to: 'new' } | { to: 'accounts' } | { to: 'housekeeping' }

export interface Settings {
  phonePush: boolean
  phonePushAvailable: boolean
  alertsHintSeen: boolean
  editor: Editor
  outsideChats: boolean
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
}

export type SettingName = 'phonePush' | 'alertsHintSeen' | 'editor' | 'quietHoursEnabled' | 'quietHoursStart' | 'quietHoursEnd'

export interface HostStatus {
  connected: boolean
  updateReady: boolean
}

export interface Commands {
  getAppInfo(): AppInfo
  listAccounts(): AccountView[]
  addAccount(label: string, token: string | null): Promise<AddAccountResult>
  removeAccount(id: string): void
  revalidateAccount(id: string): Promise<void>
  setLinearKey(key: string): void
  clearLinearKey(): void
  hasLinearKey(): boolean
  setJevKey(key: string): void
  clearJevKey(): void
  hasJevKey(): boolean
  getSnapshot(): ChatSnapshot
  startChat(accountId: string, cwd: string, prompt: string, model?: string, effort?: Effort, options?: StartOptions): Promise<StartChatResult>
  continueOnAccount(chatId: string, accountId: string): { chatId: string } | Refusal | undefined
  departmentRules(): DeptRule[]
  sendMessage(chatId: string, text: string, attachments?: Attachment[]): Refusal | undefined
  interruptChat(chatId: string): Promise<void>
  stopTask(chatId: string, id: string): Promise<void>
  rewindFiles(chatId: string, messageId: string, dryRun: boolean): Promise<RewindPreview>
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
  simulatorScreenshot(device: string): Promise<SimulatorShot>
  openArtifact(path: string, url: string): Promise<void>
  getReview(chatId: string): Promise<Review>
  getCiLog(chatId: string, checkId: string): Promise<CiLog>
  openInEditor(chatId: string, path: string, line?: number): Promise<{ error: string } | undefined>
  previewFile(chatId: string, path: string): Promise<FilePreview>
  getHousekeeping(fresh?: boolean): Promise<HousekeepingView>
  stopProcesses(chatId: string): Promise<StopReport>
  archiveChat(chatId: string): Promise<StopReport>
  cleanUp(chatIds?: string[]): Promise<CleanupSummary>
  removeWorktree(path: string): Promise<{ error?: string; bytes?: number }>
  removeVisitorWorktree(chatId: string): Promise<{ error?: string; bytes?: number }>
  setThresholds(thresholds: Thresholds): HousekeepingView
  finishChat(chatId: string, removeWorktree?: boolean): Promise<Finished | undefined>
  finishChats(chatIds: string[], removeWorktrees?: boolean): Promise<FinishedMany | undefined>
  getShipIt(chatId: string): Promise<ShipIt>
  getCommands(target: CommandTarget): CommandList
  lookupTicket(text: string): Promise<TicketLookup>
  moveTicket(chatId: string): Promise<{ status?: string; error?: string }>
  getReviewRequests(): ReviewQueue
  startReview(url: string): Promise<StartChatResult>
  installHook(): Promise<Settings | { error: string }>
  uninstallHook(): Settings | { error: string }
  moveIntoOffice(chatId: string): Promise<{ chatId: string } | { error: string } | undefined>
  archiveVisitor(chatId: string): Promise<{ error?: string } | undefined>
  openInTerminal(chatId: string): Promise<{ error?: string } | undefined>
  runInTerminal(chatId: string, command: string): { buffer: string } | { error: string }
  terminalBuffer(chatId: string): string | undefined
  terminalInput(chatId: string, data: string): void
  terminalResize(chatId: string, cols: number, rows: number): void
  closeTerminal(chatId: string): void
  openInDesktop(chatId: string): Promise<{ error?: string } | undefined>
  getHostStatus(): HostStatus
  getAppUpdate(): AppUpdate
  installAppUpdate(): void
  restartHost(): void
  stopHost(): Promise<void>
  searchChats(query: string): Promise<SearchHit[]>
  openTranscript(sessionId: string): { chatId: string } | { error: string }
  renameChat(chatId: string, title: string): void
}

export interface Events {
  windowVisibility: { visible: boolean }
  accountsChanged: AccountView[]
  chatPatches: ChatPatchBatch
  navigate: Navigate
  housekeeping: HousekeepingView
  reviewRequests: ReviewQueue
  hostStatus: HostStatus
  appUpdate: AppUpdate
  terminalData: { chatId: string; data: string }
  terminalExit: { chatId: string }
}

export type OfficeApi = {
  [K in keyof Commands]: (...args: Parameters<Commands[K]>) => Promise<Awaited<ReturnType<Commands[K]>>>
} & {
  pathForFile(file: File): string
  onWindowVisibility(listener: (payload: Events['windowVisibility']) => void): () => void
  onAccountsChanged(listener: (payload: Events['accountsChanged']) => void): () => void
  onChatPatches(listener: (payload: Events['chatPatches']) => void): () => void
  onNavigate(listener: (payload: Events['navigate']) => void): () => void
  onHousekeeping(listener: (payload: Events['housekeeping']) => void): () => void
  onReviewRequests(listener: (payload: Events['reviewRequests']) => void): () => void
  onHostStatus(listener: (payload: Events['hostStatus']) => void): () => void
  onAppUpdate(listener: (payload: Events['appUpdate']) => void): () => void
  onTerminalData(listener: (payload: Events['terminalData']) => void): () => void
  onTerminalExit(listener: (payload: Events['terminalExit']) => void): () => void
}
