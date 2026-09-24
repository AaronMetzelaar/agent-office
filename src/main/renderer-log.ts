import type { WebContents } from 'electron'

type Contents = Pick<WebContents, 'on'>

export function forwardRendererErrors(contents: Contents, write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): void {
  contents.on('console-message', (details) => {
    if (details.level === 'error') write(`[renderer] ${details.message}${details.sourceId ? ` (${details.sourceId}:${details.lineNumber})` : ''}`)
  })
  contents.on('render-process-gone', (_event, details) => write(`[renderer] process gone: ${details.reason}`))
  contents.on('preload-error', (_event, path, error) => write(`[renderer] preload ${path} failed: ${error.stack ?? error.message}`))
}
