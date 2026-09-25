import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, type LoadedConfig } from '../../src/main/departments/config'
import { createRooms } from '../../src/main/departments/rooms'
import { openDb, type Db } from '../../src/main/store/db'
import type { ConfigRoom } from '../../src/shared/departments'
import { palette } from '../../src/shared/office'
import { claudeWorktree, gitRepo, mwsMonorepo, worktree } from '../fakes/repos'

vi.mock('electron', () => import('../fakes/electron'))

let dir: string
let elsewhere: string
let db: Db
let occupied: string[]

const loaded = ({ rooms = [], playground = [] }: { rooms?: ConfigRoom[]; playground?: string[] } = {}, unreadable?: string): LoadedConfig => ({
  config: { rooms, playground, commands: {} },
  skipped: [],
  ...(unreadable ? { unreadable } : {}),
})
const open = (config = loaded()) => createRooms(db, config, () => occupied)
const ids = (rooms: ReturnType<typeof open>) => rooms.list().map((room) => room.id)
const folder = (path: string) => {
  mkdirSync(path, { recursive: true })
  return path
}
const gym: ConfigRoom = { id: 'c-research-gym', name: 'Research gym', account: 'research', look: 'gym' }

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-rooms-')))
  elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-rooms-linked-')))
  db = openDb(join(dir, 'office.db'))
  occupied = []
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  rmSync(elsewhere, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('a chat’s room', { timeout: 60_000 }, () => {
  it('builds a plain room named after a new repo, and gives its worktrees the same room', () => {
    const rooms = open()
    const changed = vi.fn()
    rooms.events.on('changed', changed)
    const repo = gitRepo(join(dir, 'shop'))
    const id = rooms.resolve(repo, 'main', { build: true })
    expect(rooms.byId(id)).toEqual({ id: expect.stringMatching(/^r-[0-9a-f]{10}$/), name: 'shop', subtitle: repo, accent: palette[0], look: 'plain', root: repo, parent: basename(dir), createdAt: expect.any(Number) })
    expect(rooms.resolve(folder(join(claudeWorktree(repo, 'x'), 'src')), 'main', { build: true })).toBe(id)
    expect(rooms.resolve(worktree(repo, join(elsewhere, 'bid-flow')), 'main', { build: true })).toBe(id)
    expect(changed).toHaveBeenCalledOnce()
    expect(open().byId(id)?.name).toBe('shop')
  })

  it('puts a folder outside git on the playground', () => {
    expect(open().resolve(folder(join(dir, 'notes')), 'main', { build: true })).toBe('side')
  })

  it('sends a review chat to PR reviews whatever its folder or choice', () => {
    const mono = mwsMonorepo(join(dir, 'monorepo'))
    expect(open().resolve(join(mono, 'frontend', 'admin'), 'main', { review: true, chosen: 'side', build: true })).toBe('rev')
  })

  it('gives an account-tied room to that account’s chats, even inside a config folder room', () => {
    const repo = gitRepo(join(dir, 'lab'))
    const rooms = open(loaded({ rooms: [{ id: 'c-lab', name: 'Lab', folders: [repo] }, gym] }))
    expect(rooms.resolve(repo, 'Claude-Research', { build: true })).toBe('c-research-gym')
    expect(rooms.resolve(repo, 'main', { build: true })).toBe('c-lab')
    expect(rooms.isTied('c-research-gym')).toBe(true)
    expect(rooms.isTied('c-lab')).toBe(false)
  })

  it('ties an account label to the room with the longest matching account text', () => {
    const rooms = open(loaded({ rooms: [{ id: 'c-main', name: 'Main', account: 'main' }, { id: 'c-domain', name: 'Domain', account: 'DOMAIN' }] }))
    expect(rooms.tiedRoom('Claude-Domain')).toBe('c-domain')
    expect(rooms.tiedRoom('main')).toBe('c-main')
    expect(rooms.tiedRoom('work')).toBeUndefined()
    expect(rooms.tiedRoom(undefined)).toBeUndefined()
  })

  it('lets a room chosen at start win over everything but review, when it exists', () => {
    const repo = gitRepo(join(dir, 'lab'))
    const rooms = open(loaded({ rooms: [gym] }))
    expect(rooms.resolve(repo, 'research', { chosen: 'side', build: true })).toBe('side')
    expect(rooms.resolve(repo, 'research', { chosen: 'c-gone', build: true })).toBe('c-research-gym')
  })

  it('registers the MWS rooms when a chat starts in the monorepo, and places its folders', () => {
    const mono = mwsMonorepo(join(dir, 'monorepo'))
    const rooms = open()
    const changed = vi.fn()
    rooms.events.on('changed', changed)
    expect(ids(rooms)).toEqual(['side', 'rev'])
    expect(rooms.resolve(folder(join(mono, 'frontend', 'admin', 'x')), 'main', { build: true })).toBe('adm')
    expect(rooms.resolve(mono, 'main', { build: true })).toBe('plat')
    expect(ids(rooms)).toEqual(['mkt', 'adm', 'mob', 'plat', 'side', 'rev'])
    expect(changed).toHaveBeenCalledOnce()
    expect(db.setting('mwsRoots')).toEqual([mono])
  })

  it('places monorepo worktrees, in .claude/worktrees or linked elsewhere, by their MWS folder', () => {
    const mono = mwsMonorepo(join(dir, 'monorepo'))
    const rooms = open()
    expect(rooms.resolve(join(claudeWorktree(mono, 'x'), 'frontend', 'admin'), 'main')).toBe('adm')
    expect(rooms.resolve(join(worktree(mono, join(elsewhere, 'bid-flow')), 'frontend', 'marketplace'), 'main')).toBe('mkt')
  })

  it.each(['/', '~'])('still finds the monorepo on a fresh registry when the playground is %s', (playground) => {
    vi.stubEnv('HOME', dir)
    writeFileSync(join(dir, 'departments.json'), JSON.stringify({ playground: [playground] }))
    const mono = mwsMonorepo(join(dir, 'monorepo'))
    const rooms = open(loadConfig(dir))
    expect(rooms.resolve(join(mono, 'frontend', 'admin'), 'main', { build: true })).toBe('adm')
    expect(db.setting('mwsRoots')).toEqual([mono])
    expect(rooms.resolve(gitRepo(join(dir, 'shop')), 'main', { build: true })).toBe('side')
    expect(ids(rooms)).toEqual(['mkt', 'adm', 'mob', 'plat', 'side', 'rev'])
  })

  it('lets a config room for a monorepo folder beat its MWS room', () => {
    const mono = mwsMonorepo(join(dir, 'monorepo'))
    const rooms = open(loaded({ rooms: [{ id: 'c-console', name: 'Console', folders: [join(mono, 'frontend', 'admin')] }] }))
    expect(rooms.resolve(join(mono, 'frontend', 'admin'), 'main')).toBe('c-console')
    expect(rooms.resolve(join(mono, 'frontend', 'mobile'), 'main')).toBe('mob')
  })

  it('gives two repos with the same folder name two rooms with the same name and different parents', () => {
    const rooms = open()
    const work = rooms.resolve(gitRepo(join(dir, 'work', 'api')), 'main', { build: true })
    const home = rooms.resolve(gitRepo(join(dir, 'home', 'api')), 'main', { build: true })
    expect(work).not.toBe(home)
    expect([rooms.byId(work), rooms.byId(home)]).toMatchObject([
      { name: 'api', parent: 'work', accent: palette[0] },
      { name: 'api', parent: 'home', accent: palette[1] },
    ])
  })

  it('gives a moved repo a new room', () => {
    const rooms = open()
    const before = rooms.resolve(gitRepo(join(dir, 'old', 'shop')), 'main', { build: true })
    renameSync(join(dir, 'old'), join(dir, 'new'))
    const after = rooms.resolve(join(dir, 'new', 'shop'), 'main', { build: true })
    expect(after).not.toBe(before)
    expect(rooms.list().filter((room) => room.name === 'shop')).toHaveLength(2)
  })

  it('treats a folder inside a repo at the home folder as outside git', () => {
    const home = gitRepo(join(dir, 'home'))
    vi.stubEnv('HOME', home)
    expect(open().resolve(folder(join(home, 'notes')), 'main', { build: true })).toBe('side')
  })

  it('builds nothing while the config is unreadable', () => {
    const rooms = open(loaded({}, 'Unexpected token } in JSON'))
    expect(rooms.resolve(gitRepo(join(dir, 'shop')), 'main', { build: true })).toBe('side')
    expect(ids(rooms)).toEqual(['side', 'rev'])
    expect(db.setting('rooms')).toBeUndefined()
  })

  it('creates nothing without build, and previews the room a new chat would get', () => {
    const rooms = open()
    const repo = gitRepo(join(dir, 'shop'))
    expect(rooms.resolve(repo, 'main')).toBe('side')
    expect(rooms.resolve(repo, 'main', { build: false })).toBe('side')
    expect(rooms.roomFor(repo, 'main')).toMatchObject({ name: 'shop', look: 'plain', accent: palette[0], isNew: true })
    expect(ids(rooms)).toEqual(['side', 'rev'])
    const id = rooms.resolve(repo, 'main', { build: true })
    expect(rooms.resolve(repo, 'main')).toBe(id)
    expect(rooms.roomFor(repo, 'main')).toEqual(rooms.byId(id))
  })

  it('orders MWS rooms, the playground, PR reviews, config rooms, then built rooms oldest first, as the office does today', () => {
    const mono = mwsMonorepo(join(dir, 'monorepo'))
    const config = loaded({ rooms: [{ id: 'c-zoo', name: 'Zoo', folders: ['/zoo'] }, gym] })
    const rooms = open(config)
    const zeta = rooms.resolve(gitRepo(join(dir, 'zeta')), 'main', { build: true })
    const alpha = rooms.resolve(gitRepo(join(dir, 'alpha')), 'main', { build: true })
    rooms.resolve(mono, 'main')
    const order = ['mkt', 'adm', 'mob', 'plat', 'side', 'rev', 'c-zoo', 'c-research-gym', zeta, alpha]
    expect(ids(rooms)).toEqual(order)
    expect(ids(open(config))).toEqual(order)
  })
})

describe('accents', { timeout: 60_000 }, () => {
  it('uses every palette colour once, then still gives the next room one, never a colour a room with chats has while a free one exists', () => {
    const rooms = open()
    const built = palette.map((_, index) => rooms.resolve(gitRepo(join(dir, `repo-${index}`)), 'main', { build: true }))
    expect(built.map((id) => rooms.byId(id)?.accent)).toEqual([...palette])
    const extra = rooms.resolve(gitRepo(join(dir, 'extra')), 'main', { build: true })
    expect(rooms.byId(extra)?.accent).toBe(palette[0])
    occupied = built.filter((_, index) => index !== 3)
    const next = rooms.resolve(gitRepo(join(dir, 'next')), 'main', { build: true })
    expect(rooms.byId(next)?.accent).toBe(palette[3])
  })

  it('gives config rooms their own accent, or a palette colour no other room uses', () => {
    const rooms = open(loaded({ rooms: [{ id: 'c-api', name: 'API', folders: ['/srv/api'] }, { id: 'c-web', name: 'Web', folders: ['/srv/web'], accent: '#f0463c', look: 'showroom' }] }))
    expect(rooms.byId('c-api')).toEqual({ id: 'c-api', name: 'API', subtitle: '/srv/api', accent: palette[1], look: 'plain' })
    expect(rooms.byId('c-web')).toMatchObject({ accent: 0xf0463c, look: 'showroom' })
  })
})

describe('placement evidence', { timeout: 60_000 }, () => {
  it('counts monorepo files for their MWS room from the root or a worktree, a built room’s files for it, and nothing for a repo without a room', () => {
    const mono = mwsMonorepo(join(dir, 'monorepo'))
    const tree = claudeWorktree(mono, 'x')
    const shop = gitRepo(join(dir, 'shop'))
    const other = gitRepo(join(dir, 'other'))
    const rooms = open(loaded({ playground: ['/'] }))
    rooms.resolve(mono, 'main')
    const page = join('frontend', 'marketplace', 'pages', 'index.vue')
    expect(rooms.evidenceRoom(join(mono, page), mono)).toBe('mkt')
    expect(rooms.evidenceRoom(join(tree, page), tree)).toBe('mkt')
    expect(rooms.evidenceRoom(join(tree, page), mono)).toBe('mkt')
    expect(rooms.evidenceRoom(join(tree, 'services', 'api', 'bids.ts'), tree)).toBe('plat')
    expect(rooms.evidenceRoom(join(other, 'src', 'a.ts'), mono)).toBeUndefined()
    expect(rooms.evidenceRoom(join(shop, 'src', 'a.ts'), mono)).toBeUndefined()
    const built = open().resolve(shop, 'main', { build: true })
    expect(open().evidenceRoom(join(shop, 'src', 'a.ts'), mono)).toBe(built)
    expect(open(loaded({ rooms: [{ id: 'c-code', name: 'Code', folders: [dir] }] })).evidenceRoom(join(shop, 'src', 'a.ts'), mono)).toBe('c-code')
  })

  it('counts files in a non-git chat folder for the playground, even for a chat on a tied account', () => {
    const notes = folder(join(dir, 'notes'))
    const rooms = open(loaded({ rooms: [gym] }))
    expect(rooms.resolve(notes, 'research')).toBe('c-research-gym')
    expect(rooms.evidenceRoom(join(notes, 'paper.md'), notes)).toBe('side')
    expect(rooms.evidenceRoom(join(elsewhere, 'paper.md'), notes)).toBeUndefined()
  })

  it('matches realpathed room roots for a chat whose folder sits under a symlink', () => {
    const repo = gitRepo(join(dir, 'shop'))
    const link = join(elsewhere, 'link')
    symlinkSync(dir, link)
    const cwd = join(link, 'shop')
    const rooms = open()
    const id = rooms.resolve(cwd, 'main', { build: true })
    expect(rooms.byId(id)?.root).toBe(repo)
    expect(rooms.evidenceRoom(join(cwd, 'src', 'app.ts'), cwd)).toBe(id)
  })
})

describe('revalidating stored chats', { timeout: 60_000 }, () => {
  it('re-resolves a chat whose room isn’t registered, without building', () => {
    const repo = gitRepo(join(dir, 'lab'))
    const rooms = open(loaded({ rooms: [{ id: 'c-api', name: 'API', folders: ['/srv/api'] }] }))
    expect(rooms.revalidate({ cwd: repo, department: 'c-api' }, 'main')).toBeUndefined()
    expect(rooms.revalidate({ cwd: repo, department: 'side' }, 'main')).toBeUndefined()
    expect(rooms.revalidate({ cwd: repo, department: 'c-lab' }, 'main')).toBe('side')
    expect(rooms.revalidate({ cwd: repo }, 'main')).toBe('side')
    expect(rooms.revalidate({ cwd: repo, department: 'c-lab', review: true }, 'main')).toBe('rev')
    expect(ids(rooms)).toEqual(['side', 'rev', 'c-api'])
  })

  it('moves chats out of a built room once a config room covers its repo, and leaves other built rooms alone', () => {
    const shop = gitRepo(join(dir, 'shop'))
    const blog = gitRepo(join(dir, 'blog'))
    const first = open()
    const [shopRoom, blogRoom] = [first.resolve(shop, 'main', { build: true }), first.resolve(blog, 'main', { build: true })]
    const rooms = open(loaded({ rooms: [{ id: 'c-shop', name: 'Shop', folders: [shop] }] }))
    expect(rooms.revalidate({ cwd: shop, department: shopRoom }, 'main')).toBe('c-shop')
    expect(rooms.revalidate({ cwd: shop, department: blogRoom }, 'main')).toBeUndefined()
    expect(rooms.resolve(join(shop, 'src'), 'main', { build: true })).toBe('c-shop')
  })

  it('keeps chats on config room ids while the config is unreadable', () => {
    const notes = folder(join(dir, 'notes'))
    const rooms = open(loaded({}, 'Unexpected token } in JSON'))
    expect(rooms.revalidate({ cwd: notes, department: 'c-research-gym' }, 'research')).toBeUndefined()
    expect(rooms.revalidate({ cwd: notes, department: 'gym' }, 'research')).toBe('side')
  })
})
