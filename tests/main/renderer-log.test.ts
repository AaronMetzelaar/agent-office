import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { forwardRendererErrors } from '../../src/main/renderer-log'

describe('renderer errors', () => {
  it('prints renderer errors, crashes and preload failures to stdout with a [renderer] prefix', () => {
    const contents = new EventEmitter()
    const lines: string[] = []
    forwardRendererErrors(contents as never, (line) => lines.push(line))
    contents.emit('console-message', { level: 'info', message: 'hello', sourceId: 'app://office/index.js', lineNumber: 1 })
    contents.emit('console-message', { level: 'error', message: 'Uncaught TypeError: hands[0] is undefined', sourceId: 'app://office/world.js', lineNumber: 42 })
    contents.emit('console-message', { level: 'error', message: 'Uncaught (in promise) Error: offline', sourceId: '', lineNumber: 0 })
    contents.emit('render-process-gone', {}, { reason: 'crashed' })
    contents.emit('preload-error', {}, '/preload/index.js', new Error('bad preload'))
    expect(lines).toEqual([
      '[renderer] Uncaught TypeError: hands[0] is undefined (app://office/world.js:42)',
      '[renderer] Uncaught (in promise) Error: offline',
      '[renderer] process gone: crashed',
      expect.stringMatching(/^\[renderer\] preload \/preload\/index\.js failed: Error: bad preload/),
    ])
  })
})
