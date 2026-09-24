import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fallbackPath, loginShellPath, type ShellRun } from '../../src/main/login-path'

const finderPath = '/usr/bin:/bin:/usr/sbin:/sbin'
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-path-'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('login shell PATH', () => {
  it('reads PATH from an interactive login shell, ignoring whatever the shell prints around it', async () => {
    const run = vi.fn<ShellRun>(async () => 'Welcome back!\n__AGENT_OFFICE_PATH__/opt/homebrew/bin:/Users/a/.local/bin:/usr/bin__AGENT_OFFICE_PATH__\n')
    expect(await loginShellPath({ shell: '/bin/zsh', run, current: finderPath, home: '/Users/a' })).toBe('/opt/homebrew/bin:/Users/a/.local/bin:/usr/bin')
    expect(run).toHaveBeenCalledWith('/bin/zsh', ['-ilc', `printf '__AGENT_OFFICE_PATH__%s__AGENT_OFFICE_PATH__' "$PATH"`], 3000)
  })

  it('falls back to adding Homebrew and ~/.local/bin when the shell fails, hangs or prints nothing', async () => {
    const expected = `${finderPath}:/opt/homebrew/bin:/usr/local/bin:/Users/a/.local/bin`
    const failing: ShellRun = async () => {
      throw Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' })
    }
    expect(await loginShellPath({ run: failing, current: finderPath, home: '/Users/a' })).toBe(expected)
    expect(await loginShellPath({ run: async () => 'no marker here', current: finderPath, home: '/Users/a' })).toBe(expected)
  })

  it('does not repeat folders already on PATH', () => {
    expect(fallbackPath('/opt/homebrew/bin:/usr/bin', '/Users/a')).toBe('/opt/homebrew/bin:/usr/bin:/usr/local/bin:/Users/a/.local/bin')
    expect(fallbackPath('', '/Users/a')).toBe('/opt/homebrew/bin:/usr/local/bin:/Users/a/.local/bin')
  })

  it('runs a real shell, and gives up on one that hangs after the timeout', async () => {
    const shell = join(dir, 'shell')
    writeFileSync(shell, '#!/bin/sh\necho "loading plugins"\nPATH=/from/login:/usr/bin\neval "$2"\n')
    chmodSync(shell, 0o755)
    expect(await loginShellPath({ shell, current: finderPath, home: '/Users/a' })).toBe('/from/login:/usr/bin')

    const hanging = join(dir, 'hanging')
    writeFileSync(hanging, '#!/bin/sh\nexec sleep 5\n')
    chmodSync(hanging, 0o755)
    const started = Date.now()
    expect(await loginShellPath({ shell: hanging, timeoutMs: 200, current: finderPath, home: '/Users/a' })).toContain('/opt/homebrew/bin')
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
