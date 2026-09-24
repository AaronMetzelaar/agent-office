import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAccounts, type Validator } from '../../src/main/accounts/health'
import { openVault } from '../../src/main/accounts/tokens'
import { openDb } from '../../src/main/store/db'

vi.mock('electron', () => import('../fakes/electron'))

const goodToken = 'sk-ant-oat01-GOOD-7f3a9c2e1b'
const badToken = 'sk-ant-oat01-BAD-4d8e6f0a2c'
const headroom = { fiveHour: { utilization: 60, resetsAt: 1_790_000_000_000 } }
const validator: Validator = async (token) => (token === goodToken ? { status: 'ok', headroom } : { status: 'needs-login' })

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-accounts-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function start(validate: Validator = validator) {
  const vault = openVault(dir)
  const accounts = createAccounts(vault, validate)
  const changes: unknown[] = []
  const needsLogin: string[] = []
  accounts.events.on('changed', (list) => changes.push(list))
  accounts.events.on('needs-login', (account) => needsLogin.push(account.label))
  return { vault, accounts, changes, needsLogin }
}

function filesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}

async function addMain(accounts: ReturnType<typeof start>['accounts']) {
  const result = await accounts.add('main', goodToken)
  if (!('account' in result)) throw new Error(result.error)
  return result.account
}

describe('accounts', () => {
  it('stores a validated token encrypted, reads it back after a restart and never lists it', async () => {
    const first = start()
    const account = await addMain(first.accounts)

    const secretFiles = filesUnder(join(dir, 'secrets'))
    expect(secretFiles).toHaveLength(1)
    expect(readFileSync(secretFiles[0]!).includes(goodToken)).toBe(false)
    expect(account).toEqual({ id: account.id, label: 'main', createdAt: expect.any(Number), health: { status: 'ok', headroom, lastCheckedAt: expect.any(Number) } })

    const restarted = start()
    expect(restarted.accounts.list()).toEqual([{ id: account.id, label: 'main', createdAt: account.createdAt, health: { status: 'unknown' } }])
    expect(restarted.vault.token(account.id)).toBe(goodToken)
    expect(JSON.stringify(restarted.accounts.list())).not.toContain(goodToken)
  })

  it('rejects an invalid token with a clear message and saves nothing', async () => {
    const { accounts, changes } = start()

    const result = await accounts.add('main', badToken)

    expect(result).toEqual({ error: expect.stringContaining('401') })
    expect(accounts.list()).toEqual([])
    expect(existsSync(join(dir, 'secrets'))).toBe(false)
    expect(changes).toEqual([])
  })

  it('re-login under an existing label replaces the token and keeps the account', async () => {
    const newToken = `${goodToken}-renewed`
    const { vault, accounts } = start(async () => ({ status: 'ok', headroom: {} }))
    const account = await addMain(accounts)

    await accounts.add('Main', newToken)

    expect(accounts.list().map((entry) => entry.id)).toEqual([account.id])
    expect(vault.token(account.id)).toBe(newToken)
  })

  it('removing an account deletes its entry and drops it from the list', async () => {
    const { vault, accounts, changes } = start()
    const account = await addMain(accounts)

    accounts.remove(account.id)

    expect(filesUnder(join(dir, 'secrets'))).toEqual([])
    expect(vault.token(account.id)).toBeUndefined()
    expect(accounts.list()).toEqual([])
    expect(changes.at(-1)).toEqual([])
  })

  it('ignores a remove for an unknown or path-like id', async () => {
    const { accounts } = start()
    await addMain(accounts)

    accounts.remove('../accounts')
    accounts.remove(42)

    expect(accounts.list()).toHaveLength(1)
    expect(existsSync(join(dir, 'accounts.json'))).toBe(true)
  })

  it('an authentication failure flips the account to needs-login and emits once per account', async () => {
    const { accounts, needsLogin } = start(async () => ({ status: 'ok', headroom }))
    const main = await addMain(accounts)
    const research = await accounts.add('research', `${goodToken}-2`)
    if (!('account' in research)) throw new Error(research.error)

    accounts.loginFailed(main.id)
    accounts.loginFailed(main.id)
    accounts.loginFailed(research.account.id)
    accounts.loginFailed(main.id)

    expect(needsLogin).toEqual(['main', 'research'])
    expect(accounts.list().map((entry) => entry.health.status)).toEqual(['needs-login', 'needs-login'])
    expect(accounts.list()[0]?.health.headroom).toEqual(headroom)
  })

  it('revalidation maps a 401 to needs-login and other failures to unknown', async () => {
    let answer: () => ReturnType<Validator> = async () => ({ status: 'ok', headroom })
    const { accounts, needsLogin } = start(() => answer())
    const account = await addMain(accounts)

    answer = async () => {
      throw new Error('network down')
    }
    await accounts.revalidate(account.id)
    expect(accounts.list()[0]?.health).toMatchObject({ status: 'unknown', headroom })

    answer = async () => ({ status: 'needs-login' })
    await accounts.revalidate(account.id)
    expect(accounts.list()[0]?.health.status).toBe('needs-login')
    expect(needsLogin).toEqual(['main'])
  })

  it('persists health in the metadata database so it survives a restart', async () => {
    const db = openDb(join(dir, 'office.db'))
    const first = createAccounts(openVault(dir), validator, db)
    const added = await first.add('main', goodToken)
    if (!('account' in added)) throw new Error(added.error)

    const restarted = createAccounts(openVault(dir), validator, db)
    expect(restarted.list()[0]?.health).toEqual({ status: 'ok', headroom, lastCheckedAt: expect.any(Number) })

    restarted.remove(added.account.id)
    expect(db.loadHealth().size).toBe(0)
    db.close()
  })

  it('records headroom from a session’s rate limit events without touching login state', async () => {
    const { accounts, changes } = start()
    const account = await addMain(accounts)
    const before = changes.length

    accounts.recordHeadroom(account.id, { status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.91, resetsAt: 1_790_500_000 })
    accounts.recordHeadroom(account.id, { status: 'allowed', rateLimitType: 'overage' })

    expect(accounts.list()[0]?.health).toMatchObject({ status: 'ok', headroom: { ...headroom, sevenDay: { utilization: 91, resetsAt: 1_790_500_000_000 } } })
    expect(changes).toHaveLength(before + 1)
  })

  it('announces headroom once when a window nears its limit, and again when it eases', async () => {
    const { accounts } = start()
    const account = await addMain(accounts)
    const seen: (number | undefined)[] = []
    accounts.events.on('headroom', (_account, window) => seen.push(window?.utilization))
    const resetsAt = Math.floor(Date.now() / 1000) + 3600

    accounts.recordHeadroom(account.id, { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.5, resetsAt })
    accounts.recordHeadroom(account.id, { status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.72, resetsAt })
    accounts.recordHeadroom(account.id, { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.85, resetsAt })
    accounts.recordHeadroom(account.id, { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.1, resetsAt })

    expect(seen).toEqual([72, undefined])
  })

  it('announces a removed account so its chats can go Stuck', async () => {
    const { accounts } = start()
    const account = await addMain(accounts)
    const removed: string[] = []
    accounts.events.on('removed', (id) => removed.push(id))

    accounts.remove(account.id)

    expect(removed).toEqual([account.id])
  })

  it('keeps the Linear key encrypted and removable', () => {
    const { vault } = start()
    const key = 'lin_api_SECRETKEY123'

    vault.setLinearKey(key)
    expect(readFileSync(join(dir, 'secrets', 'linear.bin')).includes(key)).toBe(false)
    expect(openVault(dir).linearKey()).toBe(key)

    vault.clearLinearKey()
    expect(vault.linearKey()).toBeUndefined()
  })

  it('leaves no token substring in the data folder, logs, listed state or errors', async () => {
    const logged: unknown[] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => void logged.push(...args))
    }
    const leaky: Validator = async (token) => {
      if (token === goodToken) return { status: 'ok', headroom }
      throw new Error(`upstream rejected ${token}`)
    }
    const { accounts, changes } = start(leaky)

    await addMain(accounts)
    const failed = await accounts.add('research', badToken)

    const exposed = JSON.stringify({ list: accounts.list(), changes, failed, logged })
    const onDisk = filesUnder(dir).map((file) => readFileSync(file, 'latin1')).join('\n')
    for (const token of [goodToken, badToken]) {
      for (const fragment of [token, token.slice(-12)]) {
        expect(exposed).not.toContain(fragment)
        expect(onDisk).not.toContain(fragment)
      }
    }
    expect(failed).toEqual({ error: 'Couldn’t add the account: upstream rejected [token]' })
  })
})
