import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountHint, defaultAccount } from '../../src/shared/departments'
import { sdk } from '../fakes/fake-engine'
import { openOffice } from '../fakes/office'

vi.mock('electron', async () => await import('../fakes/electron'))

const account = (id: string, label: string, fiveHour: number, sevenDay = 0, status = 'ok') => ({ id, label, health: { status, headroom: { fiveHour: { utilization: fiveHour }, sevenDay: { utilization: sevenDay } } } })

describe('account defaults and headroom', () => {
  const main = account('m', 'main', 30)
  const research = account('r', 'research', 10)

  it('defaults to main for main-account folders and to research for the gym', () => {
    expect(defaultAccount([research, main], 'mkt')).toBe('m')
    expect(defaultAccount([research, main], 'side')).toBe('m')
    expect(defaultAccount([main, research], 'gym')).toBe('r')
    expect(defaultAccount([main], 'gym')).toBe('m')
    expect(defaultAccount([account('m', 'main', 0, 0, 'needs-login'), research], 'mkt')).toBe('r')
  })

  it('suggests research for monorepo work when main is low on headroom in either window', () => {
    expect(accountHint([main, research], 'm', 'mkt')).toBeUndefined()
    expect(accountHint([account('m', 'main', 86), research], 'm', 'mob')).toEqual({ accountId: 'r', text: 'main is at 86% of its limit. Run this on research; it keeps its department.' })
    expect(accountHint([account('m', 'main', 20, 93), research], 'm', 'plat')?.accountId).toBe('r')
  })

  it('stays quiet for side projects, when research has no more room, or when research is already chosen', () => {
    const tight = account('m', 'main', 90)
    expect(accountHint([tight, research], 'm', 'side')).toBeUndefined()
    expect(accountHint([tight, account('r', 'research', 95)], 'm', 'mkt')).toBeUndefined()
    expect(accountHint([tight, account('r', 'research', 5, 0, 'needs-login')], 'm', 'mkt')).toBeUndefined()
    expect(accountHint([tight, research], 'r', 'mkt')).toBeUndefined()
  })
})

describe('continue on the other account', () => {
  let dir: string
  let office: ReturnType<typeof openOffice>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-office-continue-'))
    office = openOffice(dir)
  })

  afterEach(() => {
    office.db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function rateLimited(account: string, folder: string) {
    mkdirSync(folder, { recursive: true })
    const id = office.start('Czechia auction visibility', account, folder)
    office.engine.init(id)
    office.engine.emit(id, sdk.apiError('rate_limit'))
    office.engine.emit(id, sdk.errorResult('You’ve hit your usage limit'))
    office.engine.exit(id, 'Claude Code returned an error result: You’ve hit your usage limit')
    expect(office.chat(id).stuck?.reason).toBe('rate-limited')
    return id
  }

  it('forks a rate-limited chat under the other account’s token, keeps its department and walks it back to work', () => {
    const id = rateLimited('main', join(dir, 'monorepo/frontend/marketplace'))
    const original = office.chat(id).sessionId
    expect(office.store.continueOnAccount(id, 'research')).toBeUndefined()
    expect(office.engine.starts.at(-1)?.options).toMatchObject({ accountId: 'research', resume: original, forkSession: true })
    expect(office.engine.sent.at(-1)).toEqual({ chatId: id, text: 'Continue where you left off.' })
    expect(office.chat(id)).toMatchObject({ accountId: 'research', department: 'mkt', state: 'working' })
    office.engine.init(id)
    expect(office.chat(id).sessionId).not.toBe(original)
    expect(office.db.listChats()[0]).toMatchObject({ accountId: 'research', department: 'mkt' })
  })

  it('moves a gym chat to its folder’s department when it continues on main', () => {
    const id = rateLimited('research', join(dir, 'enigma-rsa'))
    expect(office.chat(id).department).toBe('gym')
    office.store.continueOnAccount(id, 'main')
    expect(office.chat(id)).toMatchObject({ accountId: 'main', department: 'side' })
  })

  it('refuses an account that needs login, and ignores the same account or a chat that is not stuck', () => {
    const id = rateLimited('main', join(dir, 'monorepo'))
    office.loggedOut.add('research')
    expect(office.store.continueOnAccount(id, 'research')).toMatchObject({ code: 'needs-login' })
    expect(office.store.continueOnAccount(id, 'main')).toBeUndefined()
    expect(office.chat(id)).toMatchObject({ accountId: 'main', state: 'stuck' })
  })
})
