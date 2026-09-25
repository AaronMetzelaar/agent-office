import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { classify, newTally } from '../../src/main/departments/classifier'
import { loadConfig } from '../../src/main/departments/config'
import { createRooms, type Rooms } from '../../src/main/departments/rooms'
import { upgradeRooms } from '../../src/main/departments/upgrade'
import { openDb, type Db } from '../../src/main/store/db'
import { emptyUsage } from '../../src/shared/chat'
import type { DeptId } from '../../src/shared/departments'
import { claudeWorktree, gitRepo, mwsMonorepo } from '../fakes/repos'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let db: Db
let rooms: Rooms

const at = (path: string) => join(dir, path)
const today = (dept: string) => (dept === 'gym' ? 'c-research-gym' : dept)
const mono = 'home/Documents/GitHub/monorepo'
const monoTree = `${mono}/.claude/worktrees/bid-flow`
const office = 'home/Documents/GitHub/agent-office'
const officeTree = `${office}/.claude/worktrees/rooms`
const legacyChats: [cwd: string, account: string, department: string][] = [
  [`${monoTree}/frontend/marketplace`, 'main', 'mkt'],
  [mono, 'main', 'plat'],
  ['home/notes', 'research', 'gym'],
  [office, 'main', 'side'],
  ['tmp/scratch', 'main', 'side'],
]

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-parity-')))
  vi.stubEnv('HOME', gitRepo(at('home')))
  mkdirSync(at('home/notes'))
  claudeWorktree(mwsMonorepo(at(mono)), 'bid-flow')
  claudeWorktree(gitRepo(at(office)), 'rooms')
  gitRepo(at('tmp/scratch'))
  mkdirSync(at(`${mono}/services/api`), { recursive: true })
  mkdirSync(at(`${office}/src`), { recursive: true })
  db = openDb(at('office.db'))
  legacyChats.forEach(([cwd, accountId, department], index) =>
    db.saveChat({ id: `chat-${index}`, accountId, cwd: at(cwd), title: `Chat ${index}`, department, state: 'idle', archived: false, unread: false, createdAt: index, lastActivityAt: index, usage: emptyUsage() }),
  )
  upgradeRooms(db, ['main', 'research'], at('config'))
  rooms = createRooms(db, loadConfig(at('config')), () => db.listChats().flatMap((chat) => (chat.department ? [chat.department] : [])))
}, 60_000)

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('Aaron’s office after the upgrade', () => {
  it('shows today’s rooms in today’s order', () => {
    expect(rooms.list().map((room) => [room.name, room.accent])).toEqual([
      ['Marketplace', 0x1b34ff],
      ['Admin', 0xdb2777],
      ['Mobile', 0x16a34a],
      ['Backend / infra', 0x7c3aed],
      ['PR reviews', 0x854d0e],
      ['Research gym', 0x0d9488],
      ['Side projects', 0xea580c],
    ])
  })

  it('keeps every stored chat where it is', () => {
    const stored = db.listChats().map((chat) => [chat.cwd, chat.department, rooms.revalidate(chat, chat.accountId)])
    expect(stored).toEqual(legacyChats.map(([cwd, , department]) => [at(cwd), today(department), undefined]))
  })

  it.each([
    [mono, 'main', 'plat'],
    [`${mono}/frontend/marketplace`, 'main', 'mkt'],
    [`${mono}/frontend/admin`, 'main', 'adm'],
    [`${mono}/frontend/mobile`, 'main', 'mob'],
    [`${mono}/services/api`, 'main', 'plat'],
    [monoTree, 'main', 'plat'],
    [`${monoTree}/frontend/marketplace`, 'main', 'mkt'],
    [`${monoTree}/frontend/admin`, 'main', 'adm'],
    [office, 'main', 'side'],
    [`${office}/src`, 'main', 'side'],
    [officeTree, 'main', 'side'],
    ['tmp/scratch', 'main', 'side'],
    ['home/notes', 'main', 'side'],
    ['home', 'main', 'side'],
    [`${mono}/frontend/marketplace`, 'research', 'gym'],
    [office, 'research', 'gym'],
  ])('starts a new chat in %s on %s where today’s office puts it (%s)', (cwd, account, dept) => {
    expect(rooms.resolve(at(cwd), account, { build: true })).toBe(today(dept))
    expect(rooms.list()).toHaveLength(7)
  })

  it.each([
    ['a monorepo worktree chat editing marketplace files', monoTree, Array(3).fill(`${monoTree}/frontend/marketplace/pages/index.vue`), [undefined, 'mkt', 'mkt']],
    ['a monorepo worktree chat editing services', monoTree, [`${monoTree}/services/api/bids.ts`, `${office}/src/a.ts`, `${monoTree}/services/api/bids.ts`], [undefined, undefined, 'plat']],
    ['an agent-office chat editing its own files, then marketplace files', office, [`${office}/src/a.ts`, ...Array(3).fill(`${mono}/frontend/marketplace/pages/index.vue`)], [undefined, undefined, undefined, 'mkt']],
    ['an agent-office worktree chat editing its own files and a scratch repo', officeTree, [`${officeTree}/src/a.ts`, 'tmp/scratch/a.ts', `${officeTree}/src/b.ts`], [undefined, undefined, 'side']],
  ])('gives today’s classifier moves for %s', (_, cwd, files, moves) => {
    const tally = newTally()
    const replayed = files.map((file: string) => {
      const room = rooms.evidenceRoom(at(file), at(cwd))
      return classify(tally, room ? [{ dept: room as DeptId, weight: 3 }] : [])
    })
    expect(replayed).toEqual(moves)
  })
})
