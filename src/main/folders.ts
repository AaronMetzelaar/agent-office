import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { configDir, readConfig } from './notify/ntfy'

export const pinnedFolders = (dir = configDir()): string[] =>
  readConfig(dir, 'folders')?.split('\n').map((line) => line.trim()).filter(Boolean) ?? []

export function pinFolder(path: string, dir = configDir()): void {
  if (pinnedFolders(dir).includes(path)) return
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, 'folders'), `${path}\n`)
}
