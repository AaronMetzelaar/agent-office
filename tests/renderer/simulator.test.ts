import { describe, expect, it } from 'vitest'
import { isSimulatorDevice, simulatorOf, simulatorTool, usingSimulator, type ChatRow } from '../../src/shared/chat'

const udid = 'C4E6C1AB-97B3-410B-98C9-2F544E48EE48'
const user = (id: string): ChatRow => ({ kind: 'user', id, text: 'hi' })
const tool = (id: string, name: string, input: unknown): ChatRow => ({ kind: 'tool', id, name, input })

describe('simulator detection', () => {
  it('reads the device from the simulator tool and from simctl commands', () => {
    expect(simulatorOf([tool('a', simulatorTool, { action: 'tap', device: udid })])).toBe(udid)
    expect(simulatorOf([tool('a', simulatorTool, { action: 'screenshot' })])).toBe('booted')
    expect(simulatorOf([tool('a', 'Bash', { command: `xcrun simctl openurl ${udid} app://x` })])).toBe(udid)
    expect(simulatorOf([tool('a', 'Bash', { command: 'xcrun simctl launch booted com.app' })])).toBe('booted')
    expect(simulatorOf([tool('a', 'Bash', { command: 'pnpm test' })])).toBeUndefined()
    expect(simulatorOf([tool('a', 'Bash', { command: 'xcrun simctl list devices booted' })])).toBeUndefined()
    expect(simulatorOf([tool('a', 'Bash', { command: "grep -rhoE 'xcrun simctl [a-z]+' ." })])).toBeUndefined()
    expect(simulatorOf([tool('a', 'Bash', { command: 'pnpm detox test -c ios.sim.debug' })])).toBe('booted')
  })

  it('counts as in use only while busy in the current turn', () => {
    const rows = [tool('a', simulatorTool, { device: udid }), user('u'), tool('b', 'Read', {})]
    expect(simulatorOf(rows)).toBe(udid)
    expect(usingSimulator({ state: 'working', rows })).toBe(false)
    expect(usingSimulator({ state: 'working', rows: rows.slice(0, 1) })).toBe(true)
    expect(usingSimulator({ state: 'done', rows: rows.slice(0, 1) })).toBe(false)
  })

  it('only accepts UDIDs or booted as a device', () => {
    expect(isSimulatorDevice(udid)).toBe(true)
    expect(isSimulatorDevice('booted')).toBe(true)
    expect(isSimulatorDevice('booted; rm -rf ~')).toBe(false)
    expect(isSimulatorDevice(undefined)).toBe(false)
  })
})
