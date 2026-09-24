import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isSimulatorDevice, type SimulatorShot } from '../shared/chat'

const run = promisify(execFile)

export function whyNoShot(stderr: string): string {
  if (/unable to find utility "simctl"/.test(stderr)) return 'Xcode isn’t installed, so the office can’t see the simulator.'
  if (/No devices are booted|Invalid device|Shutdown/i.test(stderr)) return 'The simulator isn’t running.'
  return stderr.trim().split('\n').pop() || 'Couldn’t capture the simulator.'
}

export async function simulatorScreenshot(device: unknown): Promise<SimulatorShot> {
  if (!isSimulatorDevice(device)) return { error: 'Unknown simulator.' }
  const file = join(tmpdir(), `agent-office-sim-${randomUUID()}.jpg`)
  try {
    await run('/usr/bin/xcrun', ['simctl', 'io', device, 'screenshot', '--type=jpeg', file], { timeout: 5000 })
    return { image: `data:image/jpeg;base64,${(await readFile(file)).toString('base64')}` }
  } catch (error) {
    return { error: whyNoShot(String((error as { stderr?: unknown }).stderr ?? error)) }
  } finally {
    void rm(file, { force: true })
  }
}
