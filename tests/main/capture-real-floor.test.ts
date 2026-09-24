import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { createDesktopMeta } from '../../src/main/outside/desktop-meta'
import { createDiscovery, inLinkedWorktree } from '../../src/main/outside/transcripts'
import { createVisitors } from '../../src/main/outside/visitors'
import { transcriptRows } from '../../src/main/store/chats'
import type { ChatState, Stuck } from '../../src/shared/chat'
import { defaultRules, isDeptId, isResearch } from '../../src/shared/departments'
import type { Floor, FloorChat } from '../fixtures/floors'

vi.mock('electron', () => import('../fakes/electron'))

const enabled = process.env.AGENT_OFFICE_CAPTURE_FLOOR === '1'
const dataDir = join(homedir(), 'Library', 'Application Support', 'Agent Office')
const kept = new Set(['', ...defaultRules.flatMap((rule) => rule.path.split('/')), '.claude', 'worktrees'])

interface OfficeRow {
  id: string
  session_id: string | null
  account_id: string
  cwd: string
  worktree: string | null
  title: string
  department: string | null
  review: number
  state: ChatState
  stuck: string | null
  archived: number
  parked: number
  unread: number
  created_at: number
  last_activity_at: number
}

function readSnapshot<T>(read: (db: Database.Database) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'agent-office-capture-'))
  try {
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(join(dataDir, `office.db${suffix}`))) copyFileSync(join(dataDir, `office.db${suffix}`), join(dir, `office.db${suffix}`))
    const db = new Database(join(dir, 'office.db'), { readonly: true })
    try {
      return read(db)
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function anonymiser() {
  const segments = new Map<string, string>()
  const segment = (part: string) => {
    if (kept.has(part)) return part
    if (!segments.has(part)) segments.set(part, `${segments.size.toString(36)}${'x'.repeat(part.length)}`.slice(0, Math.max(part.length, 1)))
    return segments.get(part)!
  }
  let titles = 0
  let ids = 0
  return {
    path: (path: string) => path.split('/').map(segment).join('/'),
    title: (title: string) => `Chat ${++titles}`.padEnd(title.length, ' lorem'),
    id: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  }
}

async function pendingTool(sessionId: string | null): Promise<string | undefined> {
  if (!sessionId) return undefined
  const last = (await transcriptRows(sessionId)).findLast((row) => row.kind === 'tool')
  return last?.kind === 'tool' && !last.result ? last.name : undefined
}

describe.skipIf(!enabled)('capture the real floor', () => {
  it('writes an anonymised snapshot of the real chats to tests/fixtures/real-floor.json', async () => {
    const now = Date.now()
    const minutes = (at: number) => Math.max(0, Math.round((now - at) / 60_000))
    const accounts = JSON.parse(readFileSync(join(dataDir, 'accounts.json'), 'utf8')) as { id: string; label: string }[]
    const accountOf = (id: string): FloorChat['account'] => {
      const account = accounts.find((candidate) => candidate.id === id)
      return account ? (isResearch(account) ? 'research' : 'main') : 'unknown'
    }
    const { office, settings } = readSnapshot((db) => ({
      office: db.prepare('select * from chats order by created_at').all() as OfficeRow[],
      settings: new Map((db.prepare('select key, value from settings').all() as { key: string; value: string }[]).map((row) => [row.key, JSON.parse(row.value) as unknown])),
    }))

    const claudeDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
    const discovery = createDiscovery({ projectsDir: join(claudeDir, 'projects'), desktop: createDesktopMeta(join(homedir(), 'Library', 'Application Support')).read })
    const officeSessions = new Set(office.flatMap((row) => (row.session_id ? [row.session_id] : [])))
    const seeds = discovery.scan(now, officeSessions)
    const visitors = createVisitors({ patch: () => {}, accounts: () => accounts, rules: defaultRules, officeSessions: () => officeSessions, describe: () => undefined, settings: { setting: (key) => settings.get(key), saveSetting: () => {} }, log: () => {} })
    visitors.sync(seeds)

    const hide = anonymiser()
    const chats: FloorChat[] = []
    for (const row of office) {
      const state = row.state
      const stuck = row.stuck ? (JSON.parse(row.stuck) as Stuck).reason : undefined
      const request = state === 'needs-you' ? await pendingTool(row.session_id) : undefined
      chats.push({
        id: hide.id(),
        kind: 'office',
        account: accountOf(row.account_id),
        title: hide.title(row.title),
        cwd: hide.path(row.cwd),
        department: isDeptId(row.department) ? row.department : 'side',
        state,
        ...(stuck ? { stuck } : {}),
        ...(request ? { request } : {}),
        unread: row.unread === 1,
        ...(row.parked ? { parked: true } : {}),
        ...(row.archived ? { archived: true } : {}),
        ...(row.review ? { review: true } : {}),
        ...(row.worktree ? { worktree: true } : {}),
        idleMinutes: minutes(row.last_activity_at),
        ageMinutes: minutes(row.created_at),
      })
    }
    for (const view of visitors.views()) {
      chats.push({
        id: hide.id(),
        kind: view.visitor ?? 'desktop',
        account: accountOf(view.accountId),
        title: hide.title(view.title),
        cwd: hide.path(view.cwd),
        department: isDeptId(view.department) ? view.department : 'side',
        state: view.state,
        unread: view.unread,
        ...(view.parked ? { parked: true } : {}),
        ...(view.retained ? { retained: true } : {}),
        ...(view.moved ? { moved: true } : {}),
        ...(inLinkedWorktree(view.cwd) || view.cwd.includes('/.claude/worktrees/') ? { worktree: true } : {}),
        idleMinutes: minutes(view.lastActivityAt),
        ageMinutes: minutes(view.createdAt),
      })
    }

    const floor: Floor = { capturedAt: new Date(now).toISOString().slice(0, 10), chats }
    const out = join(__dirname, '../fixtures/real-floor.json')
    writeFileSync(out, `${JSON.stringify(floor, null, 2)}\n`)
    const written = readFileSync(out, 'utf8')
    for (const secret of [homedir(), ...office.map((row) => row.title), ...visitors.views().map((view) => view.title)]) if (secret.length > 8) expect(written).not.toContain(secret)
  })
})
