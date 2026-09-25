import { describe, expect, it } from 'vitest'
import { isBooted, simulatorScreenshot, whyNoShot } from '../../src/main/simulator'

describe('simulator screenshots', () => {
  it('explains why there is no picture', () => {
    expect(whyNoShot('xcrun: error: unable to find utility "simctl", not a developer tool or in PATH')).toMatch(/Xcode isn’t installed/)
    expect(whyNoShot('No devices are booted.')).toBe('The simulator isn’t running.')
    expect(whyNoShot('Unable to take screenshot: device in current state: Shutdown')).toBe('The simulator isn’t running.')
    expect(whyNoShot('Note: No display specified. Defaulting to display: 49F3D56B (screenID: 1, name: LCD)\n')).toBe('Couldn’t capture the simulator.')
  })

  it('only shoots a simulator that has finished booting', () => {
    const list = JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [{ udid: 'C4E6C1AB-97B3-410B-98C9-2F544E48EE48' }] } })
    expect(isBooted(list, 'booted')).toBe(true)
    expect(isBooted(list, 'c4e6c1ab-97b3-410b-98c9-2f544e48ee48')).toBe(true)
    expect(isBooted(list, '71BBD584-4E07-488B-87EF-557825572C74')).toBe(false)
    expect(isBooted(JSON.stringify({ devices: {} }), 'booted')).toBe(false)
  })

  it('refuses anything that is not a device id', async () => {
    expect(await simulatorScreenshot('booted; rm -rf ~')).toEqual({ error: 'Unknown simulator.' })
  })
})
