import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

process.env.AGENT_OFFICE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'agent-office-config-'))
process.env.AGENT_OFFICE_DESKTOP_DIR = mkdtempSync(join(tmpdir(), 'agent-office-desktop-'))
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'agent-office-claude-'))
process.env.AGENT_OFFICE_FAKE_GH = '1'
process.env.AGENT_OFFICE_HIDDEN = '1'

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 30_000,
})
