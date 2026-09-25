import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatState, StuckReason } from '../../src/shared/chat'
import type { DeptId } from '../../src/shared/departments'

export interface FloorChat {
  id: string
  kind: 'office' | 'desktop' | 'terminal'
  account: 'main' | 'research' | 'unknown'
  title: string
  cwd: string
  department: DeptId
  state: ChatState
  stuck?: StuckReason
  request?: string
  unread: boolean
  parked?: boolean
  archived?: boolean
  retained?: boolean
  moved?: boolean
  review?: boolean
  worktree?: boolean
  idleMinutes: number
  ageMinutes: number
}

export interface Floor {
  capturedAt?: string
  chats: FloorChat[]
  rooms?: { id: string; name: string; about: string; folder?: string }[]
}

export const onFloor = (chat: FloorChat) => !chat.archived && !chat.retained

const home = '/Users/axxxx/Dxxxxxxxx/Gxxxxx'
const cwds: Record<string, string> = {
  mkt: `${home}/monorepo/frontend/marketplace`,
  adm: `${home}/monorepo/frontend/admin`,
  mob: `${home}/monorepo/frontend/mobile`,
  plat: `${home}/monorepo/sxxxxxxx/axx`,
  rev: `${home}/monorepo`,
  side: `${home}/pxxxxxxxx`,
  gym: `${home}/exxxxxxxxx`,
}

type Spec = [dept: DeptId, state: ChatState, extra?: Partial<FloorChat>]

function floor(specs: Spec[]): Floor {
  return {
    chats: specs.map(([department, state, extra = {}], index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      kind: 'office',
      account: department === 'gym' ? 'research' : 'main',
      title: `Chat ${index + 1}`.padEnd(24, ' lorem'),
      cwd: cwds[department] ?? `${home}/${department}`,
      department,
      state,
      unread: state === 'done',
      idleMinutes: state === 'working' || state === 'needs-you' ? 0 : 5 + index * 7,
      ageMinutes: 30 + index * 11,
      ...(state === 'stuck' ? { stuck: 'interrupted' as const } : {}),
      ...(state === 'needs-you' ? { request: 'Bash' } : {}),
      ...(department === 'rev' ? { review: true } : {}),
      ...extra,
    })),
  }
}

const repeat = (count: number, spec: Spec): Spec[] => Array.from({ length: count }, () => spec)

export const floors: Record<string, Floor> = {
  real: JSON.parse(readFileSync(join(__dirname, 'real-floor.json'), 'utf8')) as Floor,
  one: floor([['mob', 'working']]),
  three: floor([
    ['mob', 'needs-you'],
    ['side', 'done', { kind: 'desktop', account: 'unknown' }],
    ['gym', 'idle'],
  ]),
  busy: floor([
    ['mkt', 'working'],
    ['mkt', 'needs-you', { request: 'ExitPlanMode' }],
    ['mkt', 'done'],
    ['mkt', 'idle', { parked: true, idleMinutes: 3000 }],
    ['adm', 'stuck', { stuck: 'crashed' }],
    ['mob', 'working', { worktree: true, cwd: `${cwds.mob}/.claude/worktrees/axxxx-bxxx` }],
    ['mob', 'idle'],
    ['plat', 'working'],
    ['plat', 'needs-you', { request: 'WebFetch' }],
    ['plat', 'done'],
    ['plat', 'stuck', { stuck: 'rate-limited' }],
    ['plat', 'idle', { kind: 'terminal', account: 'unknown' }],
    ['side', 'working', { kind: 'desktop', account: 'main' }],
    ['side', 'done', { kind: 'desktop', account: 'main' }],
    ['side', 'idle', { kind: 'desktop', account: 'main', idleMinutes: 2000, retained: true }],
    ['side', 'idle', { archived: true }],
    ['rev', 'working'],
    ['rev', 'done'],
    ['gym', 'working'],
    ['gym', 'working'],
    ['gym', 'needs-you'],
    ['gym', 'done'],
    ['gym', 'idle', { parked: true, idleMinutes: 2900 }],
    ['gym', 'idle', { kind: 'desktop', account: 'research' }],
    ['mkt', 'idle', { kind: 'terminal', account: 'unknown' }],
    ['adm', 'done'],
    ['side', 'needs-you', { kind: 'terminal', account: 'unknown' }],
  ]),
  rooms: {
    ...floor([['mkt', 'working'], ...repeat(3, ['r1', 'working']), ['r1', 'done'], ['r2', 'needs-you'], ['side', 'working']]),
    rooms: [
      { id: 'r1', name: 'Agent Office', about: 'The Electron app that shows agents in an office', folder: `${home}/agent-office` },
      { id: 'r2', name: 'Docs', about: 'Handbooks and guides' },
    ],
  },
  tiers: floor([...repeat(1, ['mob', 'working']), ...repeat(5, ['mkt', 'working']), ...repeat(8, ['plat', 'done']), ...repeat(9, ['gym', 'working'])]),
}
