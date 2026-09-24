import { PerspectiveCamera, Vector3 } from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { describe, expect, it } from 'vitest'
import { createRig } from '../../src/renderer/office/camera'

function rigAt(target: Vector3) {
  const camera = new PerspectiveCamera(24, 1.6, 0.5, 220)
  const controls = { target: target.clone(), maxDistance: 0, update: () => false, addEventListener: () => {} }
  const rig = createRig(camera, controls as unknown as OrbitControls, false)
  camera.position.set(target.x, target.y + 8, target.z + 8)
  rig.atOverview = false
  return { camera, controls, rig }
}

const settle = (rig: ReturnType<typeof createRig>) => {
  for (let frame = 0; frame < 120; frame++) rig.step(1 / 60)
}

describe('camera', () => {
  it('starting a chat does not change the camera target', () => {
    const { camera, controls, rig } = rigAt(new Vector3(2, 0.3, -4))
    const [target, position] = [controls.target.clone(), camera.position.clone()]
    rig.show('keep', () => new Vector3(-12, 0.7, 12))
    settle(rig)
    expect(controls.target).toEqual(target)
    expect(camera.position).toEqual(position)
    expect(rig.follow).toBeUndefined()
  })

  it('still glides to an agent Aaron clicks', () => {
    const { controls, rig } = rigAt(new Vector3(2, 0.3, -4))
    rig.show('fly', () => new Vector3(-12, 0.7, 12), 7)
    settle(rig)
    expect(controls.target.distanceTo(new Vector3(-12, 0.7, 12))).toBeLessThan(0.01)
  })
})
