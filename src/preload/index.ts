import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Events, OfficeApi } from '../shared/ipc'

function subscribe<K extends keyof Events>(name: K, listener: (payload: Events[K]) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: Events[K]) => listener(payload)
  ipcRenderer.on(name, handler)
  return () => ipcRenderer.off(name, handler)
}

const office: OfficeApi = {
  getAppInfo: () => ipcRenderer.invoke('getAppInfo'),
  listAccounts: () => ipcRenderer.invoke('listAccounts'),
  addAccount: (label, token) => ipcRenderer.invoke('addAccount', label, token),
  removeAccount: (id) => ipcRenderer.invoke('removeAccount', id),
  revalidateAccount: (id) => ipcRenderer.invoke('revalidateAccount', id),
  setLinearKey: (key) => ipcRenderer.invoke('setLinearKey', key),
  clearLinearKey: () => ipcRenderer.invoke('clearLinearKey'),
  hasLinearKey: () => ipcRenderer.invoke('hasLinearKey'),
  getSnapshot: () => ipcRenderer.invoke('getSnapshot'),
  startChat: (accountId, cwd, prompt, model, effort) => ipcRenderer.invoke('startChat', accountId, cwd, prompt, model, effort),
  sendMessage: (chatId, text) => ipcRenderer.invoke('sendMessage', chatId, text),
  interruptChat: (chatId) => ipcRenderer.invoke('interruptChat', chatId),
  stopChat: (chatId) => ipcRenderer.invoke('stopChat', chatId),
  setModel: (chatId, model) => ipcRenderer.invoke('setModel', chatId, model),
  setEffort: (chatId, effort) => ipcRenderer.invoke('setEffort', chatId, effort),
  setPlanMode: (chatId, on) => ipcRenderer.invoke('setPlanMode', chatId, on),
  setOpenChat: (chatId) => ipcRenderer.invoke('setOpenChat', chatId),
  olderRows: (chatId, beforeId) => ipcRenderer.invoke('olderRows', chatId, beforeId),
  getDraft: (chatId) => ipcRenderer.invoke('getDraft', chatId),
  saveDraft: (chatId, text) => ipcRenderer.invoke('saveDraft', chatId, text),
  resumeChat: (chatId) => ipcRenderer.invoke('resumeChat', chatId),
  markRead: (chatId) => ipcRenderer.invoke('markRead', chatId),
  resolveRequest: (requestId, decision, source) => ipcRenderer.invoke('resolveRequest', requestId, decision, source),
  listRules: () => ipcRenderer.invoke('listRules'),
  revokeRule: (id) => ipcRenderer.invoke('revokeRule', id),
  recentFolders: () => ipcRenderer.invoke('recentFolders'),
  pickFolder: () => ipcRenderer.invoke('pickFolder'),
  getSettings: () => ipcRenderer.invoke('getSettings'),
  setSetting: (name, value) => ipcRenderer.invoke('setSetting', name, value),
  openNotificationSettings: () => ipcRenderer.invoke('openNotificationSettings'),
  onWindowVisibility: (listener) => subscribe('windowVisibility', listener),
  onAccountsChanged: (listener) => subscribe('accountsChanged', listener),
  onChatPatches: (listener) => subscribe('chatPatches', listener),
  onNavigate: (listener) => subscribe('navigate', listener),
}

contextBridge.exposeInMainWorld('office', office)
