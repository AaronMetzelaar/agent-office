import { app, Menu, nativeImage, Tray } from 'electron'

export function createTray(show: () => void): Tray {
  const tray = new Tray(glyph())
  tray.setToolTip('Agent Office')
  tray.on('click', show)
  tray.on('right-click', () => tray.popUpContextMenu(menu(show)))
  return tray
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

function glyph(): Electron.NativeImage {
  const size = 32
  const pixels = Buffer.alloc(size * size * 4)
  const center = size / 2
  const radius = size * 0.32
  const stroke = size * 0.14
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center)
      const coverage = Math.min(1, Math.max(0, stroke / 2 - Math.abs(distance - radius) + 0.5))
      pixels[(y * size + x) * 4 + 3] = Math.round(coverage * 255)
    }
  }
  const image = nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 2 })
  image.setTemplateImage(true)
  return image
}
