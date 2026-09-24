import { emptyUsage, type ChatFields, type ChatPatch, type ChatPatchBatch, type ChatState, type ChatView } from '../../shared/chat'
import type { AccountView } from '../../shared/ipc'
import type { PendingRequestView } from '../../shared/permissions'
import type { ChatSource } from './projection'

const home = '/Users/demo/Documents/GitHub'
const where: Record<string, string> = {
  mkt: `${home}/monorepo/frontend/marketplace`,
  adm: `${home}/monorepo/frontend/admin`,
  mob: `${home}/monorepo/frontend/mobile`,
  plat: `${home}/monorepo/services/api`,
  rev: `${home}/monorepo`,
}

type Sample = [dept: string, title: string, state: ChatState, minutes: number, activity: string, extra?: { project?: string; subs?: string[]; ask?: [string, string, boolean]; office?: boolean }]

const samples: Sample[] = [
  ['mkt', 'Bid flow approach', 'working', 4, 'Editing BidFlow.vue', { subs: ['Explore · find bid dialog callers', 'Review · test coverage gaps'] }],
  ['mkt', 'Dialog flow CI fix', 'needs-you', 11, '', { ask: ['Bash', 'git push --force-with-lease origin dialog-flow-ci-fix', true] }],
  ['mkt', 'Czechia auction visibility', 'done', 7, ''],
  ['mob', 'Close stale test PRs', 'working', 6, 'Running gh pr close', { subs: ['Explore · find stale test PRs'] }],
  ['mob', 'Push notification deep links', 'idle', 38, ''],
  ['mob', 'Bid alerts widget', 'working', 12, 'Editing BidAlerts.tsx'],
  ['plat', 'Crowdin translations', 'idle', 52, ''],
  ['plat', 'Worker template cleanup', 'working', 9, 'Editing index.ts'],
  ['plat', 'Refund webhook retries', 'idle', 420, ''],
  ['side', 'Portfolio hero', 'working', 2, 'Editing DotField.tsx', { project: 'portfolio', subs: ['Design · dot-field variants'] }],
  ['side', 'Office floor plan', 'stuck', 14, '', { project: 'agent-office' }],
  ['side', 'Cookbook pages', 'needs-you', 3, '', { project: 'cookbook', ask: ['WebFetch', 'https://docs.github.com/pages', false] }],
  ['gym', 'Enigma RSA sweep', 'working', 19, 'Running python sieve.py', { project: 'enigma-rsa', subs: ['Research · polynomial selection', 'Explore · validator limits', 'Bench · sieve parameters'] }],
  ['gym', 'Matter pairing', 'idle', 540, '', { project: 'smart-home' }],
  ['mkt', 'Checkout VAT rounding', 'idle', 2016, ''],
  ['mob', 'iOS build cache', 'done', 2880, ''],
  ['plat', 'Hotfix login redirect', 'done', 1728, ''],
  ['mkt', 'Auction countdown flicker', 'idle', 5040, ''],
  ['mkt', 'Bid history pagination', 'done', 5472, ''],
  ['mkt', 'Shirt size guide copy', 'done', 5760, ''],
  ['adm', 'Admin CSV export', 'idle', 6048, ''],
  ['mob', 'Android deep link test', 'done', 7200, ''],
  ['gym', 'Enigma sieve bench', 'done', 7920, '', { project: 'enigma-rsa' }],
  ['plat', 'Seller payout table', 'done', 8640, ''],
  ['plat', 'Crowdin sync script', 'done', 10080, ''],
  ['mob', 'Storybook bump', 'idle', 11520, ''],
  ['plat', 'Sentry sourcemaps', 'done', 12960, ''],
  ['side', 'Portfolio case study', 'done', 4608, '', { project: 'portfolio' }],
  ['rev', 'Review #412 Round bids to the euro', 'working', 5, 'Running gh pr diff 412'],
]

export const floorFixture: Sample[] = [
  ['mkt', 'Checkout VAT rounding', 'stuck', 30, '', { office: true }],
  ['mkt', 'Auction countdown flicker', 'idle', 200, ''],
  ['mkt', 'Bid history pagination', 'idle', 320, ''],
  ['mkt', 'Shirt size guide copy', 'idle', 610, ''],
  ['plat', 'Worker template cleanup', 'working', 3, 'Editing index.ts'],
  ['plat', 'Crowdin translations', 'idle', 52, ''],
  ['plat', 'Refund webhook retries', 'idle', 140, ''],
  ['plat', 'Seller payout table', 'idle', 260, ''],
  ['plat', 'Sentry sourcemaps', 'idle', 380, ''],
  ['plat', 'Hotfix login redirect', 'idle', 700, ''],
  ['side', 'Portfolio hero', 'working', 2, 'Editing DotField.tsx', { project: 'portfolio', office: true }],
  ['side', 'Cookbook pages', 'done', 12, '', { project: 'cookbook' }],
  ['side', 'Office floor plan', 'idle', 90, '', { project: 'agent-office' }],
  ['gym', 'Enigma RSA sweep', 'working', 6, 'Running python sieve.py', { project: 'enigma-rsa' }],
  ['gym', 'Enigma sieve bench', 'done', 25, '', { project: 'enigma-rsa', office: true }],
  ['gym', 'Matter pairing', 'idle', 180, '', { project: 'smart-home' }],
  ['gym', 'Polynomial selection notes', 'idle', 240, '', { project: 'enigma-rsa' }],
  ['gym', 'Validator limits', 'idle', 300, '', { project: 'enigma-rsa' }],
  ['gym', 'Thread bridge firmware', 'idle', 420, '', { project: 'smart-home' }],
  ['gym', 'Paper summary', 'idle', 520, '', { project: 'reading' }],
  ['gym', 'Sieve parameter sweep', 'idle', 660, '', { project: 'enigma-rsa' }],
]

const asks: [string, string][] = [
  ['Bash', 'git push origin HEAD'],
  ['Bash', 'git branch -D old-dialog-flow'],
  ['Bash', 'pnpm add -D @playwright/test'],
  ['WebFetch', 'https://nuxt.com/docs/api/nuxt-config'],
]

export const demoAccounts: AccountView[] = [
  { id: 'demo-main', label: 'main', createdAt: 0, health: { status: 'ok' } },
  { id: 'demo-research', label: 'research', createdAt: 0, health: { status: 'ok' } },
]

const request = (id: string, tool: string, summary: string, createdAt: number, dangerous: boolean): PendingRequestView => ({
  id,
  tool,
  summary,
  input: tool === 'Bash' ? { command: summary } : { url: summary },
  createdAt,
  dangerous,
  ...(dangerous ? { dangerReason: 'force-push or branch delete' } : {}),
  alwaysAllow: tool !== 'WebFetch' && !dangerous,
})

function chatFrom([dept, title, state, minutes, activity, extra = {}]: Sample, index: number, now: number, visitors = false): ChatView {
  const at = now - minutes * 60_000
  const id = `demo-${index}`
  const ask = extra.ask
  return {
    id,
    accountId: dept === 'gym' ? 'demo-research' : 'demo-main',
    cwd: where[dept] ?? `${home}/${extra.project}`,
    ...(dept === 'rev' ? { department: 'rev', review: true } : {}),
    ...(visitors && !extra.office ? { visitor: 'desktop' as const } : {}),
    title,
    archived: false,
    state,
    stateSince: at,
    unread: state === 'done',
    activity,
    pending: ask ? [{ id: `${id}-ask`, toolName: ask[0] }] : [],
    pendingRequests: ask ? [request(`${id}-ask`, ask[0], ask[1], at, ask[2])] : [],
    ...(ask ? { oldestPendingAt: at } : {}),
    subagents: (state === 'working' ? (extra.subs ?? []) : []).map((description, k) => ({ id: `${id}-sub-${k}`, description })),
    usage: emptyUsage(),
    partial: '',
    createdAt: at - index * 1000,
    lastActivityAt: at,
    rows: [],
    ...(state === 'stuck' ? { stuck: { reason: 'error' as const, detail: 'pnpm build still failing' } } : {}),
    ...((state === 'idle' || state === 'done') && minutes >= 24 * 60 ? { parked: true } : {}),
  }
}

export function createDemoSource(fixture = false): ChatSource & { stop(): void } {
  let seed = 20260923
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const now = Date.now()
  const chats = new Map((fixture ? floorFixture : samples).map((sample, index) => [`demo-${index}`, chatFrom(sample, index, now, fixture)]))
  const listeners = new Set<(batch: ChatPatchBatch) => void>()
  let seq = 0
  const timers: ReturnType<typeof setTimeout>[] = []

  const push = (patches: ChatPatch[]) => {
    const batch = { seq: ++seq, patches }
    for (const patch of patches) {
      const chat = chats.get(patch.id)
      if (chat) Object.assign(chat, patch.fields)
      else if (patch.fields) chats.set(patch.id, { ...(patch.fields as ChatFields), rows: [] })
    }
    listeners.forEach((listener) => listener(batch))
  }

  const move = (id: string, state: ChatState, fields: Partial<ChatFields> & Record<string, unknown> = {}) => {
    const at = Date.now()
    const base: Record<string, unknown> = { state, stateSince: at, lastActivityAt: at, unread: state === 'done', parked: false, pending: [], pendingRequests: [], oldestPendingAt: undefined, stuck: undefined }
    if (state === 'needs-you') {
      const [tool, summary] = asks[Math.floor(rnd() * asks.length)]!
      Object.assign(base, { pending: [{ id: `${id}-${at}`, toolName: tool }], pendingRequests: [request(`${id}-${at}`, tool, summary, at, summary.includes('-D '))], oldestPendingAt: at })
    }
    if (state === 'working') base.activity = ['Reading package.json', 'Running pnpm test', 'Editing BidFlow.vue', 'Searching useAuction'][Math.floor(rnd() * 4)]
    if (state === 'stuck') base.stuck = { reason: 'crashed' }
    push([{ id, fields: { ...base, ...fields } as Partial<ChatFields> }])
  }

  const later = (ms: number, run: () => void) => fixture || timers.push(setTimeout(run, ms))
  const every = (ms: number, run: () => void) => fixture || timers.push(setInterval(run, ms))

  later(5000, () => {
    if (chats.get('demo-9')?.state === 'working') move('demo-9', 'needs-you')
  })
  later(10_000, () => {
    const at = Date.now()
    push([{ id: 'demo-admin', fields: { ...chatFrom(['adm', 'Dispute export', 'working', 0, 'Reading disputes/index.vue'], 99, at), id: 'demo-admin', createdAt: at } }])
  })
  every(9000, () => {
    const live = [...chats.values()].filter((chat) => Date.now() - chat.lastActivityAt < 86_400_000)
    const waiting = live.filter((chat) => chat.state === 'needs-you').sort((a, b) => a.stateSince - b.stateSince)
    if (waiting[0] && rnd() < 0.35) return move(waiting[0].id, 'working')
    const pool = live.filter((chat) => chat.state !== 'needs-you' && chat.state !== 'stuck')
    const chat = pool[Math.floor(rnd() * pool.length)]
    if (!chat) return
    const r = rnd()
    const next: ChatState =
      chat.state === 'working' ? (r < (waiting.length < 3 ? 0.22 : 0.04) ? 'needs-you' : r < 0.25 ? 'stuck' : r < 0.6 ? 'done' : 'working') : chat.state === 'done' ? (r < 0.5 ? 'idle' : 'working') : r < 0.55 ? 'working' : 'idle'
    if (next !== chat.state) move(chat.id, next)
  })

  const finish = (ids: string[]) => push(ids.filter((id) => chats.has(id)).map((id) => ({ id, fields: { finished: Date.now(), unread: false } })))

  return {
    getSnapshot: async () => ({ seq, chats: structuredClone([...chats.values()]), logins: [] }),
    finishChat: async (chatId) => (finish([chatId]), {}),
    finishChats: async (chatIds) => (finish(chatIds), { finished: chatIds, skipped: [], removed: 0 }),
    onChatPatches(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    stop: () => timers.forEach(clearTimeout),
  }
}
