interface Quittable {
  on(event: 'before-quit', listener: () => void): unknown
}

interface Closable {
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): unknown
}

interface Revealable {
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

export function hideOnClose(app: Quittable, win: Closable, hide: () => void): void {
  let quitting = false
  app.on('before-quit', () => {
    quitting = true
  })
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    hide()
  })
}

export function reveal(win: Revealable): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
