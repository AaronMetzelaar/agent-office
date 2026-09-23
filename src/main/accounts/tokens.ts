import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'

export interface Account {
  id: string
  label: string
  createdAt: number
}

export type Vault = ReturnType<typeof openVault>

export function openVault(dir: string) {
  const index = join(dir, 'accounts.json')
  const secrets = join(dir, 'secrets')
  const secretFile = (name: string) => join(secrets, `${name}.bin`)
  const accountSecret = (id: string) => `account-${id}`

  const write = (name: string, value: string) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Keychain encryption is unavailable, so nothing was stored')
    mkdirSync(secrets, { recursive: true, mode: 0o700 })
    writeFileSync(secretFile(name), safeStorage.encryptString(value), { mode: 0o600 })
  }
  const read = (name: string) => {
    try {
      return safeStorage.decryptString(readFileSync(secretFile(name)))
    } catch {
      return undefined
    }
  }
  const erase = (name: string) => rmSync(secretFile(name), { force: true })

  const list = (): Account[] => (existsSync(index) ? (JSON.parse(readFileSync(index, 'utf8')) as Account[]) : [])
  const save = (accounts: Account[]) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${index}.tmp`, JSON.stringify(accounts, null, 2), { mode: 0o600 })
    renameSync(`${index}.tmp`, index)
  }
  const find = (id: string) => list().find((account) => account.id === id)

  return {
    list,
    find,
    findByLabel: (label: string) => list().find((account) => account.label.toLowerCase() === label.toLowerCase()),
    add(label: string, token: string): Account {
      const account = { id: randomUUID(), label, createdAt: Date.now() }
      write(accountSecret(account.id), token)
      save([...list(), account])
      return account
    },
    replaceToken(id: string, token: string): void {
      if (find(id)) write(accountSecret(id), token)
    },
    remove(id: string): void {
      if (!find(id)) return
      save(list().filter((account) => account.id !== id))
      erase(accountSecret(id))
    },
    token: (id: string) => (find(id) ? read(accountSecret(id)) : undefined),
    linearKey: () => read('linear'),
    setLinearKey: (key: string) => write('linear', key),
    clearLinearKey: () => erase('linear'),
    ntfyKey: () => read('ntfy-hmac'),
    setNtfyKey: (key: string) => write('ntfy-hmac', key),
  }
}
