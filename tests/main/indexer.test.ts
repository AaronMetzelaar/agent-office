import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatPatch } from '../../src/shared/chat'
import type { SearchHit } from '../../src/shared/history'
import { wireHistory } from '../../src/main/history'
import { ftsQuery, openIndex, snippetOf, type Index } from '../../src/main/history/indexer'
import { createDesktopMeta } from '../../src/main/outside/desktop-meta'
import { createDiscovery } from '../../src/main/outside/transcripts'
import { createVisitors } from '../../src/main/outside/visitors'
import { line, writeTranscript } from '../fakes/outside'
import { openOffice } from '../fakes/office'

vi.mock('electron', () => import('../fakes/electron'))

const day = 24 * 60 * 60_000
let root: string
let claudeDir: string
let logs: string[]
let index: Index

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-office-search-'))
  claudeDir = join(root, 'claude')
  mkdirSync(join(claudeDir, 'projects'), { recursive: true })
  logs = []
  index = openIndex(join(root, 'search.db'), join(claudeDir, 'projects'), (message) => logs.push(message))
})

afterEach(() => {
  index.close()
  rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('search index', () => {
  it('finds a phrase in an old transcript and returns that chat with a snippet around the match', async () => {
    const old = randomUUID()
    writeTranscript(claudeDir, old, [line.user('Why does the bid rounding drift on auctions?'), line.text('The rounding happens twice: once in BidFlow and again in the price formatter.')], { cwd: root, at: Date.now() - 90 * day })
    writeTranscript(claudeDir, randomUUID(), [line.user('Refactor the tray strip')], { cwd: root })
    expect(await index.update()).toBe(3)

    const hits = index.search('price format')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ sessionId: old, title: 'Why does the bid rounding drift on auctions?', cwd: root })
    expect(hits[0]!.snippet).toEqual(['…happens twice: once in BidFlow and again in the ', 'price', ' formatter.'])
    expect(index.search('')).toEqual([])
    expect(index.search('"; drop table files; --')).toEqual([])
  })

  it('indexes only the new lines when a transcript grows, and a half-written last line waits for its newline', async () => {
    const id = randomUUID()
    const path = writeTranscript(claudeDir, id, [line.user('Set up the ntfy topic')], { cwd: root })
    expect(await index.update()).toBe(1)
    expect(await index.update()).toBe(0)

    appendFileSync(path, JSON.stringify(line.text('The topic now carries the signing key.')) + '\n' + JSON.stringify(line.user('And the reply topic?')).slice(0, 20))
    expect(await index.update()).toBe(1)
    expect(index.search('signing')).toHaveLength(1)
    expect(index.search('reply')).toHaveLength(0)

    appendFileSync(path, JSON.stringify(line.user('And the reply topic?')).slice(20) + '\n')
    expect(await index.update()).toBe(1)
    expect(index.search('reply')[0]?.sessionId).toBe(id)
  })

  it('skips and logs a malformed line without stopping the index', async () => {
    const id = randomUUID()
    const path = writeTranscript(claudeDir, id, [line.user('First question about Storyblok')], { cwd: root })
    appendFileSync(path, '{"type":"user","message":\n' + JSON.stringify(line.text('Storyblok answers after the broken line.')) + '\n')
    expect(await index.update()).toBe(2)
    expect(logs).toEqual([`skipped 1 malformed line in ${id}.jsonl`])
    expect(index.search('broken')).toHaveLength(1)
  })

  it('re-reads a transcript that was rewritten shorter, and forgets one that was deleted', async () => {
    const id = randomUUID()
    const path = writeTranscript(claudeDir, id, [line.user('Old words about marzipan'), line.text('More words.')], { cwd: root })
    await index.update()
    writeFileSync(path, JSON.stringify(line.user('New words')) + '\n')
    await index.update()
    expect(index.search('marzipan')).toEqual([])
    expect(index.search('new')).toHaveLength(1)

    rmSync(path)
    await index.update()
    expect(index.search('new')).toEqual([])
  })

  it('leaves out system reminders, command lines and tool results', async () => {
    writeTranscript(claudeDir, randomUUID(), [line.user('<system-reminder>secret zebra</system-reminder>\nplain ask'), line.user('<command-name>/zebra</command-name>'), line.result('toolu_1')], { cwd: root })
    await index.update()
    expect(index.search('zebra')).toEqual([])
    expect(index.search('plain')).toHaveLength(1)
  })

  it('turns typed text into a safe prefix query and marks the whole matched word', () => {
    expect(ftsQuery('bid  "round')).toBe('"bid" "round"*')
    expect(ftsQuery('  ')).toBeUndefined()
    expect(snippetOf('Rounding\n\ntwice', ['round'])).toEqual(['', 'Rounding', ' twice'])
  })
})

describe('opening a result', () => {
  function outside(office: ReturnType<typeof openOffice>) {
    const patches: ChatPatch[] = []
    const settings = new Map<string, unknown>()
    const discovery = createDiscovery({ projectsDir: join(claudeDir, 'projects'), desktop: createDesktopMeta(join(root, 'desktop')).read })
    const visitors = createVisitors({
      patch: (patch) => patches.push(patch),
      accounts: () => [{ id: 'main', label: 'main' }],
      instances: () => [],
      rooms: office.rooms,
      officeSessions: () => new Set(office.store.views().flatMap((view) => (view.sessionId ? [view.sessionId] : []))),
      describe: (id) => discovery.describe(id, Date.now()),
      settings: { setting: (key) => settings.get(key), saveSetting: (key, value) => void settings.set(key, value) },
    })
    return { patches, discovery, visitors }
  }

  it('opens an old outside chat as a finished read-only visitor that stays until the host restarts', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', claudeDir)
    const office = openOffice(root)
    const { discovery, visitors, patches } = outside(office)
    const id = randomUUID()
    const at = Date.now() - 40 * day
    writeTranscript(claudeDir, id, [line.user('Plan the WBSO hours'), line.text('Here is the split.')], { cwd: root, entrypoint: 'sdk-ts', at })
    expect(discovery.describe(id, Date.now())).toBeUndefined()

    visitors.summon(discovery.describe(id, Date.now(), true)!)
    expect(visitors.view(id)).toMatchObject({ visitor: 'terminal', title: 'Plan the WBSO hours', retained: false })
    expect(visitors.view(id)!.finished).toBeCloseTo(at, -1)
    visitors.sync(discovery.scan(Date.now(), new Set()))
    expect(visitors.has(id)).toBe(true)

    visitors.open(id)
    await vi.waitFor(() => expect(patches.some((patch) => patch.id === id && patch.replaceRows && patch.rows?.length === 2)).toBe(true), { timeout: 10_000 })
    office.db.close()
  })

  it('points hits at the office chat that owns the session, and leaves other hits to be opened', async () => {
    const office = openOffice(root)
    const { visitors } = outside(office)
    const chatId = office.start('Fix the bid flow')
    office.engine.init(chatId)
    const sessionId = office.chat(chatId).sessionId!
    const stranger = randomUUID()
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const hit = (id: string) => ({ sessionId: id, title: 'First prompt', cwd: root, at: 1, snippet: ['', 'bid', ''] as [string, string, string] })
    wireHistory({ handle: (name, command) => void handlers.set(name, command as never), send: () => {} }, { search: async () => [hit(sessionId), hit(stranger)] }, { store: office.store, visitors })

    const hits = (await handlers.get('searchChats')!('bid')) as SearchHit[]
    expect(hits.map((found) => [found.chatId, found.title])).toEqual([
      [chatId, 'Fix the bid flow'],
      [undefined, 'First prompt'],
    ])
    expect(await handlers.get('searchChats')!('  ')).toEqual([])
    office.db.close()
  })
})

describe('resume and rename', () => {
  it('resuming an archived or finished chat brings it back and continues the same session', () => {
    const office = openOffice(root)
    const { store, engine, chat } = office
    const id = office.start('Fix the bid flow')
    office.finish(id)
    const sessionId = chat(id).sessionId
    store.archive(id)
    engine.starts.length = 0

    store.sendMessage(id, 'One more thing')
    expect(chat(id)).toMatchObject({ archived: false, finished: undefined, state: 'working' })
    expect(engine.starts[0]?.options).toMatchObject({ resume: sessionId })
    expect(engine.starts[0]?.options.forkSession).toBeUndefined()
    office.db.close()
  })

  it('renames a chat to one trimmed line and keeps it after a restart', () => {
    let office = openOffice(root)
    const id = office.start('Fix the bid flow')
    office.store.rename(id, '  Bid rounding\nsecond line  ')
    office.store.rename(id, '   ')
    office.store.rename('nope', 'x')
    expect(office.chat(id).title).toBe('Bid rounding')
    office.db.close()
    office = openOffice(root)
    expect(office.chat(id).title).toBe('Bid rounding')
    office.db.close()
  })
})
