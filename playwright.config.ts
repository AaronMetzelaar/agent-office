import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

process.env.AGENT_OFFICE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'agent-office-config-'))
process.env.AGENT_OFFICE_FAKE_GH = '1'

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 30_000,
})
