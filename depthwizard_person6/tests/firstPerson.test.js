import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'

import { createFirstPersonControls, localMovementDirection } from '../src/firstPerson.js'

function rounded(vector) {
  return vector.toArray().map((value) => Math.round(value * 1e6) / 1e6)
}

test('W/S move along camera forward while A/D strafe without rotation', () => {
  const facingNorth = new THREE.Vector3(0, 0, -1)
  assert.deepEqual(rounded(localMovementDirection(facingNorth, new Set(['forward']))), [0, 0, -1])
  assert.deepEqual(rounded(localMovementDirection(facingNorth, new Set(['backward']))), [0, 0, 1])
  assert.deepEqual(rounded(localMovementDirection(facingNorth, new Set(['left']))), [-1, 0, 0])
  assert.deepEqual(rounded(localMovementDirection(facingNorth, new Set(['right']))), [1, 0, 0])
})

test('diagonal planar movement is normalized and follows camera yaw', () => {
  const facingEast = new THREE.Vector3(1, 0.4, 0)
  const movement = localMovementDirection(facingEast, new Set(['forward', 'right']))
  assert.ok(Math.abs(movement.length() - 1) < 1e-8)
  assert.deepEqual(rounded(movement), [0.707107, 0, 0.707107])
})

test('focused camera moves, mouse look clamps pitch, and blur stops movement', () => {
  const names = ['window', 'document', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement']
  const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name))
  const win = new EventTarget(), doc = new EventTarget(), canvas = new EventTarget()
  Object.assign(doc, {activeElement: null, pointerLockElement: null})
  Object.assign(canvas, {isConnected: true, ownerDocument: doc, setAttribute() {}, focus() {doc.activeElement = canvas}})
  const emit = (target, type, fields = {}) => {
    const event = new Event(type, {cancelable: true})
    Object.assign(event, fields); target.dispatchEvent(event)
  }
  let controls
  try {
    Object.assign(globalThis, {window: win, document: doc, HTMLInputElement: class {}, HTMLSelectElement: class {}, HTMLTextAreaElement: class {}})
    const camera = new THREE.PerspectiveCamera()
    controls = createFirstPersonControls(camera, canvas, {width: 100, depth: 100, eyeHeight: 2, moveSpeed: 10, sampleGroundHeight: () => 0})
    controls.reset(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 2, -1))
    emit(win, 'keydown', {code: 'KeyW'}); controls.update(1)
    assert.equal(camera.position.z, 0, 'unfocused viewer must ignore keys')
    canvas.focus()
    emit(win, 'keydown', {code: 'KeyA'}); controls.update(1)
    assert.equal(camera.position.x, -10)
    assert.equal(camera.rotation.y, 0, 'strafing must not rotate the camera')
    emit(win, 'blur'); controls.update(1)
    assert.equal(camera.position.x, -10)
    emit(canvas, 'mousedown', {button: 0, clientX: 0, clientY: 0})
    emit(doc, 'mousemove', {clientX: 100, clientY: 100000})
    assert.ok(camera.rotation.y < 0, 'drag look works without pointer lock')
    assert.ok(Math.abs(camera.rotation.x) < Math.PI / 2)
    assert.equal(camera.rotation.z, 0)
    emit(win, 'mouseup')
    const yaw = camera.rotation.y
    emit(doc, 'mousemove', {clientX: 200, clientY: 0})
    assert.equal(camera.rotation.y, yaw, 'released drag must stop mouse look')
    doc.pointerLockElement = canvas
    emit(doc, 'mousemove', {movementX: 20, movementY: 0})
    assert.ok(camera.rotation.y < yaw, 'locked mouse look updates yaw')
  } finally {
    controls?.destroy()
    names.forEach((name, index) => originals[index] ? Object.defineProperty(globalThis, name, originals[index]) : delete globalThis[name])
  }
})
