import type { Rectangle } from 'electron'

interface Movable {
  on(event: 'moved' | 'resized', listener: () => void): unknown
  getBounds(): Rectangle
  isFullScreen(): boolean
}

const overlap = (a: Rectangle, b: Rectangle) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

/** The saved bounds, if at least half the window still lands on one connected display. */
export function fitBounds(saved: Rectangle | undefined, displays: readonly Rectangle[]): Rectangle | undefined {
  if (!saved) return undefined
  return displays.some((area) => overlap(saved, area) >= (saved.width * saved.height) / 2) ? saved : undefined
}

/** Saves the window's place whenever it settles, so it survives the app being killed for an update. */
export function rememberBounds(win: Movable, save: (bounds: Rectangle) => void): void {
  const settled = () => {
    if (!win.isFullScreen()) save(win.getBounds())
  }
  win.on('moved', settled)
  win.on('resized', settled)
}
