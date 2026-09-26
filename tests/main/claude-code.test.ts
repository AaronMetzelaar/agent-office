import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeCode, type Probe } from '../../src/main/claude-code'

describe('Claude Code on this Mac', () => {
  let home: string
  beforeEach(() => void (home = mkdtempSync(join(tmpdir(), 'agent-office-cc-'))))
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  const probe = (found: string[]): Probe => async (command) => found.includes(command)

  it('finds the CLI on the login PATH and the login in the Keychain', async () => {
    const seen: [string, string[], string][] = []
    const run: Probe = async (command, args, path) => (seen.push([command, args, path]), true)
    expect(await claudeCode(async () => '/opt/homebrew/bin', run, home)).toEqual({ installed: true, signedIn: true })
    expect(seen).toEqual([
      ['/usr/bin/which', ['claude'], '/opt/homebrew/bin'],
      ['/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials'], '/opt/homebrew/bin'],
    ])
  })

  it('falls back to the local install and the credentials file', async () => {
    expect(await claudeCode(async () => '', probe([]), home)).toEqual({ installed: false, signedIn: false })
    mkdirSync(join(home, '.claude', 'local'), { recursive: true })
    writeFileSync(join(home, '.claude', 'local', 'claude'), '')
    writeFileSync(join(home, '.claude', '.credentials.json'), '{}')
    expect(await claudeCode(async () => '', probe([]), home)).toEqual({ installed: true, signedIn: true })
  })
})
