import * as THREE from 'three';

// Directions follow model coordinates, not an anatomical calibration.
export function setStandardView(camera, controls, bounds, name, zUp = false) {
  if (bounds.isEmpty()) return;
  const directions = {
    front: [0, 0, 1], back: [0, 0, -1],
    left: [-1, 0, 0], right: [1, 0, 0],
    top: [0, 1, 0], bottom: [0, -1, 0],
  };
  if (!directions[name]) return;
  const direction = new THREE.Vector3(...directions[name]);
  if (zUp) direction.applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  controls.autoRotate = false;
  // Flush remaining drag momentum before placing the camera.
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  camera.up.set(0, zUp ? 0 : 1, zUp ? 1 : 0);
  const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.001);
  const halfFov = Math.min(THREE.MathUtils.degToRad(camera.fov / 2),
    Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
  const distance = radius / Math.sin(halfFov) * 1.1;
  const center = bounds.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = distance / 1000;
  camera.far = distance * 100;
  controls.minDistance = radius * 0.08;
  controls.maxDistance = distance * 12;
  camera.updateProjectionMatrix();
  controls.update();
  controls.enableDamping = damping;
}
