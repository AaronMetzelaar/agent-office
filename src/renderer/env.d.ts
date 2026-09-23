/// <reference types="vite/client" />
import type { OfficeApi } from '../shared/ipc'

declare global {
  interface ImportMetaEnv {
    readonly RENDERER_VITE_OFFICE_DEMO?: string
  }

  interface Window {
    office: OfficeApi
  }
}
