import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/main/departments/config'

let dir: string

const write = (value: unknown) => writeFileSync(join(dir, 'departments.json'), typeof value === 'string' ? value : JSON.stringify(value))
const empty = { rooms: [], playground: [], commands: {} }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-config-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('departments.json', () => {
  it('parses folder rooms, account rooms, playground folders and commands, expanding ~', () => {
    const commands = { ship: ['/mws-test-cases', '/mws-verify', '/mws-review', '/mws-pr'], fixCi: '/gh-fix-ci', answerComments: '/pr-comment-rundown', review: '/pr-review-rundown' }
    write({
      rooms: [
        { name: 'API', folders: ['~/code/api', '/srv/api'], accent: '#3B7BFF', look: 'servers' },
        { name: 'Web app', folders: ['~/code/web'] },
        { name: 'Research gym', account: 'research', accent: '#8b5cf6', look: 'gym' },
      ],
      playground: ['~', '/tmp/scratch'],
      commands,
    })
    expect(loadConfig(dir)).toEqual({
      config: {
        rooms: [
          { id: 'c-api', name: 'API', folders: [join(homedir(), 'code/api'), '/srv/api'], accent: '#3b7bff', look: 'servers' },
          { id: 'c-web-app', name: 'Web app', folders: [join(homedir(), 'code/web')] },
          { id: 'c-research-gym', name: 'Research gym', account: 'research', accent: '#8b5cf6', look: 'gym' },
        ],
        playground: [homedir(), '/tmp/scratch'],
        commands,
      },
      skipped: [],
    })
  })

  it('gives an empty config with no errors and building not paused when the file is missing', () => {
    expect(loadConfig(dir)).toEqual({ config: empty, skipped: [] })
    expect(loadConfig(dir).unreadable).toBeUndefined()
  })

  it('pauses building with the parse message when the file isn’t valid JSON', () => {
    write('{ "rooms": [ }')
    const { config, skipped, unreadable } = loadConfig(dir)
    expect(unreadable).toMatch(/JSON/)
    expect(config).toEqual(empty)
    expect(skipped).toEqual([])
  })

  it('pauses building and points to the new format when the file uses the old array format', () => {
    write([{ path: 'monorepo/frontend/marketplace', dept: 'mkt' }])
    expect(loadConfig(dir)).toEqual({ config: empty, skipped: [], unreadable: 'it uses the old list format; see the README for the new format' })
  })

  it('skips bad rooms one by one, naming each, and keeps the valid ones', () => {
    write({
      rooms: [
        { name: 'Both', folders: ['/a'], account: 'research' },
        { name: 'Neither' },
        { name: 'Castle', folders: ['/b'], look: 'castle' },
        { name: 'Red', folders: ['/c'], accent: 'red' },
        { folders: ['/d'] },
        { name: 'Kept', folders: ['/e'] },
      ],
    })
    const { config, skipped, unreadable } = loadConfig(dir)
    expect(config.rooms).toEqual([{ id: 'c-kept', name: 'Kept', folders: ['/e'] }])
    expect(skipped).toEqual([
      'Skipped room "Both": it needs either folders or an account, not both',
      'Skipped room "Neither": it needs either folders or an account, not both',
      'Skipped room "Castle": look isn’t one of showroom, backoffice, devices, servers, reading, gym, playground, plain',
      'Skipped room "Red": accent isn’t a colour like #3b7bff',
      'Skipped room 5: it has no name',
    ])
    expect(unreadable).toBeUndefined()
  })

  it('skips a room whose name gives the same id as an earlier one, and hashes names with no Latin letters', () => {
    write({
      rooms: [
        { name: 'API', folders: ['/a'] },
        { name: 'api', folders: ['/b'] },
        { name: 'Web app', folders: ['/c'] },
        { name: 'web-app', folders: ['/d'] },
        { name: 'Кухня', folders: ['/e'] },
        { name: '厨房', folders: ['/f'] },
      ],
    })
    const { config, skipped } = loadConfig(dir)
    const ids = config.rooms.map((room) => room.id)
    expect(ids.slice(0, 2)).toEqual(['c-api', 'c-web-app'])
    expect(ids.slice(2)).toEqual([expect.stringMatching(/^c-[0-9a-f]{8}$/), expect.stringMatching(/^c-[0-9a-f]{8}$/)])
    expect(new Set(ids).size).toBe(4)
    expect(skipped).toEqual(['Skipped room "api": another room already uses this name', 'Skipped room "web-app": another room already uses this name'])
  })
})
