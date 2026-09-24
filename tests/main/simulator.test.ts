import { describe, expect, it } from 'vitest'
import { simulatorScreenshot, whyNoShot } from '../../src/main/simulator'

describe('simulator screenshots', () => {
  it('explains why there is no picture', () => {
    expect(whyNoShot('xcrun: error: unable to find utility "simctl", not a developer tool or in PATH')).toMatch(/Xcode isn’t installed/)
    expect(whyNoShot('No devices are booted.')).toBe('The simulator isn’t running.')
    expect(whyNoShot('Unable to take screenshot: device in current state: Shutdown')).toBe('The simulator isn’t running.')
  })

  it('refuses anything that is not a device id', async () => {
    expect(await simulatorScreenshot('booted; rm -rf ~')).toEqual({ error: 'Unknown simulator.' })
  })
})
