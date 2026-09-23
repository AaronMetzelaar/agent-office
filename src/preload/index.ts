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
  onWindowVisibility: (listener) => subscribe('windowVisibility', listener),
  onAccountsChanged: (listener) => subscribe('accountsChanged', listener),
}

contextBridge.exposeInMainWorld('office', office)
