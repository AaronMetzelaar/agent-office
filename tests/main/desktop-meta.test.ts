import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDesktopMeta, instances } from '../../src/main/outside/desktop-meta'
import { writeDesktopChat } from '../fakes/outside'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-office-desktop-'))
  mkdirSync(join(root, 'Slack'))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('desktop metadata', () => {
  it('reads title, archived state, activity and instance from both desktop app instances', () => {
    const [main, research, archived] = [randomUUID(), randomUUID(), randomUUID()]
    writeDesktopChat(root, 'Claude', { cliSessionId: main, title: 'Fix the bid rounding', cwd: '/repo/monorepo', createdAt: 1000, lastActivityAt: 2000, lastFocusedAt: 1500, isArchived: false })
    writeDesktopChat(root, 'Claude-Research', { cliSessionId: research, title: 'Explore RSA factoring', cwd: '/repo/rsa', lastActivityAt: 3000, priorCliSessionIds: ['old-id'] })
    writeDesktopChat(root, 'Claude', { cliSessionId: archived, title: 'Old spike', isArchived: true })

    expect(instances(root).sort()).toEqual(['Claude', 'Claude-Research'])
    const chats = createDesktopMeta(root).read()
    expect(chats.get(main)).toEqual({ sessionId: main, instance: 'Claude', title: 'Fix the bid rounding', cwd: '/repo/monorepo', archived: false, createdAt: 1000, lastActivityAt: 2000, lastFocusedAt: 1500, priorSessionIds: [] })
    expect(chats.get(research)).toMatchObject({ instance: 'Claude-Research', title: 'Explore RSA factoring', priorSessionIds: ['old-id'] })
    expect(chats.get(archived)?.archived).toBe(true)
  })

  it('skips files it can’t parse or that have no CLI session, and ignores unknown fields', () => {
    const id = randomUUID()
    const good = writeDesktopChat(root, 'Claude', { cliSessionId: id, title: 'Fine', futureField: { nested: [1, 2] } })
    writeFileSync(join(good, '..', 'local_broken.json'), '{ "cliSessionId": ')
    writeDesktopChat(root, 'Claude', { title: 'Not started yet' })
    const chats = createDesktopMeta(root).read()
    expect([...chats.keys()]).toEqual([id])
  })

  it('keeps the newest file when two point at the same session, and sees edits on the next read', () => {
    const id = randomUUID()
    writeDesktopChat(root, 'Claude', { cliSessionId: id, title: 'Older copy', lastActivityAt: 1000 })
    const newer = writeDesktopChat(root, 'Claude', { cliSessionId: id, title: 'Newer copy', lastActivityAt: 5000 })
    const meta = createDesktopMeta(root)
    expect(meta.read().get(id)?.title).toBe('Newer copy')

    writeFileSync(newer, JSON.stringify({ cliSessionId: id, title: 'Renamed', lastActivityAt: 6000 }))
    utimesSync(newer, new Date(), new Date(Date.now() + 5000))
    expect(meta.read().get(id)?.title).toBe('Renamed')
  })

  it('reads recent files in full, and older ones only when their session is wanted', () => {
    const [recent, old] = [randomUUID(), randomUUID()]
    writeDesktopChat(root, 'Claude', { cliSessionId: recent, title: 'Today' })
    const stale = writeDesktopChat(root, 'Claude', { cliSessionId: old, title: 'Last week, still running', enabledMcpTools: { big: 'x'.repeat(8000) } })
    const weekAgo = new Date(Date.now() - 7 * 86_400_000)
    utimesSync(stale, weekAgo, weekAgo)
    const meta = createDesktopMeta(root)
    const since = Date.now() - 86_400_000
    expect([...meta.read(since).keys()]).toEqual([recent])
    expect(meta.read(since, new Set([old])).get(old)?.title).toBe('Last week, still running')
  })

  it('calls back when a chat file changes', async () => {
    writeDesktopChat(root, 'Claude', { cliSessionId: randomUUID(), title: 'Watched' })
    const changed = vi.fn()
    const stop = createDesktopMeta(root).watch(changed)
    try {
      await new Promise((resolve) => setTimeout(resolve, 200))
      writeDesktopChat(root, 'Claude', { cliSessionId: randomUUID(), title: 'New chat' })
      await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 5000 })
    } finally {
      stop()
    }
  })
})
