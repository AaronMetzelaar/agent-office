import { describe, expect, it } from 'vitest'
import { appleScriptQuote, findInstancePid, handoffScript, pickTerminalApp, shQuote, terminalAppleScript } from '../../src/main/handoff'

describe('shQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shQuote('/Users/aaron/repo')).toBe("'/Users/aaron/repo'")
  })

  it('escapes an embedded single quote', () => {
    expect(shQuote("it's-mine")).toBe("'it'\\''s-mine'")
  })

  it('keeps spaces intact inside the quotes', () => {
    expect(shQuote('/Users/aaron/My Project')).toBe("'/Users/aaron/My Project'")
  })
})

describe('handoffScript', () => {
  const script = handoffScript({ cwd: '/Users/aaron/My Project', token: 'sk-secret-token', sessionId: 'sess-123' })

  it('deletes itself before anything else runs', () => {
    const lines = script.split('\n')
    expect(lines[1]).toBe('rm -f -- "$0"')
  })

  it('cds into the quoted cwd, spaces and all', () => {
    expect(script).toContain("cd -- '/Users/aaron/My Project' || exit 1")
  })

  it('carries the fork flag so the office chat is never touched', () => {
    expect(script).toContain('--fork-session')
    expect(script).toContain("--resume 'sess-123'")
  })

  it('exports the token only as an env var, not inline on the claude command', () => {
    expect(script).toContain("export CLAUDE_CODE_OAUTH_TOKEN='sk-secret-token'")
    const claudeLine = script.split('\n').find((line) => line.includes('exec claude'))
    expect(claudeLine).not.toContain('sk-secret-token')
  })
})

describe('handoffScript on the Claude Code login', () => {
  it('drops any inherited token so claude uses its own login', () => {
    const script = handoffScript({ cwd: '/tmp', token: null, sessionId: 'sess-123' })
    expect(script).toContain('unset CLAUDE_CODE_OAUTH_TOKEN')
    expect(script).not.toContain('export CLAUDE_CODE_OAUTH_TOKEN')
  })
})

describe('appleScriptQuote', () => {
  it('escapes double quotes and backslashes', () => {
    expect(appleScriptQuote('bash \'/tmp/a "b".sh\'')).toBe('"bash \'/tmp/a \\"b\\".sh\'"')
  })
})

describe('pickTerminalApp', () => {
  it('picks iTerm2 when iTerm is installed', () => {
    expect(pickTerminalApp((path) => path === '/Applications/iTerm.app')).toBe('iTerm2')
  })

  it('falls back to Terminal otherwise', () => {
    expect(pickTerminalApp(() => false)).toBe('Terminal')
  })
})

describe('terminalAppleScript', () => {
  it('uses do script for Terminal', () => {
    const script = terminalAppleScript('Terminal', "bash '/tmp/x.sh'")
    expect(script).toContain('tell application "Terminal"')
    expect(script).toContain('do script "bash \'/tmp/x.sh\'"')
  })

  it('uses create window with default profile command for iTerm2', () => {
    const script = terminalAppleScript('iTerm2', "bash '/tmp/x.sh'")
    expect(script).toContain('tell application "iTerm2"')
    expect(script).toContain('create window with default profile command "bash \'/tmp/x.sh\'"')
  })
})

describe('findInstancePid', () => {
  const psOutput = [
    '36727 /Applications/Claude.app/Contents/MacOS/Claude',
    "93231 /Applications/Claude.app/Contents/MacOS/Claude --user-data-dir=/Users/aaron/Library/Application Support/Claude-Research",
    '36742 /Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=gpu-process',
  ].join('\n')

  it('finds the main instance', () => {
    expect(findInstancePid(psOutput, false)).toBe(36727)
  })

  it('finds the research instance by its --user-data-dir', () => {
    expect(findInstancePid(psOutput, true)).toBe(93231)
  })

  it('ignores helper processes', () => {
    expect(findInstancePid('36742 /Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper', false)).toBeUndefined()
  })

  it('returns undefined when the instance is not running', () => {
    expect(findInstancePid('36727 /Applications/Claude.app/Contents/MacOS/Claude', true)).toBeUndefined()
  })
})
