import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultEffort, defaultModel } from '../../src/shared/chat'
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
    expect(defaultAccount([account('m', 'main', 100), research], 'mkt')).toBe('r')
    expect(defaultAccount([account('m', 'main', 0, 100), research], 'mkt')).toBe('r')
    expect(defaultAccount([account('m', 'main', 100), account('r', 'research', 100)], 'mkt')).toBe('m')
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

  it('forks a rate-limited chat into a new chat under the other account’s token and parks the original', () => {
    const id = rateLimited('main', join(dir, 'monorepo/frontend/marketplace'))
    const original = office.chat(id).sessionId
    office.store.setPlanMode(id, true)
    const result = office.store.continueOnAccount(id, 'research')
    if (!result || !('chatId' in result)) throw new Error('expected a new chat')
    expect(result.chatId).not.toBe(id)
    expect(office.engine.starts.at(-1)).toMatchObject({ chatId: result.chatId, options: { accountId: 'research', resume: original, forkSession: true, permissionMode: 'plan' } })
    expect(office.engine.sent.at(-1)).toEqual({ chatId: result.chatId, text: 'Continue where you left off.' })
    expect(office.chat(result.chatId)).toMatchObject({ accountId: 'research', department: 'mkt', title: 'Czechia auction visibility', state: 'starting' })
    expect(office.chat(result.chatId).rows[0]).toMatchObject({ kind: 'user', text: 'Czechia auction visibility' })
    expect(office.chat(id)).toMatchObject({ accountId: 'main', state: 'idle', parked: true, stuck: undefined, sessionId: original })
    expect(office.chat(id).rows.at(-1)).toMatchObject({ kind: 'other', label: 'Continued on research in a new chat' })
    office.engine.init(result.chatId)
    expect(office.chat(result.chatId).sessionId).not.toBe(original)
    expect(office.db.listChats().find((record) => record.id === id)).toMatchObject({ parked: true, state: 'idle' })
  })

  it('moves a gym chat to its folder’s department when it continues on main', () => {
    const id = rateLimited('research', join(dir, 'enigma-rsa'))
    expect(office.chat(id).department).toBe('gym')
    const result = office.store.continueOnAccount(id, 'main')
    if (!result || !('chatId' in result)) throw new Error('expected a new chat')
    expect(office.chat(result.chatId)).toMatchObject({ accountId: 'main', department: 'side' })
    expect(office.chat(id)).toMatchObject({ accountId: 'research', department: 'gym', parked: true })
  })

  it('refuses an account that needs login, and ignores the same account or a chat that is not stuck', () => {
    const id = rateLimited('main', join(dir, 'monorepo'))
    office.loggedOut.add('research')
    expect(office.store.continueOnAccount(id, 'research')).toMatchObject({ code: 'needs-login' })
    expect(office.store.continueOnAccount(id, 'main')).toBeUndefined()
    expect(office.chat(id)).toMatchObject({ accountId: 'main', state: 'stuck' })
  })
})

describe('model and effort defaults', () => {
  let dir: string
  let office: ReturnType<typeof openOffice>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-office-defaults-'))
    office = openOffice(dir)
  })

  afterEach(() => {
    office.db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const started = (model?: unknown, effort?: unknown) => {
    const result = office.store.start('main', dir, 'Fix the bid flow', model, effort)
    if (!('chatId' in result)) throw new Error(result.error)
    return result.chatId
  }

  it('starts every chat on Opus 5.5 at medium effort when nothing is picked, and an empty or "default" model means the same', () => {
    for (const [model, effort] of [[undefined, undefined], ['', ''], ['default', undefined]]) {
      const id = started(model, effort)
      expect(office.chat(id)).toMatchObject({ model: defaultModel, effort: 'medium' })
      expect(office.engine.starts.find((start) => start.chatId === id)?.options).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium' })
    }
    expect(defaultEffort).toBe('medium')
  })

  it('keeps a model and effort picked for one agent, and an effort changed mid-chat survives the next session start', async () => {
    const picked = started('sonnet', 'high')
    expect(office.engine.starts.at(-1)).toMatchObject({ chatId: picked, options: { model: 'sonnet', effort: 'high' } })

    const id = started()
    office.engine.init(id)
    office.engine.emit(id, sdk.result())
    await office.store.setEffort(id, 'low')
    office.store.stopChat(id)
    office.store.sendMessage(id, 'Now the tests')
    expect(office.engine.starts.at(-1)).toMatchObject({ chatId: id, options: { effort: 'low' } })
    expect(office.chat(id).effort).toBe('low')
  })

  it('falls back to Opus 5.5 for a chat saved without a model, never to the CLI default', () => {
    const id = started()
    office.store.stopChat(id)
    office.db.saveChat({ ...office.db.listChats().find((record) => record.id === id)!, model: undefined, state: 'idle' })
    const reopened = openOffice(dir, office.engine)
    expect(reopened.chat(id).model).toBeUndefined()
    reopened.store.sendMessage(id, 'Carry on')
    expect(office.engine.starts).toHaveLength(2)
    expect(office.engine.starts.at(-1)).toMatchObject({ chatId: id, options: { model: 'claude-opus-5-5' } })
    reopened.db.close()
  })
})
