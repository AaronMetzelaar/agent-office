import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlacement, loadRules } from '../../src/main/departments/classifier'
import { defaultRules, ruleFor, showsAccountBadge } from '../../src/shared/departments'
import { sdk } from '../fakes/fake-engine'
import { openOffice } from '../fakes/office'

vi.mock('electron', async () => await import('../fakes/electron'))

let dir: string
let office: ReturnType<typeof openOffice>
let open: string | undefined
let placement: ReturnType<typeof createPlacement>
const monorepo = () => join(dir, 'monorepo')
const mkt = (file = 'components/BidFlow.vue') => join(monorepo(), 'frontend/marketplace', file)
const mob = (file = 'src/screens/Bids.tsx') => join(monorepo(), 'frontend/mobile', file)

const tool = (name: string, input: Record<string, unknown>) => ({ id: randomUUID(), name, input })
const read = (file_path: string) => tool('Read', { file_path })
const edit = (file_path: string) => tool('Edit', { file_path })
const touch = (chatId: string, ...tools: ReturnType<typeof tool>[]) => office.engine.emit(chatId, sdk.toolUse(tools))
const repeat = (times: number, act: () => void) => Array.from({ length: times }).forEach(act)
const department = (chatId: string) => office.chat(chatId).department

function startIn(folder: string, account = 'main', options?: object) {
  mkdirSync(folder, { recursive: true })
  const result = office.store.start(account, folder, 'Fix the bid flow', undefined, undefined, options)
  if ('error' in result) throw new Error(result.error)
  office.engine.init(result.chatId)
  return result.chatId
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-classifier-'))
  office = openOffice(dir)
  open = undefined
  placement = createPlacement(office.engine, office.store, defaultRules, (chatId) => chatId === open)
})

afterEach(() => {
  office.db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('department placement', () => {
  it('places a monorepo chat whose file events are mostly under frontend/marketplace in Marketplace, and saves the department', () => {
    const id = startIn(monorepo())
    expect(department(id)).toBe('plat')
    touch(id, edit(mkt()), read(mkt('pages/index.vue')))
    expect(department(id)).toBe('plat')
    touch(id, read(mkt('stores/bids.ts')))
    expect(department(id)).toBe('mkt')
    expect(office.db.listChats().find((record) => record.id === id)?.department).toBe('mkt')
  })

  it('ignores one stray mobile read, and moves only when a shift holds 60% on two evaluations in a row', () => {
    const id = startIn(join(monorepo(), 'frontend/marketplace'))
    repeat(10, () => touch(id, read(mkt())))
    touch(id, read(mob()))
    expect(department(id)).toBe('mkt')
    repeat(5, () => touch(id, edit(mob())))
    expect(department(id)).toBe('mkt')
    touch(id, edit(mob()))
    expect(department(id)).toBe('mob')
  })

  it('keeps a chat where it is when its work splits evenly between two departments', () => {
    const id = startIn(monorepo())
    repeat(12, () => {
      touch(id, edit(mkt()))
      touch(id, edit(mob()))
    })
    expect(department(id)).toBe('plat')
  })

  it('counts subagent activity toward the parent, and ignores files outside the rules and the chat folder', () => {
    const id = startIn(monorepo())
    repeat(4, () => office.engine.emit(id, sdk.toolUse([tool('Glob', { pattern: '*.tsx', path: join(monorepo(), 'frontend/mobile') })], 'agent-1')))
    expect(department(id)).toBe('mob')
    repeat(10, () => touch(id, read(join(dir, 'elsewhere/notes.md')), tool('Grep', { pattern: 'bid' })))
    expect(department(id)).toBe('mob')
  })

  it('holds a move while the chat is queued at your door, and makes it once the chat is released', async () => {
    const id = startIn(join(monorepo(), 'frontend/marketplace'))
    const asked = office.engine.ask(id, 'Bash', { command: 'pnpm test' })
    expect(office.chat(id).state).toBe('needs-you')
    repeat(3, () => touch(id, edit(mob())))
    expect(department(id)).toBe('mkt')
    office.broker.resolveRequest(office.chat(id).pendingRequests[0]!.id, { kind: 'allow' }, 'chat')
    await asked
    expect(office.chat(id).state).toBe('working')
    expect(department(id)).toBe('mob')
  })

  it('holds a move while the chat’s panel is open', () => {
    const id = startIn(join(monorepo(), 'frontend/marketplace'))
    open = id
    repeat(3, () => touch(id, edit(mob())))
    placement.release()
    expect(department(id)).toBe('mkt')
    open = undefined
    placement.release()
    expect(department(id)).toBe('mob')
  })
})

describe('the research account', () => {
  it('always lives in the gym, whatever files it touches', () => {
    const id = startIn(join(dir, 'enigma-rsa'), 'research')
    expect(department(id)).toBe('gym')
    repeat(6, () => touch(id, edit(mkt())))
    expect(department(id)).toBe('gym')
  })

  it('keeps the department an overflow chat was started in, with an account badge', () => {
    const id = startIn(join(monorepo(), 'frontend/marketplace'), 'research', { dept: 'mkt' })
    expect(department(id)).toBe('mkt')
    expect(showsAccountBadge('mkt', true)).toBe(true)
    expect(showsAccountBadge('gym', true)).toBe(false)
    expect(showsAccountBadge('mkt', false)).toBe(false)
  })
})

describe('path rules', () => {
  it('maps worktrees to their repository and prefers the most specific rule', () => {
    expect(ruleFor('/Users/a/Documents/GitHub/monorepo/.claude/worktrees/auc-1302/frontend/mobile/App.tsx')).toBe('mob')
    expect(ruleFor('/Users/a/Documents/GitHub/monorepo/services/api')).toBe('plat')
    expect(ruleFor('/Users/a/Documents/GitHub/monorepo-tools/x')).toBeUndefined()
    expect(ruleFor('/x/monorepo/frontend/admin', [{ path: 'monorepo', dept: 'plat' }, { path: 'monorepo/frontend/admin', dept: 'adm' }])).toBe('adm')
  })

  it('reads editable rules from departments.json, and falls back to the defaults when the file is missing or invalid', () => {
    expect(loadRules(dir)).toEqual(defaultRules)
    writeFileSync(join(dir, 'departments.json'), JSON.stringify([{ path: 'cookbook', dept: 'side' }, { path: 'research', dept: 'gym' }, { path: 'x', dept: 'nope' }]))
    expect(loadRules(dir)).toEqual([{ path: 'cookbook', dept: 'side' }, { path: 'research', dept: 'gym' }])
    writeFileSync(join(dir, 'departments.json'), '{ not json')
    expect(loadRules(dir)).toEqual(defaultRules)
  })
})
