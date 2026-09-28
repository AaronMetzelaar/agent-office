interface QuitEvent {
  preventDefault(): void
  defaultPrevented: boolean
}

interface Quittable {
  on(event: 'before-quit', listener: (event: QuitEvent) => void): unknown
  quit(): void
}

interface Closable {
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): unknown
}

interface Stageable {
  show(): void
  hide(): void
  focus(): void
  isVisible(): boolean
}

interface Revealable {
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

export function confirmQuitWhileBusy(app: Quittable, busy: () => boolean, confirm: () => Promise<boolean>, beforeQuit: () => void): void {
  let confirmed = false
  app.on('before-quit', (event) => {
    if (!confirmed && busy()) {
      event.preventDefault()
      void confirm().then((ok) => {
        if (!ok) return
        confirmed = true
        app.quit()
      })
      return
    }
    beforeQuit()
  })
}

export function hideOnClose(app: Quittable, win: Closable, hide: () => void): void {
  let quitting = false
  app.on('before-quit', (event) => {
    quitting = !event.defaultPrevented
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

export function offstage(win: Stageable): void {
  let visible = false
  Object.assign(win, {
    show: () => {
      visible = true
    },
    hide: () => {
      visible = false
    },
    focus: () => {},
    isVisible: () => visible,
  })
}

/** How the window comes back after an update restarts the app: in front, behind the app in use, or still closed to the tray. */
export type Reopen = 'front' | 'background' | 'hidden'

interface Watchable {
  isVisible(): boolean
  isFocused(): boolean
}

export const reopenAs = (win: Watchable): Reopen => (!win.isVisible() ? 'hidden' : win.isFocused() ? 'front' : 'background')

export function reopenFrom(argv: readonly string[]): Reopen {
  const value = argv.find((arg) => arg.startsWith('--reopen='))?.slice('--reopen='.length)
  return value === 'background' || value === 'hidden' ? value : 'front'
}
