import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Events, OfficeApi } from '../shared/ipc'

const office: OfficeApi = {
  getAppInfo: () => ipcRenderer.invoke('getAppInfo'),
  onWindowVisibility: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: Events['windowVisibility']) => listener(payload)
    ipcRenderer.on('windowVisibility', handler)
    return () => ipcRenderer.off('windowVisibility', handler)
  },
}

contextBridge.exposeInMainWorld('office', office)
