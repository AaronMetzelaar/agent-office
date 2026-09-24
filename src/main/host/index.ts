import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { createCore, prepareCore } from './core'
import { whenIdle } from './idle'
import { hostBuild, hostSecret, pidPath, socketPath } from './identity'
import { createHostServer } from './server'
import { remoteUi } from './ui'

const dataDir = process.env.AGENT_OFFICE_USER_DATA ?? app.getPath('userData')
app.setPath('userData', join(dataDir, 'host'))
app.dock?.hide()

if (app.requestSingleInstanceLock()) void app.whenReady().then(run)
else app.exit(0)

async function run(): Promise<void> {
  app.dock?.hide()
  const server = createHostServer(hostSecret(dataDir), hostBuild(__dirname))
  const core = createCore(dataDir, server, remoteUi(server), await prepareCore())
  let cancelRestart: (() => void) | undefined
  let exiting = false
  const exit = () => {
    if (exiting) return
    exiting = true
    console.info('[host] stopping')
    core.shutdown()
    rmSync(pidPath(dataDir), { force: true })
    void server.close().finally(() => app.exit(0))
  }
  server.handle('busy', core.busy)
  server.handle('exit', () => void setImmediate(exit))
  server.handle('exitWhenIdle', () => {
    cancelRestart ??= whenIdle(core.store, exit)
  })
  server.events.on('disconnect', () => {
    if (server.clients()) return
    cancelRestart?.()
    cancelRestart = undefined
  })
  process.on('SIGTERM', exit)
  process.on('SIGINT', exit)
  app.on('before-quit', core.shutdown)
  await server.listen(socketPath(dataDir))
  writeFileSync(pidPath(dataDir), String(process.pid))
  console.info(`[host] ready, pid ${process.pid}`)
}
