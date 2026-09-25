import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { confirmations } from '../../src/main/departments/classifier'
import type { HookEvent } from '../../src/main/outside/listener'
import type { VisitorSeed } from '../../src/main/outside/transcripts'
import { openDb } from '../../src/main/store/db'
import { emptyUsage, type ChatState, type ChatView } from '../../src/shared/chat'
import { applyRooms, defaultRules, deptNames, homeDept } from '../../src/shared/departments'
import { spotFor } from '../../src/renderer/office/standby'
import { floors, onFloor, type Floor, type FloorChat } from '../fixtures/floors'

interface MainGlobals {
  store: { view(id: string): ChatView | undefined; sendMessage(id: string, text: string): unknown }
  fakeEngine: { ask(chatId: string, toolName: string, input: Record<string, unknown>): Promise<unknown> }
  outside: { visitors: { view(id: string): ChatView | undefined; sync(seeds: VisitorSeed[]): void; hook(event: HookEvent): void } }
}

const root = resolve(__dirname, '../..')
const scratch = mkdtempSync(join(tmpdir(), 'agent-office-floor-'))
const template = join(scratch, 'template')
const accounts: Record<FloorChat['account'], string> = { main: '', research: '', unknown: '' }
const midTurn = new Set<ChatState>(['starting', 'working', 'needs-you'])
const requestInput = { command: 'pnpm test', file_path: 'README.md', url: 'https://example.com/docs', plan: '1. Run the tests' }

const env = (userData: string) => ({
  ...process.env,
  AGENT_OFFICE_USER_DATA: userData,
  AGENT_OFFICE_FAKE_VALIDATOR: '1',
  AGENT_OFFICE_FAKE_ENGINE: '1',
  AGENT_OFFICE_DESKTOP_DIR: mkdtempSync(join(scratch, 'desktop-')),
  CLAUDE_CONFIG_DIR: mkdtempSync(join(scratch, 'claude-')),
})

function evidenceFor(chat: FloorChat): VisitorSeed['evidence'] {
  if (chat.department === homeDept(chat.cwd, chat.account === 'research')) return []
  const rule = defaultRules.find((candidate) => candidate.dept === chat.department)
  const file = rule ? `/elsewhere/${rule.path}/index.ts` : `${chat.cwd}/index.ts`
  return Array.from({ length: confirmations }, (_, k) => [{ type: 'tool-use', id: `evidence-${k}`, name: 'Edit', input: { file_path: file } }])
}

function seedOffice(userData: string, floor: Floor, now: number) {
  const db = openDb(join(userData, 'office.db'))
  for (const chat of floor.chats.filter((candidate) => candidate.kind === 'office')) {
    db.saveChat({
      id: chat.id,
      sessionId: chat.id,
      accountId: accounts[chat.account] || accounts.main,
      cwd: chat.cwd,
      ...(chat.worktree ? { worktree: chat.cwd } : {}),
      title: chat.title,
      department: chat.department,
      review: chat.review,
      state: midTurn.has(chat.state) ? 'idle' : chat.state,
      ...(chat.state === 'stuck' ? { stuck: { reason: chat.stuck ?? 'crashed' } } : {}),
      archived: !!chat.archived,
      parked: !!chat.parked,
      unread: chat.unread,
      createdAt: now - chat.ageMinutes * 60_000,
      lastActivityAt: now - chat.idleMinutes * 60_000,
      usage: emptyUsage(),
    })
  }
  db.saveSetting('rooms', floor.rooms ?? [])
  db.saveSetting('movedSessions', floor.chats.filter((chat) => chat.moved).map((chat) => chat.id))
  db.close()
}

const visitorSeeds = (floor: Floor, now: number): VisitorSeed[] =>
  floor.chats
    .filter((chat) => chat.kind !== 'office')
    .map((chat) => ({
      sessionId: chat.id,
      source: chat.kind === 'terminal' ? 'terminal' : 'desktop',
      ...(chat.account === 'unknown' ? {} : { instance: chat.account === 'research' ? 'Claude Research' : 'Claude' }),
      cwd: chat.cwd,
      title: chat.title,
      titled: true,
      state: chat.state === 'needs-you' ? 'working' : chat.state,
      createdAt: now - chat.ageMinutes * 60_000,
      lastActivityAt: now - chat.idleMinutes * 60_000,
      ...(chat.state === 'done' ? { endedAt: now - chat.idleMinutes * 60_000 } : {}),
      writtenAt: now - chat.idleMinutes * 60_000,
      archived: !!chat.archived,
      evidence: evidenceFor(chat),
    }))

async function seedLive(app: ElectronApplication, floor: Floor, now: number) {
  const office = floor.chats.filter((chat) => chat.kind === 'office' && midTurn.has(chat.state))
  const visitors = floor.chats.filter((chat) => chat.kind !== 'office' && chat.state === 'needs-you')
  await app.evaluate((_electron, { office, visitors, seeds, input }) => {
    const globals = globalThis as unknown as MainGlobals
    for (const chat of office) globals.store.sendMessage(chat.id, 'Keep going [hang]')
    globals.outside.visitors.sync(seeds)
    for (const chat of visitors) {
      globals.outside.visitors.hook({ session_id: chat.id, hook_event_name: 'PreToolUse', tool_name: chat.request ?? 'Bash', tool_use_id: `${chat.id}-tool`, tool_input: input })
      globals.outside.visitors.hook({ session_id: chat.id, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission' })
    }
  }, { office, visitors, seeds: visitorSeeds(floor, now), input: requestInput })
  const states = () => app.evaluate((_electron, ids) => ids.map((id) => (globalThis as unknown as MainGlobals).store.view(id)?.state), office.map((chat) => chat.id))
  await expect.poll(states).toEqual(office.map(() => 'working'))
  await app.evaluate((_electron, { asks, input }) => {
    for (const chat of asks) void (globalThis as unknown as MainGlobals).fakeEngine.ask(chat.id, chat.request ?? 'Bash', input)
  }, { asks: office.filter((chat) => chat.state === 'needs-you'), input: requestInput })
  const expected = floor.chats.filter((chat) => chat.kind === 'office' || !chat.archived).map((chat) => (chat.state === 'starting' ? 'working' : chat.state))
  const actual = () =>
    app.evaluate((_electron, chats) => {
      const globals = globalThis as unknown as MainGlobals
      return chats.map((chat) => (chat.kind === 'office' ? globals.store.view(chat.id) : globals.outside.visitors.view(chat.id))?.state)
    }, floor.chats.filter((chat) => chat.kind === 'office' || !chat.archived))
  await expect.poll(actual).toEqual(expected)
}

const agentsOnSigns = (page: Page) =>
  page.locator('.sign:visible').evaluateAll((signs) => signs.reduce((sum, sign) => sum + [...(sign.getAttribute('aria-label') ?? '').matchAll(/(\d+) \w/g)].reduce((n, match) => n + Number(match[1]), 0), 0))

async function canvasSpread(app: ElectronApplication, page: Page) {
  const canvas = (await page.locator('canvas').boundingBox())!
  const drawer = await page.getByRole('complementary', { name: 'Inbox' }).boundingBox()
  const right = drawer && drawer.x > canvas.x ? drawer.x : canvas.x + canvas.width
  await page.evaluate(() => {
    document.body.style.visibility = 'hidden'
    document.querySelector('canvas')!.style.visibility = 'visible'
  })
  await page.waitForTimeout(200)
  const rect = { x: Math.round(canvas.x), y: Math.round(canvas.y), width: Math.round(right - canvas.x), height: Math.round(canvas.height) }
  const spread = await app.evaluate(async ({ BrowserWindow }, rect) => {
    const bitmap = (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(rect)).toBitmap()
    const counts = new Map<number, number>()
    for (let i = 0; i < bitmap.length; i += 4) {
      const key = ((bitmap[i]! >> 4) << 8) | ((bitmap[i + 1]! >> 4) << 4) | (bitmap[i + 2]! >> 4)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const pixels = bitmap.length / 4
    return { pixels, colours: counts.size, topShare: Math.max(...counts.values()) / pixels }
  }, rect)
  await page.evaluate(() => {
    document.body.style.visibility = ''
    document.querySelector('canvas')!.style.visibility = ''
  })
  return spread
}


test.beforeAll(async () => {
  const app = await electron.launch({ args: ['--use-mock-keychain', root], env: env(template) })
  const page = await app.firstWindow()
  for (const label of ['main', 'research'] as const) {
    accounts[label] = await page.evaluate(async (label) => {
      const added = await window.office.addAccount(label, 'sk-ant-oat01-fake-ok')
      if (!('account' in added)) throw new Error(added.error)
      return added.account.id
    }, label)
  }
  await app.close()
})

test.afterAll(() => rmSync(scratch, { recursive: true, force: true }))

for (const [name, floor] of Object.entries(floors)) {
  const onScreen = floor.chats.filter(onFloor)

  test(`the ${name} floor (${onScreen.length} agents) renders every agent and section without errors`, async () => {
    test.setTimeout(60_000)
    const userData = join(scratch, name)
    cpSync(template, userData, { recursive: true, filter: (path) => !basename(path).startsWith('Singleton') })
    const now = Date.now()
    seedOffice(userData, floor, now)
    const app = await electron.launch({ args: ['--use-mock-keychain', root], env: env(userData) })
    const problems: string[] = []
    app.process().stdout?.on('data', (chunk: Buffer) => problems.push(...chunk.toString().split('\n').filter((line) => line.includes('[renderer]'))))
    const page = await app.firstWindow()
    page.on('console', (message) => message.type() === 'error' && problems.push(message.text()))
    page.on('pageerror', (error) => problems.push(error.message))
    await expect(page.locator('canvas')).toBeVisible()

    await seedLive(app, floor, now)
    await expect.poll(() => agentsOnSigns(page)).toBe(onScreen.length)
    const spots = onScreen.map((chat) => ({ dept: chat.department, spot: spotFor({ state: chat.state, parked: !!chat.parked || !!chat.moved, dept: chat.department }, undefined, false) }))
    applyRooms(floor.rooms ?? [])
    const sections = [...new Set(spots.filter((agent) => agent.spot === 'desk').map((agent) => deptNames[agent.dept]))]
    for (const section of sections) await expect(page.locator('.sign', { hasText: section })).toBeVisible()
    if (spots.some((agent) => agent.spot === 'lounge')) await expect(page.locator('.sign', { hasText: 'Lounge' })).toBeVisible()

    await page.waitForTimeout(1500)
    const spread = await canvasSpread(app, page)
    expect(spread.colours).toBeGreaterThan(100)
    expect(spread.topShare).toBeLessThan(0.95)
    expect(problems).toEqual([])

    await app.evaluate(({ dialog }) => Object.assign(dialog, { showMessageBox: async () => ({ response: 0, checkboxChecked: false }) }))
    await app.close()
  })
}
