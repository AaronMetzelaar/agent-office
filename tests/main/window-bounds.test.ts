import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prefsFile } from '../../src/main/prefs'
import { fitBounds, rememberBounds } from '../../src/main/window-bounds'

const laptop = { x: 0, y: 25, width: 1512, height: 920 }
const monitor = { x: 1512, y: 0, width: 2560, height: 1415 }

describe('window bounds', () => {
  it('puts the window back on the display it was on', () => {
    const saved = { x: 1700, y: 100, width: 1440, height: 900 }
    expect(fitBounds(saved, [laptop, monitor])).toEqual(saved)
  })

  it('falls back to the default place when that display is gone or holds too little of the window', () => {
    expect(fitBounds({ x: 1700, y: 100, width: 1440, height: 900 }, [laptop])).toBeUndefined()
    expect(fitBounds({ x: 1200, y: 100, width: 1440, height: 900 }, [laptop])).toBeUndefined()
    expect(fitBounds(undefined, [laptop])).toBeUndefined()
  })

  it('saves the bounds each time the window settles, but not in full screen', () => {
    const saves: unknown[] = []
    let fullScreen = false
    const bounds = { x: 10, y: 40, width: 1200, height: 800 }
    const win = Object.assign(new EventEmitter(), { getBounds: () => bounds, isFullScreen: () => fullScreen })
    rememberBounds(win, (next) => saves.push(next))
    win.emit('moved')
    win.emit('resized')
    fullScreen = true
    win.emit('resized')
    expect(saves).toEqual([bounds, bounds])
  })
})

describe('prefs file', () => {
  it('merges each save into what is there, and starts empty when the file is missing or broken', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-office-prefs-'))
    try {
      const path = join(dir, 'window.json')
      const prefs = prefsFile(path)
      expect(prefs.read()).toEqual({})
      prefs.save({ autoUpdate: true })
      prefs.save({ commit: 'abc1234' })
      expect(prefs.read()).toEqual({ autoUpdate: true, commit: 'abc1234' })
      writeFileSync(path, '{"autoUpd')
      expect(prefs.read()).toEqual({})
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
