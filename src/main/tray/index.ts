import { app, Menu, nativeImage, Tray } from 'electron'
import { stripBitmap, type StripState } from './strip'

export function createTray(show: () => void, read: () => StripState) {
  const tray = new Tray(image({ needs: 0, dots: [] }))
  tray.setToolTip('Agent Office')
  tray.on('click', show)
  tray.on('right-click', () => tray.popUpContextMenu(menu(show)))
  let last = ''
  const update = () => {
    const state = read()
    const key = JSON.stringify(state)
    if (key === last || tray.isDestroyed()) return
    last = key
    tray.setImage(image(state))
    tray.setTitle(state.needs ? String(state.needs) : '', { fontType: 'monospacedDigit' })
    tray.setToolTip(state.needs ? `Agent Office · ${state.needs} waiting for you` : 'Agent Office')
  }
  update()
  return { tray, update }
}

function menu(show: () => void): Menu {
  return Menu.buildFromTemplate([
    { label: 'Show Agent Office', click: show },
    {
      label: 'Open at Login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ])
}

function image(state: StripState): Electron.NativeImage {
  const { pixels, width, height } = stripBitmap(state)
  const icon = nativeImage.createFromBitmap(pixels, { width, height, scaleFactor: 2 })
  icon.setTemplateImage(true)
  return icon
}
