import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol, session, shell, type BrowserWindow } from 'electron'

const bundleScheme = 'app'
export const bundleUrl = `${bundleScheme}://office/index.html`

export function contentSecurityPolicy(devServerUrl?: string): string {
  const devSocket = devServerUrl ? ` ws://${new URL(devServerUrl).host}` : ''
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${devSocket}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

export function isAppUrl(url: string, appUrl: string): boolean {
  const target = URL.parse(url)
  const app = URL.parse(appUrl)
  return !!target && !!app && target.protocol === app.protocol && target.host === app.host
}

export function isWebUrl(url: string): boolean {
  const protocol = URL.parse(url)?.protocol
  return protocol === 'https:' || protocol === 'http:'
}

export function bundleFile(root: string, requestUrl: string): string | undefined {
  const pathname = URL.parse(requestUrl)?.pathname
  if (!pathname) return undefined
  try {
    const file = join(root, decodeURIComponent(pathname === '/' ? '/index.html' : pathname))
    return file.startsWith(root + sep) ? file : undefined
  } catch {
    return undefined
  }
}

interface IpcSender {
  sender: unknown
  senderFrame: { url: string } | null
}

export function isTrustedSender(event: IpcSender, win: { webContents: unknown }, appUrl: string): boolean {
  return event.sender === win.webContents && !!event.senderFrame && isAppUrl(event.senderFrame.url, appUrl)
}

export function registerBundleScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: bundleScheme, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ])
}

export function secureSession(devServerUrl: string | undefined, rendererDir: string): void {
  const csp = contentSecurityPolicy(devServerUrl)
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'))
  if (devServerUrl) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
    })
    return
  }
  protocol.handle(bundleScheme, async (request) => {
    const file = bundleFile(rendererDir, request.url)
    const response = file ? await net.fetch(pathToFileURL(file).href).catch(() => undefined) : undefined
    if (!response?.ok) return new Response('Not found', { status: 404 })
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', csp)
    return new Response(response.body, { status: response.status, headers })
  })
}

export function hardenWindow(win: BrowserWindow, appUrl: string): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => {
    if (isAppUrl(event.url, appUrl)) return
    event.preventDefault()
    if (isWebUrl(event.url)) void shell.openExternal(event.url)
  })
}
