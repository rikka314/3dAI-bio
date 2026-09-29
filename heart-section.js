import * as THREE from './vendor/three/three.module.min.js';

const SECTION_NORMAL = new THREE.Vector3(0, 0, 1);
const MASK_ORDER = 10;

function isHeartTissue(mesh) {
  if (!mesh.isMesh || mesh.isSkinnedMesh) return false;
  for (let object = mesh; object; object = object.parent) {
    if (object.name === 'Heart_with_four_chambers') return true;
  }
  return false;
}

function stencilMaterial(side, operation, plane) {
  return new THREE.MeshBasicMaterial({
    side, clippingPlanes: [plane],
    colorWrite: false, depthWrite: false, depthTest: false,
    stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc,
    stencilFail: operation, stencilZFail: operation, stencilZPass: operation,
  });
}

// Illustrative myocardium grain only: no patient-specific fiber direction,
// transmural layers, histological striation, or material measurement is implied.
function myocardiumMaterial() {
  const material = new THREE.MeshStandardMaterial({
    color: 0x873f43, roughness: 0.86, metalness: 0, side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  material.name = 'Illustrative myocardial cut surface';
  material.customProgramCacheKey = () => 'myocardium-section-grain-v1';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTissuePosition;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTissuePosition = (modelMatrix * vec4(position, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTissuePosition;
        float tissueHash(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }
        float tissueNoise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(tissueHash(i), tissueHash(i + vec3(1,0,0)), f.x),
                         mix(tissueHash(i + vec3(0,1,0)), tissueHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(tissueHash(i + vec3(0,0,1)), tissueHash(i + vec3(1,0,1)), f.x),
                         mix(tissueHash(i + vec3(0,1,1)), tissueHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float grain = 0.55 * tissueNoise(vTissuePosition * 38.0)
                    + 0.30 * tissueNoise(vTissuePosition * 105.0)
                    + 0.15 * tissueNoise(vTissuePosition * 240.0);
        diffuseColor.rgb *= 0.78 + 0.40 * grain;`);
  };
  return material;
}

/**
 * Visual cap for a closed, consistently oriented myocardial solid. Opposite
 * cavity winding cancels to zero, leaving the cavity holes unpainted. This is
 * a render-time mask; it never changes or closes the model's actual topology.
 */
export function createHeartSection({ organId, meshes }) {
  if (organId !== 'heart') return null;
  const tissue = meshes.filter(isHeartTissue);
  if (!tissue.length) return null;
  const object = new THREE.Group();
  object.name = 'Heart section visualization';
  const plane = new THREE.Plane();
  const back = stencilMaterial(THREE.BackSide, THREE.IncrementWrapStencilOp, plane);
  const front = stencilMaterial(THREE.FrontSide, THREE.DecrementWrapStencilOp, plane);
  const masks = [];
  for (const source of tissue) {
    for (const [side, material] of [['back', back], ['front', front]]) {
      const mask = new THREE.Mesh(source.geometry, material);
      mask.name = `${source.name}:section-${side}`;
      mask.matrixAutoUpdate = false;
      mask.renderOrder = MASK_ORDER;
      mask.frustumCulled = false;
      object.add(mask);
      masks.push({ source, mask });
    }
  }
  const cap = new THREE.Mesh(new THREE.PlaneGeometry(), myocardiumMaterial());
  cap.name = 'Myocardial cut surface';
  cap.renderOrder = MASK_ORDER + 1;
  cap.frustumCulled = false;
  cap.onAfterRender = (renderer) => renderer.clearStencil();
  object.add(cap);
  const size = new THREE.Vector3();
  return {
    object,
    update(clippingPlane, bounds) {
      plane.copy(clippingPlane);
      for (const { source, mask } of masks) mask.matrix.copy(source.matrixWorld);
      bounds.getCenter(cap.position);
      plane.projectPoint(cap.position, cap.position);
      cap.quaternion.setFromUnitVectors(SECTION_NORMAL, plane.normal);
      cap.scale.setScalar(bounds.getSize(size).length() * 1.02);
      object.updateMatrixWorld(true);
    },
    dispose() {
      back.dispose();
      front.dispose();
      cap.geometry.dispose();
      cap.material.dispose();
      object.clear();
    },
  };
}
