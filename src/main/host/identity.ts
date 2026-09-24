import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const hostFlag = '--agent-host'
export const socketPath = (dataDir: string) => join(dataDir, 'host.sock')
export const pidPath = (dataDir: string) => join(dataDir, 'host.pid')
export const logPath = (dataDir: string) => join(dataDir, 'host.log')

export function hostSecret(dataDir: string): string {
  const file = join(dataDir, 'host.secret')
  try {
    const saved = readFileSync(file, 'utf8').trim()
    if (saved) return saved
  } catch {}
  const secret = randomBytes(32).toString('hex')
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(file, secret, { mode: 0o600 })
  return secret
}

export function sameSecret(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function hostBuild(mainDir: string): string {
  try {
    return createHash('sha256').update(readFileSync(join(mainDir, 'host.js'))).digest('hex').slice(0, 16)
  } catch {
    return 'unknown'
  }
}
