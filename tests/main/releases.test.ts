import { describe, expect, it } from 'vitest'
import { createReleaseCheck, latestRelease, newer } from '../../src/main/releases'
import type { AppUpdate } from '../../src/shared/ipc'

const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status })

describe('release check for downloaded builds', () => {
  it('compares versions by number, ignoring a leading v', () => {
    expect(newer('v0.2.0', '0.1.9')).toBe(true)
    expect(newer('0.10.0', '0.9.0')).toBe(true)
    expect(newer('v0.1.0', '0.1.0')).toBe(false)
    expect(newer('0.1.0', '0.2.0')).toBe(false)
  })

  it('offers the release page when GitHub has a newer version, and opens it on install', async () => {
    const changes: AppUpdate[] = []
    const opened: string[] = []
    const urls: string[] = []
    const check = createReleaseCheck({ version: '0.1.0', changed: (update) => changes.push(update), open: (url) => opened.push(url), fetch: async (url) => (urls.push(String(url)), reply({ tag_name: 'v0.2.0', name: 'Agent Office 0.2.0', html_url: 'https://github.com/AaronMetzelaar/agent-office/releases/tag/v0.2.0' })()) })
    await check.check()
    expect(urls).toEqual([latestRelease])
    expect(check.state()).toEqual({ behind: 1, subjects: ['Agent Office 0.2.0'], download: 'https://github.com/AaronMetzelaar/agent-office/releases/tag/v0.2.0' })
    expect(changes).toHaveLength(1)
    check.install()
    expect(opened).toEqual(['https://github.com/AaronMetzelaar/agent-office/releases/tag/v0.2.0'])
  })

  it('stays quiet on the same version, an error response or no network', async () => {
    for (const fetch of [reply({ tag_name: 'v0.1.0', html_url: 'x' }), reply({}, 404), async () => Promise.reject(new Error('offline'))]) {
      const changes: AppUpdate[] = []
      const check = createReleaseCheck({ version: '0.1.0', changed: (update) => changes.push(update), open: () => {}, fetch })
      await check.check()
      expect(check.state()).toEqual({ behind: 0, subjects: [] })
      expect(changes).toEqual([])
    }
  })
})
