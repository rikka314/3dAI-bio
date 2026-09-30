import * as THREE from 'three';
import { OrbitControls } from './vendor/three/controls/OrbitControls.js';
import { GLTFLoader } from './vendor/three/loaders/GLTFLoader.js';
import { setStandardView } from './view-presets.js';
import { invalidateModelBuffer, loadModelBuffer, MODEL_PRIORITY } from './model-loading.js';
import { DEFAULT_DISPLAY_SCALE } from './content.js';
import { MeshoptDecoder } from './vendor/meshoptimizer/meshopt_decoder.js';
import { createHeartSection } from './heart-section.js';
import { createModelExploder } from './model-explode.js';

const AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const SHOWCASE_BASE = new URL('./', import.meta.url);

function call(callback, ...args) {
  try { callback?.(...args); } catch (error) { console.error(error); }
}

function materialsOf(object) {
  return [object.material].flat().filter(Boolean);
}

function disposeObject(root) {
  if (!root) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of materialsOf(object)) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
      for (const uniform of Object.values(material.uniforms || {})) {
        if (uniform?.value?.isTexture) textures.add(uniform.value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    texture.source?.data?.close?.();
    texture.dispose();
  }
}

export function createViewer(host, {
  onStatus,
  onReady,
  onError,
  onRotateChange,
  onReset,
  transparent = false,
  viewScale = 1,
  onModelHover,
  onModelActivate,
} = {}) {
  if (!(host instanceof Element)) throw new TypeError('createViewer requires a host Element');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: transparent, stencil: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  renderer.domElement.classList.add('viewer-canvas');
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D organ model');
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.001, 1000);
  const baseViewScale = THREE.MathUtils.clamp(Number(viewScale) || 1, 0.25, 2);
  camera.zoom = baseViewScale;
  camera.updateProjectionMatrix();
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = true;
  controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.85;

  // Fixed fill from all six directions keeps rotated and sectioned faces readable.
  // Slightly stronger front/top lights retain surface relief without a dark side.
  const lightGain = 1.5;
  scene.add(new THREE.AmbientLight(0xffffff, 1.2 * lightGain));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc6c6c6, 0.8 * lightGain));
  for (const [position, intensity] of [
    [[5, 0, 0], 1.0], [[-5, 0, 0], 0.9],
    [[0, 5, 0], 1.1], [[0, -5, 0], 0.9],
    [[0, 0, 5], 1.2], [[0, 0, -5], 1.0],
  ]) {
    const light = new THREE.DirectionalLight(0xffffff, intensity * lightGain);
    light.position.fromArray(position);
    scene.add(light);
  }

  const state = {
    root: null,
    exploder: null,
    bounds: new THREE.Box3(),
    meshes: [],
    materialState: new Map(),
    sliceOutline: null,
    heartSection: null,
    organId: null,
    slice: { enabled: false, axis: 'x', percent: 50, flip: false },
    theme: 'dark',
    generation: 0,
    request: null,
    disposed: false,
    raf: 0,
    settleFrames: 0,
    visible: !document.hidden,
    contextLost: false,
    resetTween: null,
    motionPaused: false,
    interactive: true,
    fullControls: true,
    viewScale: baseViewScale,
    entryDisplayScale: DEFAULT_DISPLAY_SCALE,
    displayOffsetY: 0,
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hitRay = new THREE.Raycaster();
  const hitPoint = new THREE.Vector2();
  const projectedCorner = new THREE.Vector3();
  let pointer = null;

  function nearModel(x, y) {
    if (!state.root || state.contextLost || state.disposed) return false;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    let left = Infinity; let right = -Infinity; let top = Infinity; let bottom = -Infinity;
    // Project eight bounds corners instead of raycasting the full mesh on every frame.
    for (let corner = 0; corner < 8; corner += 1) {
      projectedCorner.set(
        corner & 1 ? state.bounds.max.x : state.bounds.min.x,
        corner & 2 ? state.bounds.max.y : state.bounds.min.y,
        corner & 4 ? state.bounds.max.z : state.bounds.min.z,
      ).project(camera);
      const px = rect.left + (projectedCorner.x + 1) * rect.width / 2;
      const py = rect.top + (1 - projectedCorner.y) * rect.height / 2;
      left = Math.min(left, px); right = Math.max(right, px);
      top = Math.min(top, py); bottom = Math.max(bottom, py);
    }
    return x >= left - 20 && x <= right + 20 && y >= top - 20 && y <= bottom + 20;
  }

  function updateModelHover() {
    if (onModelHover) call(onModelHover, Boolean(pointer && nearModel(pointer.x, pointer.y)));
  }

  function onModelPointerMove(event) {
    pointer = event.pointerType === 'touch' ? null : { x: event.clientX, y: event.clientY };
    updateModelHover();
  }

  function onModelPointerLeave() {
    pointer = null;
    call(onModelHover, false);
  }

  function onModelClick(event) {
    if (!onModelActivate || !nearModel(event.clientX, event.clientY)) return;
    const rect = renderer.domElement.getBoundingClientRect();
    hitPoint.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    hitRay.setFromCamera(hitPoint, camera);
    if (hitRay.intersectObjects(state.meshes, false).length) call(onModelActivate);
  }

  function renderNow() {
    if (state.disposed || state.contextLost || !state.visible) return;
    renderer.render(scene, camera);
    updateModelHover();
  }

  function animationFrame(timestamp) {
    if (state.disposed || state.contextLost || !state.visible) {
      state.raf = 0;
      return;
    }
    if (!state.motionPaused && state.resetTween) {
      updateResetTween(timestamp);
    } else if (!state.motionPaused && (controls.autoRotate || state.settleFrames > 0)) {
      controls.update();
      if (!controls.autoRotate) state.settleFrames -= 1;
    }
    renderNow();
    const needsNextFrame = !state.motionPaused
      && (Boolean(state.resetTween) || controls.autoRotate || state.settleFrames > 0);
    state.raf = 0;
    if (needsNextFrame) requestRender();
  }

  function requestRender(settle = false) {
    if (state.disposed || state.contextLost) return;
    if (settle) state.settleFrames = Math.max(state.settleFrames, 18);
    if (!state.raf && state.visible) state.raf = requestAnimationFrame(animationFrame);
  }

  function setRotate(enabled) {
    cancelResetTween();
    const requested = Boolean(enabled);
    const next = requested && !reducedMotion.matches && !state.disposed;
    if (controls.autoRotate === next) {
      if (requested !== next) call(onRotateChange, next);
      return;
    }
    controls.autoRotate = next;
    call(onRotateChange, next);
    requestRender(true);
  }

  function fitDistance() {
    if (state.bounds.isEmpty()) return 3;
    const radius = Math.max(state.bounds.getSize(new THREE.Vector3()).length() / 2, 0.001);
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * Math.max(camera.aspect, 0.01));
    return radius / Math.sin(Math.min(vertical, horizontal)) * 1.12;
  }

  function applyCameraLimits(distance) {
    const radius = Math.max(state.bounds.getSize(new THREE.Vector3()).length() / 2, 0.001);
    camera.near = Math.max(distance / 1000, 0.0001);
    camera.far = Math.max(distance * 100, 100);
    controls.minDistance = radius * 0.08;
    controls.maxDistance = distance * 12;
    camera.updateProjectionMatrix();
  }

  function cancelResetTween() {
    state.resetTween = null;
  }

  function syncTweenPause() {
    const tween = state.resetTween;
    if (!tween) return;
    const paused = state.motionPaused || !state.visible;
    if (paused && tween.pausedAt === null) tween.pausedAt = performance.now();
    if (!paused && tween.pausedAt !== null) {
      tween.startTime += performance.now() - tween.pausedAt;
      tween.pausedAt = null;
    }
  }

  function setMotionPaused(paused) {
    if (state.disposed) return;
    const next = Boolean(paused);
    if (state.motionPaused === next) return;
    state.motionPaused = next;
    syncTweenPause();
    if (next && state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
    requestRender();
  }

  function setInteractive(enabled) {
    if (state.disposed) return;
    state.interactive = Boolean(enabled);
    controls.enabled = state.interactive;
    renderer.domElement.tabIndex = state.interactive ? 0 : -1;
    renderer.domElement.style.pointerEvents = state.interactive ? '' : 'none';
    if (!state.interactive) renderer.domElement.blur();
  }

  function setFullControls(enabled) {
    if (state.disposed) return;
    state.fullControls = Boolean(enabled);
    controls.enableZoom = state.fullControls;
    controls.enablePan = state.fullControls;
  }

  function applyViewScale() {
    camera.zoom = state.viewScale * state.entryDisplayScale;
    camera.updateProjectionMatrix();
    requestRender(true);
  }

  function setViewScale(scale) {
    if (state.disposed) return;
    state.viewScale = THREE.MathUtils.clamp(Number(scale) || 1, 0.25, 2);
    applyViewScale();
  }

  function flushControlMomentum() {
    const position = camera.position.clone();
    const target = controls.target.clone();
    const up = camera.up.clone();
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    camera.position.copy(position);
    controls.target.copy(target);
    camera.up.copy(up);
    controls.update();
    controls.enableDamping = damping;
  }

  function resetImmediate() {
    if (!state.root) return;
    cancelResetTween();
    setRotate(false);
    flushControlMomentum();
    const center = state.bounds.getCenter(new THREE.Vector3());
    const distance = fitDistance();
    const direction = new THREE.Vector3(0.8, 0.5, 1).normalize();
    camera.up.set(0, 1, 0);
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction, distance);
    applyCameraLimits(distance);
    controls.update();
    renderNow();
  }

  function updateResetTween(timestamp) {
    const tween = state.resetTween;
    if (!tween) return;
    const progress = THREE.MathUtils.clamp((timestamp - tween.startTime) / tween.duration, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    const target = new THREE.Vector3().lerpVectors(tween.startTarget, tween.endTarget, eased);
    const rotation = new THREE.Quaternion().slerpQuaternions(tween.identity, tween.rotation, eased);
    const direction = tween.startDirection.clone().applyQuaternion(rotation).normalize();
    const radius = THREE.MathUtils.lerp(tween.startRadius, tween.endRadius, eased);
    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(direction, radius);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    if (progress >= 1) {
      state.resetTween = null;
      controls.update();
      applyCameraLimits(tween.endRadius);
      call(tween.onComplete);
    }
  }

  function finishCameraTween() {
    const tween = state.resetTween;
    if (!tween) return;
    state.resetTween = null;
    const direction = tween.startDirection.clone().applyQuaternion(tween.rotation).normalize();
    controls.target.copy(tween.endTarget);
    camera.position.copy(tween.endTarget).addScaledVector(direction, tween.endRadius);
    camera.up.set(0, 1, 0);
    applyCameraLimits(tween.endRadius);
    controls.update();
    renderNow();
    call(tween.onComplete);
  }

  function beginCameraTween({ direction, distanceFactor = 1, target, duration = 2400 }, onComplete) {
    if (!state.root) return;
    setRotate(false);
    flushControlMomentum();
    const endTarget = target
      ? new THREE.Vector3(...target)
      : state.bounds.getCenter(new THREE.Vector3());
    const endRadius = fitDistance() * THREE.MathUtils.clamp(Number(distanceFactor) || 1, 0.78, 1.4);
    const endDirection = new THREE.Vector3(...direction).normalize();
    const offset = camera.position.clone().sub(controls.target);
    const startRadius = offset.length() || endRadius;
    const startDirection = offset.lengthSq() ? offset.normalize() : endDirection.clone();
    const requestedDuration = Number(duration);
    const tweenDuration = THREE.MathUtils.clamp(Number.isFinite(requestedDuration) ? requestedDuration : 2400, 0, 10000);
    if (reducedMotion.matches || tweenDuration === 0) {
      controls.target.copy(endTarget);
      camera.position.copy(endTarget).addScaledVector(endDirection, endRadius);
      camera.up.set(0, 1, 0);
      applyCameraLimits(endRadius);
      controls.update();
      renderNow();
      call(onComplete);
      return;
    }
    state.resetTween = {
      startTime: performance.now(),
      duration: tweenDuration,
      pausedAt: state.motionPaused || !state.visible ? performance.now() : null,
      startTarget: controls.target.clone(),
      endTarget,
      startRadius,
      endRadius,
      startDirection,
      identity: new THREE.Quaternion(),
      rotation: new THREE.Quaternion().setFromUnitVectors(startDirection, endDirection),
      onComplete,
    };
    applyCameraLimits(Math.max(startRadius, endRadius));
    requestRender();
  }

  function playShot(shot = {}, onComplete) {
    const direction = Array.isArray(shot.direction) && shot.direction.length === 3
      ? shot.direction
      : [0.8, 0.5, 1];
    beginCameraTween({ ...shot, direction }, onComplete);
  }

  function reset() {
    if (!state.root) return;
    if (getExplodeInfo().percent > 0) setExplode(0);
    call(onReset);
    setRotate(false);
    if (reducedMotion.matches) {
      resetImmediate();
      return;
    }
    flushControlMomentum();
    const endTarget = state.bounds.getCenter(new THREE.Vector3());
    const endRadius = fitDistance();
    const endDirection = new THREE.Vector3(0.8, 0.5, 1).normalize();
    const offset = camera.position.clone().sub(controls.target);
    const startRadius = offset.length() || endRadius;
    const startDirection = offset.lengthSq() ? offset.normalize() : endDirection.clone();
    state.resetTween = {
      startTime: performance.now(),
      duration: 350,
      pausedAt: state.motionPaused || !state.visible ? performance.now() : null,
      startTarget: controls.target.clone(),
      endTarget,
      startRadius,
      endRadius,
      startDirection,
      identity: new THREE.Quaternion(),
      rotation: new THREE.Quaternion().setFromUnitVectors(startDirection, endDirection),
      onComplete: null,
    };
    applyCameraLimits(Math.max(startRadius, endRadius));
    requestRender();
  }

  function resize() {
    if (state.disposed) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width <= 0 || height <= 0) return;
    const oldFit = state.root ? fitDistance() : 0;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Positive offsets move the image down without changing the mesh or orbit center.
    if (state.displayOffsetY) camera.setViewOffset(width, height, 0, -height * state.displayOffsetY, width, height);
    else camera.clearViewOffset();
    if (state.root) {
      const newFit = fitDistance();
      const offset = camera.position.clone().sub(controls.target);
      if (oldFit > 0 && Number.isFinite(oldFit) && Number.isFinite(newFit)) {
        const scale = newFit / oldFit;
        offset.multiplyScalar(scale);
        camera.position.copy(controls.target).add(offset);
        if (state.resetTween) {
          state.resetTween.startRadius *= scale;
          state.resetTween.endRadius *= scale;
        }
      }
      applyCameraLimits(Math.max(newFit, offset.length()));
    }
    requestRender();
  }

  function clearSliceOutline() {
    if (!state.sliceOutline) return;
    scene.remove(state.sliceOutline);
    state.sliceOutline.geometry.dispose();
    state.sliceOutline.material.dispose();
    state.sliceOutline = null;
  }

  function restoreMaterialState() {
    for (const [material, original] of state.materialState) {
      material.side = original.side;
      material.clippingPlanes = original.clippingPlanes;
      material.clipShadows = original.clipShadows;
      material.needsUpdate = true;
    }
    state.materialState.clear();
  }

  function outlineFor(axis, depth) {
    const size = state.bounds.getSize(new THREE.Vector3());
    const center = state.bounds.getCenter(new THREE.Vector3());
    const pad = 1.06;
    let points;
    if (axis === 'x') {
      const hy = size.y * pad / 2; const hz = size.z * pad / 2;
      points = [[depth, center.y - hy, center.z - hz], [depth, center.y + hy, center.z - hz],
        [depth, center.y + hy, center.z + hz], [depth, center.y - hy, center.z + hz]];
    } else if (axis === 'y') {
      const hx = size.x * pad / 2; const hz = size.z * pad / 2;
      points = [[center.x - hx, depth, center.z - hz], [center.x + hx, depth, center.z - hz],
        [center.x + hx, depth, center.z + hz], [center.x - hx, depth, center.z + hz]];
    } else {
      const hx = size.x * pad / 2; const hy = size.y * pad / 2;
      points = [[center.x - hx, center.y - hy, depth], [center.x + hx, center.y - hy, depth],
        [center.x + hx, center.y + hy, depth], [center.x - hx, center.y + hy, depth]];
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(...point)));
    const color = state.theme === 'light' ? 0x374151 : 0xd1d5db;
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.82, depthTest: false });
    const outline = new THREE.LineLoop(geometry, material);
    outline.renderOrder = 1000;
    return outline;
  }

  function applySlice() {
    clearSliceOutline();
    restoreMaterialState();
    if (state.heartSection) state.heartSection.object.visible = false;
    if (!state.root || !state.slice.enabled) {
      requestRender();
      return;
    }
    const { axis, percent, flip } = state.slice;
    const depth = THREE.MathUtils.lerp(state.bounds.min[axis], state.bounds.max[axis], percent / 100);
    const normal = AXES[axis].clone();
    if (flip) normal.negate();
    const plane = new THREE.Plane(normal, -normal.getComponent({ x: 0, y: 1, z: 2 }[axis]) * depth);
    for (const mesh of state.meshes) {
      for (const material of materialsOf(mesh)) {
        if (!state.materialState.has(material)) {
          state.materialState.set(material, {
            side: material.side,
            clippingPlanes: material.clippingPlanes,
            clipShadows: material.clipShadows,
          });
        }
        material.side = THREE.DoubleSide;
        material.clippingPlanes = [plane];
        material.clipShadows = true;
        material.needsUpdate = true;
      }
    }
    if (!state.heartSection) {
      state.heartSection = createHeartSection({ organId: state.organId, meshes: state.meshes });
      if (state.heartSection) scene.add(state.heartSection.object);
    }
    if (state.heartSection) {
      state.heartSection.update(plane, state.bounds);
      state.heartSection.object.visible = true;
    }
    state.sliceOutline = outlineFor(axis, depth);
    scene.add(state.sliceOutline);
    requestRender();
  }

  function setSlice({ enabled = state.slice.enabled, axis = state.slice.axis,
    percent = state.slice.percent, flip = state.slice.flip } = {}) {
    state.slice = {
      enabled: Boolean(enabled),
      axis: AXES[axis] ? axis : 'x',
      percent: THREE.MathUtils.clamp(Number(percent) || 0, 0, 100),
      flip: Boolean(flip),
    };
    applySlice();
  }

  function releaseCurrent() {
    clearSliceOutline();
    restoreMaterialState();
    if (state.heartSection) {
      scene.remove(state.heartSection.object);
      state.heartSection.dispose();
      state.heartSection = null;
    }
    if (state.root) {
      scene.remove(state.root);
      disposeObject(state.root);
    }
    state.root = null;
    state.exploder = null;
    state.organId = null;
    state.meshes = [];
    state.bounds.makeEmpty();
    requestRender();
  }

  async function load(entry) {
    if (state.contextLost) {
      const error = new Error('WebGL context was lost');
      call(onStatus, { phase: 'error', progress: null });
      call(onError, error);
      return;
    }
    const generation = ++state.generation;
    cancelResetTween();
    state.request?.abort();
    state.request = new AbortController();
    const { signal } = state.request;
    setRotate(false);
    releaseCurrent();
    call(onStatus, { phase: 'loading', progress: 0 });
    try {
      const packed = await loadModelBuffer(entry, {
        priority: MODEL_PRIORITY.foreground,
        signal,
        onProgress: (progress) => call(onStatus, { phase: 'loading', progress }),
      });
      if (signal.aborted || generation !== state.generation) return;
      call(onStatus, { phase: 'loading', progress: 94 });
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(packed, SHOWCASE_BASE.href);
      if (signal.aborted || generation !== state.generation) {
        disposeObject(gltf.scene);
        return;
      }
      const sourceBounds = new THREE.Box3().setFromObject(gltf.scene);
      if (sourceBounds.isEmpty()) throw new Error('Model contains no visible geometry');
      const size = sourceBounds.getSize(new THREE.Vector3());
      const largest = Math.max(size.x, size.y, size.z);
      if (!Number.isFinite(largest) || largest <= 0) throw new Error('Model bounds are invalid');
      const center = sourceBounds.getCenter(new THREE.Vector3());
      const normalized = new THREE.Group();
      gltf.scene.position.sub(center);
      normalized.add(gltf.scene);
      normalized.scale.setScalar(2 / largest);
      normalized.updateMatrixWorld(true);
      state.root = normalized;
      state.organId = entry.id;
      state.bounds.setFromObject(normalized);
      normalized.traverse((object) => { if (object.isMesh) state.meshes.push(object); });
      if (!state.meshes.length) throw new Error('Model contains no mesh');
      state.exploder = createModelExploder(normalized);
      scene.add(normalized);
      state.entryDisplayScale = THREE.MathUtils.clamp(Number(entry.displayScale) || DEFAULT_DISPLAY_SCALE, 0.25, 2);
      applyViewScale();
      state.displayOffsetY = THREE.MathUtils.clamp(Number(entry.displayOffsetY) || 0, -0.4, 0.4);
      applySlice();
      resize();
      resetImmediate();
      renderNow();
      call(onStatus, { phase: 'ready', progress: 100 });
      call(onReady);
    } catch (error) {
      if (generation !== state.generation || error?.name === 'AbortError') return;
      invalidateModelBuffer(entry);
      releaseCurrent();
      call(onStatus, { phase: 'error', progress: null });
      call(onError, error instanceof Error ? error : new Error(String(error)));
    }
  }

  function getExplodeInfo() {
    return state.exploder?.getInfo() || { count: 0, available: false, percent: 0 };
  }

  function setExplode(percent) {
    if (!state.exploder) return;
    cancelResetTween();
    flushControlMomentum();
    const previousFit = fitDistance();
    const offset = camera.position.clone().sub(controls.target);
    state.bounds.copy(state.exploder.setPercent(percent));
    // Keep the user's viewing direction and zoom ratio as the assembly grows.
    const nextFit = fitDistance();
    if (previousFit > 0) offset.multiplyScalar(nextFit / previousFit);
    controls.target.copy(state.bounds.getCenter(new THREE.Vector3()));
    camera.position.copy(controls.target).add(offset);
    applyCameraLimits(Math.max(nextFit, offset.length()));
    controls.update();
    applySlice();
    requestRender();
  }

  function setTheme(theme) {
    state.theme = theme === 'light' ? 'light' : 'dark';
    renderer.setClearColor(state.theme === 'light' ? 0xffffff : 0x202020, transparent ? 0 : 1);
    if (state.slice.enabled) applySlice();
    requestRender();
  }

  function setView(name) {
    if (!state.root) return;
    cancelResetTween();
    setRotate(false);
    setStandardView(camera, controls, state.bounds, name);
    requestRender(true);
  }

  function zoom(factor) {
    if (!state.root || !Number.isFinite(Number(factor)) || Number(factor) <= 0) return;
    cancelResetTween();
    const offset = camera.position.clone().sub(controls.target);
    const distance = THREE.MathUtils.clamp(offset.length() / Number(factor), controls.minDistance, controls.maxDistance);
    if (!offset.lengthSq()) offset.set(0, 0, 1);
    camera.position.copy(controls.target).addScaledVector(offset.normalize(), distance);
    controls.update();
    requestRender(true);
  }

  function orbit(deltaAzimuth, deltaPolar) {
    if (!state.root) return;
    cancelResetTween();
    setRotate(false);
    const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    spherical.theta += deltaAzimuth;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + deltaPolar, 0.05, Math.PI - 0.05);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    camera.lookAt(controls.target);
    controls.update();
    requestRender(true);
  }

  function onKeyDown(event) {
    if (!state.interactive) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    const rotationKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    const fullControlKeys = ['+', '=', '-', '_', '0'];
    if (!rotationKeys.includes(key) && !(state.fullControls && fullControlKeys.includes(key))) return;
    event.preventDefault();
    if (key === 'ArrowLeft') orbit(-0.12, 0);
    else if (key === 'ArrowRight') orbit(0.12, 0);
    else if (key === 'ArrowUp') orbit(0, -0.1);
    else if (key === 'ArrowDown') orbit(0, 0.1);
    else if (key === '+' || key === '=') zoom(1.15);
    else if (key === '-' || key === '_') zoom(1 / 1.15);
    else reset();
  }

  function capturePreview() {
    if (!state.root) return null;
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/webp', 0.8);
  }

  function onVisibilityChange() {
    state.visible = !document.hidden;
    syncTweenPause();
    if (!state.visible && state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    } else if (state.visible) requestRender(true);
  }

  function onReducedMotionChange() {
    if (!reducedMotion.matches) return;
    finishCameraTween();
    setRotate(false);
  }

  function dispose() {
    if (state.disposed) return;
    cancelResetTween();
    state.disposed = true;
    state.generation += 1;
    state.request?.abort();
    if (state.raf) cancelAnimationFrame(state.raf);
    resizeObserver.disconnect();
    controls.removeEventListener('change', onControlsChange);
    controls.removeEventListener('start', onControlsStart);
    controls.dispose();
    renderer.domElement.removeEventListener('keydown', onKeyDown);
    renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
    host.removeEventListener('pointermove', onModelPointerMove);
    host.removeEventListener('pointerleave', onModelPointerLeave);
    host.removeEventListener('click', onModelClick);
    onModelPointerLeave();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    reducedMotion.removeEventListener?.('change', onReducedMotionChange);
    releaseCurrent();
    renderer.dispose();
    renderer.domElement.remove();
  }

  function onControlsChange() { requestRender(true); }
  function onControlsStart() { cancelResetTween(); }
  function onContextLost(event) {
    event.preventDefault();
    cancelResetTween();
    state.contextLost = true;
    state.generation += 1;
    state.request?.abort();
    state.settleFrames = 0;
    setRotate(false);
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
    const error = new Error('WebGL context was lost');
    call(onStatus, { phase: 'error', progress: null });
    call(onError, error);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  controls.addEventListener('change', onControlsChange);
  controls.addEventListener('start', onControlsStart);
  renderer.domElement.addEventListener('keydown', onKeyDown);
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  if (onModelHover || onModelActivate) {
    host.addEventListener('pointermove', onModelPointerMove);
    host.addEventListener('pointerleave', onModelPointerLeave);
    host.addEventListener('click', onModelClick);
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  reducedMotion.addEventListener?.('change', onReducedMotionChange);
  setTheme('dark');
  resize();

  return {
    load, setTheme, setView, zoom, reset, setRotate, setSlice, capturePreview,
    getExplodeInfo, setExplode,
    playShot, setMotionPaused, setInteractive, setFullControls, setViewScale, dispose,
  };
}
