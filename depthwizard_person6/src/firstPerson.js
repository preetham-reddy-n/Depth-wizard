import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/** Return frame-independent movement in the camera's horizontal local axes. */
export function localMovementDirection(cameraForward, pressed, target = new THREE.Vector3()) {
  const forward = new THREE.Vector3().copy(cameraForward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
  target.set(0, 0, 0);
  if (pressed.has('forward')) target.add(forward);
  if (pressed.has('backward')) target.sub(forward);
  if (pressed.has('right')) target.add(right);
  if (pressed.has('left')) target.sub(right);
  if (target.lengthSq()) target.normalize();
  return target;
}

/** Keyboard + pointer-lock controls for an embedded first-person terrain view. */
export function createFirstPersonControls(camera, canvas, {
  width,
  depth,
  sampleGroundHeight,
  eyeHeight,
  moveSpeed,
  mouseSensitivity = 1,
  onActivity = () => {},
} = {}) {
  const keys = new Set();
  const forward = new THREE.Vector3();
  const movement = new THREE.Vector3();
  let currentMoveSpeed = Math.max(Number(moveSpeed) || 1, 0.01);
  let currentMouseSensitivity = THREE.MathUtils.clamp(Number(mouseSensitivity) || 1, 0.1, 4);
  let altitudeOffset = 0;
  let enabled = true;
  let yaw = camera.rotation.y;
  let pitch = camera.rotation.x;
  let dragging = false;
  let lastPointerX = 0, lastPointerY = 0;

  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Interactive first-person terrain. Click to look. W S move, A D strafe, Q or Space rises, E or Shift descends, and Escape releases the mouse.');

  function actionForKey(event) {
    return {
      KeyW: 'forward', KeyS: 'backward', KeyA: 'left', KeyD: 'right',
      KeyQ: 'up', Space: 'up', KeyE: 'down', ShiftLeft: 'down', ShiftRight: 'down',
    }[event.code];
  }

  function isTypingTarget(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  }

  function keyDown(event) {
    if (!enabled || isTypingTarget(event.target)) return;
    if (document.activeElement !== canvas && document.pointerLockElement !== canvas) return;
    const action = actionForKey(event);
    if (!action) return;
    keys.add(action);
    event.preventDefault();
  }

  function keyUp(event) {
    const action = actionForKey(event);
    if (action) keys.delete(action);
  }

  function pointerMove(event) {
    const locked = document.pointerLockElement === canvas;
    if (!enabled || (!locked && !dragging)) return;
    const dx = locked ? event.movementX : event.clientX - lastPointerX;
    const dy = locked ? event.movementY : event.clientY - lastPointerY;
    lastPointerX = event.clientX; lastPointerY = event.clientY;
    yaw -= dx * 0.002 * currentMouseSensitivity;
    pitch -= dy * 0.002 * currentMouseSensitivity;
    pitch = THREE.MathUtils.clamp(pitch, -Math.PI * 0.47, Math.PI * 0.47);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    onActivity();
  }

  function activate() {
    if (!enabled || !canvas.isConnected || canvas.ownerDocument !== document) return;
    canvas.focus({ preventScroll: true });
    try {
      const request = canvas.requestPointerLock?.();
      request?.catch?.(() => {
        // Some embedded browsers disallow pointer lock. Keyboard navigation
        // still works, and an ordinary desktop browser can use mouse look.
      });
    } catch {
      // Some embedded browsers disallow pointer lock. Keyboard navigation still
      // works, and an ordinary desktop browser can use mouse look normally.
    }
    onActivity();
  }

  function startDrag(event) {
    if (!enabled || event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    dragging = true;
    lastPointerX = event.clientX; lastPointerY = event.clientY;
  }
  function endDrag() { dragging = false; }
  function clearKeys() { keys.clear(); endDrag(); }
  function lockChanged() { if (document.pointerLockElement !== canvas) clearKeys(); }

  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', clearKeys);
  canvas.addEventListener('blur', clearKeys);
  document.addEventListener('pointerlockchange', lockChanged);
  document.addEventListener('mousemove', pointerMove);
  canvas.addEventListener('click', activate);
  canvas.addEventListener('mousedown', startDrag);
  window.addEventListener('mouseup', endDrag);

  function syncRotation() {
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    pitch = euler.x;
    yaw = euler.y;
    camera.rotation.order = 'YXZ';
  }

  return {
    get enabled() { return enabled; },
    set enabled(value) {
      enabled = Boolean(value);
      if (!enabled) {
        clearKeys();
        if (document.pointerLockElement === canvas) {
          try { document.exitPointerLock?.(); } catch { /* The document may be detaching. */ }
        }
      } else syncRotation();
    },
    update(dt) {
      if (!enabled) return;
      camera.getWorldDirection(forward);
      localMovementDirection(forward, keys, movement);
      if (movement.lengthSq()) {
        movement.multiplyScalar(currentMoveSpeed * dt);
        camera.position.add(movement);
        camera.position.x = THREE.MathUtils.clamp(camera.position.x, -width * 0.495, width * 0.495);
        camera.position.z = THREE.MathUtils.clamp(camera.position.z, -depth * 0.495, depth * 0.495);
        onActivity();
      }
      const clearance = typeof eyeHeight === 'function' ? eyeHeight() : eyeHeight;
      const vertical = Number(keys.has('up')) - Number(keys.has('down'));
      if (vertical) {
        altitudeOffset += vertical * currentMoveSpeed * dt;
        altitudeOffset = THREE.MathUtils.clamp(altitudeOffset, 0, Math.max(width, depth) * 1.5);
        onActivity();
      }
      const groundClearance = sampleGroundHeight(camera.position.x, camera.position.z) + clearance;
      const desiredHeight = groundClearance + altitudeOffset;
      // Damp downward/flight-altitude transitions while never allowing terrain
      // following to lag below the safe eye clearance on an uphill step.
      camera.position.y = Math.max(
        groundClearance,
        THREE.MathUtils.damp(camera.position.y, desiredHeight, vertical ? 12 : 7, dt),
      );
    },
    reset(position, target) {
      keys.clear();
      camera.position.copy(position);
      const clearance = typeof eyeHeight === 'function' ? eyeHeight() : eyeHeight;
      altitudeOffset = Math.max(0, camera.position.y - sampleGroundHeight(position.x, position.z) - clearance);
      camera.lookAt(target);
      syncRotation();
    },
    setMoveSpeed(value) { currentMoveSpeed = Math.max(Number(value) || 1, 0.01); },
    setMouseSensitivity(value) { currentMouseSensitivity = THREE.MathUtils.clamp(Number(value) || 1, 0.1, 4); },
    get moveSpeed() { return currentMoveSpeed; },
    get mouseSensitivity() { return currentMouseSensitivity; },
    destroy() {
      keys.clear();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', clearKeys);
      canvas.removeEventListener('blur', clearKeys);
      document.removeEventListener('pointerlockchange', lockChanged);
      document.removeEventListener('mousemove', pointerMove);
      canvas.removeEventListener('click', activate);
      canvas.removeEventListener('mousedown', startDrag);
      window.removeEventListener('mouseup', endDrag);
      if (document.pointerLockElement === canvas) {
        try { document.exitPointerLock?.(); } catch { /* The document may be detaching. */ }
      }
    },
  };
}
