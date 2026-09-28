import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { Rectangle } from 'electron'

/** What the window app remembers between launches. The agent host keeps its own settings. */
export interface Prefs {
  autoUpdate?: boolean
  bounds?: Rectangle
  /** The build that ran last, to tell what an update brought. */
  commit?: string
}

export function prefsFile(path: string) {
  const read = (): Prefs => {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Prefs
    } catch {
      return {}
    }
  }
  return {
    read,
    save(patch: Prefs) {
      writeFileSync(`${path}.tmp`, JSON.stringify({ ...read(), ...patch }))
      renameSync(`${path}.tmp`, path)
    },
  }
}
