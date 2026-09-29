import * as THREE from './vendor/three/three.module.min.js';

// Move existing mesh objects only: geometry, materials and source files stay intact.
export function createModelExploder(root) {
  root.updateMatrixWorld(true);
  const assembledBounds = new THREE.Box3().setFromObject(root);
  const center = assembledBounds.getCenter(new THREE.Vector3());
  const size = assembledBounds.getSize(new THREE.Vector3());
  const distance = Math.max(size.x, size.y, size.z) * 0.65;
  const parts = [];
  let unsupported = false;
  root.traverse((object) => {
    if (!object.isMesh) return;
    if (object.isSkinnedMesh || object.isInstancedMesh) unsupported = true;
    // A parent mesh carries its descendants, so never displace a child twice.
    for (let parent = object.parent; parent && parent !== root; parent = parent.parent) {
      if (parent.isMesh) return;
    }
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return;
    parts.push({ object, bounds, position: object.position.clone(), matrix: object.matrix.clone() });
  });
  const available = !unsupported && parts.length > 1 && Number.isFinite(distance) && distance > 0;
  parts.forEach((part, index) => {
    const direction = part.bounds.getCenter(new THREE.Vector3()).sub(center);
    // Concentric shells still need distinct, deterministic separation directions.
    if (direction.length() < distance * 0.03) {
      const y = 1 - 2 * (index + 0.5) / parts.length;
      const radius = Math.sqrt(1 - y * y);
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      direction.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    }
    part.offset = direction.normalize().multiplyScalar(distance);
    const inverse = part.object.parent.matrixWorld.clone().invert();
    part.localOffset = part.offset.clone().applyMatrix4(inverse)
      .sub(new THREE.Vector3().applyMatrix4(inverse));
  });
  let percent = 0;
  return {
    getInfo() { return { count: parts.length, available, percent }; },
    setPercent(value) {
      const requested = Number(value);
      percent = available && Number.isFinite(requested) ? THREE.MathUtils.clamp(requested, 0, 100) : 0;
      const amount = percent / 100;
      const bounds = new THREE.Box3();
      for (const part of parts) {
        part.object.position.copy(part.position).addScaledVector(part.localOffset, amount);
        if (!part.object.matrixAutoUpdate) {
          part.object.matrix.copy(part.matrix);
          part.object.matrix.setPosition(new THREE.Vector3().setFromMatrixPosition(part.matrix)
            .addScaledVector(part.localOffset, amount));
          part.object.matrixWorldNeedsUpdate = true;
        }
        bounds.union(part.bounds.clone().translate(part.offset.clone().multiplyScalar(amount)));
      }
      root.updateMatrixWorld(true);
      return percent === 0 || bounds.isEmpty() ? assembledBounds.clone() : bounds;
    },
  };
}
