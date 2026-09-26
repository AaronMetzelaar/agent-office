import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { openDb } from '../../src/main/store/db'
import type { RoomDef } from '../../src/shared/departments'
import { checkDesign, tidy, type Design } from '../../src/shared/looks'
import { gitRepo } from '../fakes/repos'

const root = resolve(__dirname, '../..')
const spike = join(root, 'docs/solutions/look-spike')
const model = process.env.AGENT_OFFICE_LOOK_MODEL ?? 'claude-opus-5'
const source = process.env.AGENT_OFFICE_LOOK_DIR ? resolve(root, process.env.AGENT_OFFICE_LOOK_DIR) : join(spike, model)
const shots = join(spike, 'shots', process.env.AGENT_OFFICE_LOOK_DIR ? source.slice(spike.length + 1).replace(/\//g, '-') : model)
const accents = [0x0891b2, 0xd97706, 0x7c3aed, 0x059669, 0xdc2626, 0x2563eb]

test.skip(process.env.AGENT_OFFICE_LOOK_SHOTS !== '1' || !existsSync(source), 'Set AGENT_OFFICE_LOOK_SHOTS=1 after running tests/main/look-spike.test.ts')

test(`draws the ${model} looks from the generation spike`, async () => {
  test.setTimeout(240_000)
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'ao-looks-')))
  const userData = join(scratch, 'data')
  const env = { ...process.env, AGENT_OFFICE_USER_DATA: userData, AGENT_OFFICE_CONFIG_DIR: mkdtempSync(join(scratch, 'config-')), AGENT_OFFICE_FAKE_VALIDATOR: '1', AGENT_OFFICE_FAKE_ENGINE: '1' }
  const looks = readdirSync(source).filter((file) => file.endsWith('.json')).map((file) => {
    const saved = JSON.parse(readFileSync(join(source, file), 'utf8')) as { room?: string; attempts: { design?: Design }[] }
    const attempts = saved.attempts.map((a) => (a.design ? { ...a, design: tidy(a.design) } : a))
    const design = [...attempts].reverse().find((a) => a.design && !checkDesign(a.design).length)?.design ?? attempts.find((a) => a.design)?.design
    return { repo: file.replace(/\.json$/, ''), name: saved.room ?? file.replace(/\.json$/, ''), design }
  }).filter((look): look is { repo: string; name: string; design: Design } => !!look.design)
  const repos = looks.map((look) => gitRepo(join(scratch, 'code', look.repo)))

  let app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  let page = await app.firstWindow()
  const accountId = await page.evaluate(async () => {
    const added = await window.office.addAccount('main', 'sk-ant-oat01-fake-ok')
    if (!('account' in added)) throw new Error(added.error)
    return added.account.id
  })
  await app.close()

  const db = openDb(join(userData, 'office.db'))
  db.saveSetting('rooms', looks.map((look, i): RoomDef => ({ id: `r-look${i}`, name: look.name, subtitle: `~/code/${look.repo}`, accent: accents[i % accents.length]!, look: 'plain', root: repos[i]!, createdAt: Date.now() - (looks.length - i) * 1000, design: look.design })))
  db.close()

  app = await electron.launch({ args: ['--use-mock-keychain', root], env })
  page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const [i, repo] of repos.entries())
    for (let k = 0; k < (i % 2 ? 4 : 2); k++) {
      const started = await page.evaluate(({ accountId, repo, k }) => window.office.startChat(accountId, repo, `Task ${k} [hang]`), { accountId, repo, k })
      expect(started).toHaveProperty('chatId')
    }
  for (const look of looks) await expect(page.locator('.sign', { hasText: look.name })).toBeVisible()
  mkdirSync(shots, { recursive: true })
  await page.waitForTimeout(3000)
  await page.screenshot({ path: join(shots, 'floor.png') })
  for (const look of looks) {
    await page.locator('.sign', { hasText: look.name }).click()
    await page.waitForTimeout(2500)
    await page.screenshot({ path: join(shots, `${look.repo}.png`) })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1500)
  }
  expect(errors).toEqual([])
  await app.evaluate(({ dialog }) => Object.assign(dialog, { showMessageBox: async () => ({ response: 0, checkboxChecked: false }) }))
  await app.close()
  rmSync(scratch, { recursive: true, force: true })
})
