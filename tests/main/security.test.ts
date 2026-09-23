import { describe, expect, it, vi } from 'vitest'
import { bundleFile, contentSecurityPolicy, isAppUrl, isTrustedSender, isWebUrl } from '../../src/main/security'

vi.mock('electron', () => ({}))

const appUrl = 'app://office/index.html'

describe('contentSecurityPolicy', () => {
  it('allows scripts from the bundle only and no eval', () => {
    const policy = contentSecurityPolicy()
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("script-src 'self';")
    expect(policy).not.toContain('unsafe-eval')
    expect(policy).toContain("img-src 'self' data: blob:")
    expect(policy).toContain("connect-src 'self';")
  })

  it('opens connect-src to the dev server socket only in dev', () => {
    const policy = contentSecurityPolicy('http://localhost:5173')
    expect(policy).toContain("connect-src 'self' ws://localhost:5173;")
    expect(policy).toContain("script-src 'self';")
  })
})

describe('isAppUrl', () => {
  it.each([
    ['app://office/assets/index.js', true],
    ['app://office/index.html#inbox', true],
    ['app://evil/index.html', false],
    ['app://office@evil/index.html', false],
    ['https://office/index.html', false],
    ['file:///etc/hosts', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isAppUrl(url, appUrl)).toBe(expected)
  })

  it('matches the dev server origin in dev', () => {
    expect(isAppUrl('http://localhost:5173/src/main.ts', 'http://localhost:5173')).toBe(true)
    expect(isAppUrl('http://localhost:5174/', 'http://localhost:5173')).toBe(false)
  })
})

describe('isWebUrl', () => {
  it.each([
    ['https://example.com/docs', true],
    ['http://example.com', true],
    ['file:///etc/hosts', false],
    ['javascript:alert(1)', false],
    ['mailto:someone@example.com', false],
    ['app://office/index.html', false],
    ['', false],
  ])('%s → %s', (url, expected) => {
    expect(isWebUrl(url)).toBe(expected)
  })
})

describe('bundleFile', () => {
  const root = '/bundle/renderer'

  it('serves index.html for the root and files inside the bundle', () => {
    expect(bundleFile(root, 'app://office/')).toBe('/bundle/renderer/index.html')
    expect(bundleFile(root, 'app://office/assets/index.js')).toBe('/bundle/renderer/assets/index.js')
  })

  it('refuses paths that escape the bundle', () => {
    expect(bundleFile(root, 'app://office/..%2F..%2Fetc%2Fhosts')).toBeUndefined()
    expect(bundleFile(root, 'app://office/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc')).toBeUndefined()
    expect(bundleFile(root, 'app://office/%E0%A4%A')).toBeUndefined()
  })
})

describe('isTrustedSender', () => {
  const appContents = {}
  const win = { webContents: appContents }

  it('accepts the app window main frame', () => {
    expect(isTrustedSender({ sender: appContents, senderFrame: { url: appUrl } }, win, appUrl)).toBe(true)
  })

  it('rejects another webContents even on the app URL', () => {
    expect(isTrustedSender({ sender: {}, senderFrame: { url: appUrl } }, win, appUrl)).toBe(false)
  })

  it('rejects a frame showing foreign content or a detached frame', () => {
    expect(isTrustedSender({ sender: appContents, senderFrame: { url: 'https://evil.example' } }, win, appUrl)).toBe(false)
    expect(isTrustedSender({ sender: appContents, senderFrame: null }, win, appUrl)).toBe(false)
  })
})
