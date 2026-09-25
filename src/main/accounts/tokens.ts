import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'

export interface Account {
  id: string
  label: string
  createdAt: number
  claudeLogin?: true
}

export type Vault = ReturnType<typeof openVault>

function withLogin({ claudeLogin: _, ...account }: Account, token: string | null): Account {
  return token === null ? { ...account, claudeLogin: true } : account
}

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
    add(label: string, token: string | null): Account {
      const account = withLogin({ id: randomUUID(), label, createdAt: Date.now() }, token)
      if (token !== null) write(accountSecret(account.id), token)
      save([...list(), account])
      return account
    },
    replaceToken(id: string, token: string | null): Account | undefined {
      const account = find(id)
      if (!account) return undefined
      if (token === null) erase(accountSecret(id))
      else write(accountSecret(id), token)
      const replaced = withLogin(account, token)
      save(list().map((other) => (other.id === id ? replaced : other)))
      return replaced
    },
    remove(id: string): void {
      if (!find(id)) return
      save(list().filter((account) => account.id !== id))
      erase(accountSecret(id))
    },
    token(id: string): string | null | undefined {
      const account = find(id)
      return account?.claudeLogin ? null : account && read(accountSecret(id))
    },
    linearKey: () => read('linear'),
    setLinearKey: (key: string) => write('linear', key),
    clearLinearKey: () => erase('linear'),
    jevKey: () => read('jev'),
    setJevKey: (key: string) => write('jev', key),
    clearJevKey: () => erase('jev'),
    ntfyKey: () => read('ntfy-hmac'),
    setNtfyKey: (key: string) => write('ntfy-hmac', key),
  }
}
