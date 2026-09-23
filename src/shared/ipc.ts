import type { ChatPatchBatch, ChatSnapshot, Effort, StartChatResult } from './chat'

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
  startChat(accountId: string, cwd: string, prompt: string, model?: string, effort?: Effort): StartChatResult
  sendMessage(chatId: string, text: string): void
  interruptChat(chatId: string): Promise<void>
  stopChat(chatId: string): void
  setModel(chatId: string, model: string): Promise<void>
  setEffort(chatId: string, effort: Effort): Promise<void>
  resumeChat(chatId: string): void
  markRead(chatId: string): void
}

export interface Events {
  windowVisibility: { visible: boolean }
  accountsChanged: AccountView[]
  chatPatches: ChatPatchBatch
}

export type OfficeApi = {
  [K in keyof Commands]: (...args: Parameters<Commands[K]>) => Promise<Awaited<ReturnType<Commands[K]>>>
} & {
  onWindowVisibility(listener: (payload: Events['windowVisibility']) => void): () => void
  onAccountsChanged(listener: (payload: Events['accountsChanged']) => void): () => void
  onChatPatches(listener: (payload: Events['chatPatches']) => void): () => void
}
