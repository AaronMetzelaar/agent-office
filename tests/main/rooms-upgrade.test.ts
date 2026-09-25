import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../../src/main/departments/config'
import { upgradeRooms } from '../../src/main/departments/upgrade'
import { openDb, type Db } from '../../src/main/store/db'
import { emptyUsage } from '../../src/shared/chat'
import { claudeWorktree, gitRepo, mwsMonorepo } from '../fakes/repos'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let configDir: string
let db: Db

const file = () => join(configDir, 'departments.json')
const departments = () => Object.fromEntries(db.listChats().map((chat) => [chat.id, chat.department]))
const seed = (...chats: [cwd: string, department: string][]) =>
  chats.forEach(([cwd, department], index) =>
    db.saveChat({ id: `chat-${index}`, accountId: 'main', cwd, title: `Chat ${index}`, department, state: 'idle', archived: false, unread: false, createdAt: index, lastActivityAt: index, usage: emptyUsage() }),
  )
const legacy = {
  rooms: [{ name: 'Research gym', account: 'research', look: 'gym', accent: '#0d9488' }],
  playground: ['/'],
  commands: { ship: ['/mws-test-cases', '/mws-verify', '/mws-review', '/mws-pr'], fixCi: '/gh-fix-ci', answerComments: '/pr-comment-rundown', review: '/pr-review-rundown' },
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-upgrade-')))
  configDir = join(dir, 'config', 'agent-office')
  db = openDb(join(dir, 'office.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('the one-time rooms upgrade', { timeout: 60_000 }, () => {
  it('writes the legacy config, records the monorepo, moves gym chats to the Research gym and sets the marker', () => {
    const mono = mwsMonorepo(join(dir, 'monorepo'))
    const tree = claudeWorktree(mono, 'bid-flow')
    seed([join(tree, 'frontend', 'marketplace'), 'mkt'], [mono, 'plat'], [join(dir, 'notes'), 'gym'], [join(dir, 'blog'), 'side'], [join(dir, 'papers'), 'gym'])
    upgradeRooms(db, ['main', 'Research'], configDir)
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual(legacy)
    expect(loadConfig(configDir)).toMatchObject({ config: { rooms: [{ id: 'c-research-gym', account: 'research', look: 'gym' }], playground: ['/'] }, skipped: [] })
    expect(readdirSync(configDir)).toEqual(['departments.json'])
    expect(statSync(configDir).mode & 0o777).toBe(0o700)
    expect(db.setting('mwsRoots')).toEqual([mono])
    expect(departments()).toEqual({ 'chat-0': 'mkt', 'chat-1': 'plat', 'chat-2': 'c-research-gym', 'chat-3': 'side', 'chat-4': 'c-research-gym' })
    expect(db.setting('roomsVersion')).toBe(1)
  })

  it('writes the legacy config for a research account alone', () => {
    upgradeRooms(db, ['Claude-research'], configDir)
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual(legacy)
  })

  it('writes no config for one non-research account, but still records a confirmed MWS monorepo', () => {
    const mono = mwsMonorepo(join(dir, 'code', 'mws'))
    seed([mono, 'plat'], [join(dir, 'blog'), 'side'])
    upgradeRooms(db, ['main'], configDir)
    expect(existsSync(file())).toBe(false)
    expect(db.setting('mwsRoots')).toEqual([mono])
    expect(db.setting('roomsVersion')).toBe(1)
  })

  it('records no root for MWS chats in folders that only happen to be called monorepo', () => {
    const plain = gitRepo(join(dir, 'monorepo'), { 'frontend/marketplace/.gitkeep': '' })
    const bare = join(dir, 'old', 'monorepo')
    mkdirSync(bare, { recursive: true })
    seed([plain, 'plat'], [bare, 'mkt'])
    upgradeRooms(db, ['main'], configDir)
    expect(db.setting('mwsRoots')).toEqual([])
  })

  it('writes no config for an install with no chats', () => {
    upgradeRooms(db, ['main', 'work'], configDir)
    expect(existsSync(file())).toBe(false)
    expect(db.setting('roomsVersion')).toBe(1)
  })

  it('leaves an existing config file untouched', () => {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(file(), '{ "rooms": [] }\n')
    seed([join(dir, 'notes'), 'gym'])
    upgradeRooms(db, ['research'], configDir)
    expect(readFileSync(file(), 'utf8')).toBe('{ "rooms": [] }\n')
    expect(departments()).toEqual({ 'chat-0': 'c-research-gym' })
  })

  it('changes nothing on a later start once the marker is set', () => {
    upgradeRooms(db, ['main'], configDir)
    seed([join(dir, 'notes'), 'gym'])
    upgradeRooms(db, ['research'], configDir)
    expect(existsSync(file())).toBe(false)
    expect(departments()).toEqual({ 'chat-0': 'gym' })
  })

  it('re-runs cleanly after a crash between writing the config and setting the marker', () => {
    seed([join(dir, 'notes'), 'gym'], [join(dir, 'blog'), 'side'])
    const crashing = {
      ...db,
      saveChat: () => {
        throw new Error('host crashed')
      },
    }
    expect(() => upgradeRooms(crashing, ['main'], configDir)).toThrow('host crashed')
    expect(db.setting('roomsVersion')).toBeUndefined()
    const written = readFileSync(file(), 'utf8')
    upgradeRooms(db, ['main'], configDir)
    expect(readFileSync(file(), 'utf8')).toBe(written)
    expect(departments()).toEqual({ 'chat-0': 'c-research-gym', 'chat-1': 'side' })
    expect(db.setting('roomsVersion')).toBe(1)
  })
})
