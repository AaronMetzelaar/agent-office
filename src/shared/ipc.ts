export interface AppInfo {
  name: string
  version: string
}

export interface Commands {
  getAppInfo(): AppInfo
}

export interface Events {
  windowVisibility: { visible: boolean }
}

export type OfficeApi = {
  [K in keyof Commands]: (...args: Parameters<Commands[K]>) => Promise<ReturnType<Commands[K]>>
} & {
  onWindowVisibility(listener: (payload: Events['windowVisibility']) => void): () => void
}
