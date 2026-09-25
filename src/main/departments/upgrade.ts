import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { repoPath } from '../../shared/departments'
import { writeAtomic } from '../outside/installer'
import type { Db } from '../store/db'
import { roomId } from './config'
import { isMwsMonorepo, repoInfo } from './repo-info'

const gym = { name: 'Research gym', account: 'research', look: 'gym', accent: '#0d9488' }
const legacy = {
  rooms: [gym],
  playground: ['/'],
  commands: { ship: ['/mws-test-cases', '/mws-verify', '/mws-review'], fixCi: '/gh-fix-ci', answerComments: '/pr-comment-rundown', review: '/pr-review-rundown' },
}
const monorepo = new Set(['mkt', 'adm', 'mob', 'plat'])

function oldList(file: string): boolean {
  try {
    return Array.isArray(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return false
  }
}

export function upgradeRooms(db: Pick<Db, 'listChats' | 'saveChat' | 'setting' | 'saveSetting'>, labels: readonly string[], dir: string): void {
  if (db.setting('roomsVersion') === 1) return
  const chats = db.listChats()
  const cwds = new Set(chats.filter((chat) => monorepo.has(chat.department ?? '')).map((chat) => repoPath(chat.cwd)))
  const found = [...cwds].map((cwd) => repoInfo(cwd)?.root).filter((root): root is string => !!root && isMwsMonorepo(root))
  db.saveSetting('mwsRoots', [...new Set([...((db.setting('mwsRoots') as string[] | undefined) ?? []), ...found])])
  const gymChats = chats.filter((chat) => chat.department === 'gym')
  const file = join(dir, 'departments.json')
  if (oldList(file)) {
    renameSync(file, join(dir, 'departments.old.json'))
    console.warn('[rooms] moved the old list-format departments.json to departments.old.json')
  }
  if (!existsSync(file) && (gymChats.length || labels.some((label) => /research/i.test(label)))) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeAtomic(file, `${JSON.stringify(legacy, null, 2)}\n`)
  }
  for (const chat of gymChats) db.saveChat({ ...chat, department: roomId(gym.name) })
  db.saveSetting('roomsVersion', 1)
}
