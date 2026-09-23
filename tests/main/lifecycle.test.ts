import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { hideOnClose, reveal } from '../../src/main/lifecycle'

function fakeWindow(minimized = false) {
  return Object.assign(new EventEmitter(), {
    isMinimized: () => minimized,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  })
}

function fakeApp() {
  return Object.assign(new EventEmitter(), { quit: vi.fn() })
}

function quitEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
  }
}

function close(win: EventEmitter) {
  const event = { preventDefault: vi.fn() }
  win.emit('close', event)
  return event
}

describe('hideOnClose', () => {
  it('hides the window instead of closing it', () => {
    const app = fakeApp()
    const win = fakeWindow()
    const hide = vi.fn()
    hideOnClose(app, win, hide)

    expect(close(win).preventDefault).toHaveBeenCalled()
    expect(hide).toHaveBeenCalled()
  })

  it('lets the window close once the app is quitting', () => {
    const app = fakeApp()
    const win = fakeWindow()
    const hide = vi.fn()
    hideOnClose(app, win, hide)

    app.emit('before-quit', quitEvent())

    expect(close(win).preventDefault).not.toHaveBeenCalled()
    expect(hide).not.toHaveBeenCalled()
  })
})

describe('reveal', () => {
  it('shows and focuses a hidden window', () => {
    const win = fakeWindow()
    reveal(win)
    expect(win.restore).not.toHaveBeenCalled()
    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
  })

  it('restores a minimized window first', () => {
    const win = fakeWindow(true)
    reveal(win)
    expect(win.restore).toHaveBeenCalled()
    expect(win.show).toHaveBeenCalled()
  })
})
