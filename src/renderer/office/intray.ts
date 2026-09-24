import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { overdue, type ReviewRequest } from '../../shared/workflow'
import { office } from './layout'

const shown = 6
const deskTop = 0.78

export function createIntray(scene: THREE.Scene, labels: THREE.Scene) {
  const x = (office.x0 + office.x1) / 2 + 0.85
  const z = 10.42
  const group = new THREE.Group()
  group.position.set(x, deskTop, z)
  group.rotation.y = -0.12
  scene.add(group)

  const trayM = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.45 })
  const paper = new THREE.MeshStandardMaterial({ color: 0xfbfbf9, roughness: 0.8 })
  const amber = new THREE.MeshStandardMaterial({ color: 0xffd58a, roughness: 0.8 })
  const stamp = new THREE.MeshStandardMaterial({ color: 0x1b34ff, roughness: 0.6 })
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, px: number, py: number, pz: number, parent: THREE.Object3D = group) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(px, py, pz)
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  add(new THREE.BoxGeometry(0.36, 0.012, 0.27), trayM, 0, 0.006, 0)
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.36, 0.05, 0.012), trayM, 0, 0.025, side * 0.129)
    add(new THREE.BoxGeometry(0.012, 0.05, 0.27), trayM, side * 0.174, 0.025, 0)
  }
  const envelopeGeo = new THREE.BoxGeometry(0.31, 0.007, 0.21)
  const stampGeo = new THREE.BoxGeometry(0.04, 0.002, 0.045)
  const envelopes = Array.from({ length: shown }, (_, i) => {
    const envelope = add(envelopeGeo, paper, (i % 2 ? 1 : -1) * 0.006, 0.016 + i * 0.009, 0)
    envelope.rotation.y = ((i % 3) - 1) * 0.07
    envelope.visible = false
    add(stampGeo, stamp, 0.11, 0.0045, -0.06, envelope)
    return envelope
  })

  const el = document.createElement('div')
  el.className = 'intray'
  const label = new CSS2DObject(el)
  label.center.set(0.5, 1)
  label.position.set(x, deskTop + 0.35, z)
  label.visible = false
  labels.add(label)
  let key = ''

  return {
    update(requests: readonly ReviewRequest[], now: number): boolean {
      const late = requests.map((request) => overdue(request, now)).sort((a, b) => Number(a) - Number(b))
      const next = late.join()
      if (next === key) return false
      key = next
      envelopes.forEach((envelope, i) => {
        envelope.visible = i < requests.length
        envelope.material = late[i] ? amber : paper
      })
      const n = requests.length
      const old = late.filter(Boolean).length
      el.textContent = `✉ ${n} ${n === 1 ? 'review' : 'reviews'}`
      el.classList.toggle('late', old > 0)
      el.setAttribute('aria-label', `${n} review request${n === 1 ? '' : 's'} in your in-tray${old ? `, ${old} older than 2 working days` : ''}`)
      label.visible = n > 0
      return true
    },
  }
}
