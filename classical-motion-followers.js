const MODE_REGIONS = new Map([
  ['gait-cycle', new Set(['arm', 'leg', 'hand', 'foot'])],
  ['shoulder-flexion', new Set(['arm', 'hand'])],
  ['shoulder-abduction', new Set(['arm', 'hand'])],
  ['shoulder-circle', new Set(['arm', 'hand'])],
  ['elbow-flexion', new Set(['arm', 'hand'])],
  ['forearm-rotation', new Set(['arm', 'hand'])],
  ['wrist-flexion', new Set(['hand'])],
  ['wrist-deviation', new Set(['hand'])],
  ['hip-flexion', new Set(['leg', 'foot'])],
  ['hip-abduction', new Set(['leg', 'foot'])],
  ['hip-circle', new Set(['leg', 'foot'])],
  ['knee-flexion', new Set(['leg', 'foot'])],
  ['ankle-dorsiflexion', new Set(['foot'])],
  ['ankle-plantarflexion', new Set(['foot'])],
]);

const FIXED_CONNECTION = /acetabular labrum|glenoid labrum|triradiate cartilage|transverse acetabular ligament|sacro[ -]?iliac|acromioclavicular|sternoclavicular|coracoclavicular|costoclavicular|interclavicular|transverse scapular|coraco acromial|\bconoid ligament|\btrapezoid ligament/;
const AXIAL_EXCLUSION = /\bcostal\b|\bintercostal\b|nasal septal|septal cartilage/;
const FOLLOWER_CATEGORY = /韧带|纤维|关节囊|软骨|脂肪垫/;
const HAND_BONE = /finger of hand|metacarpal|scaphoid|lunate|triquetr|pisiform|trapezium|trapezoid bone|capitate|hamate/;
const FOOT_BONE = /toe|finger of foot|metatarsal|talus|calcaneus|navicular bone|cuneiform|cuboid|sesamoid.*foot/;
const ARM_NAME = /\b(?:humerus|humeral|radius|radial|radiocarpal|radioulnar|ulna|ulnar|elbow|forearm|wrist|carpal|metacarpal|glenohumeral)\b|finger of hand/;
const LEG_NAME = /\b(?:femur|femoral|tibia|tibial|fibula|fibular|patella|patellar|knee|hip|ankle|talus|talar|calcaneus|calcaneal|metatarsal|toe|meniscus|meniscal|iliofemoral|ischiofemoral|pubofemoral)\b|finger of foot/;
const HAND_STEM = /scaphotrapeziotrapezoidal|trapeziotrapezoidal|palmar interphalangeal|articular capsules of (?:distal|proximal) interphalangeal joints(?! of foot)/;
const FOOT_STEM = /talocalcaneal|talonavicular|calcaneonavicular|cuneonavicular|tibiocalcaneal|tibionavicular|\bplantar\b|intersesamoid/;

const cleanName = entry => String(entry?.motionName || entry?.part?.original_english || entry?.part?.english || entry?.part?.name || '').toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
const entryId = entry => entry?.part?.id || entry?.part?.name || cleanName(entry);
const sideOf = name => /\bleft\b/.test(name) ? 'left' : /\bright\b/.test(name) ? 'right' : null;
const regionOf = name => FOOT_BONE.test(name) || FOOT_STEM.test(name) || /foot|tars|metatars|toe/.test(name) ? 'foot' : HAND_BONE.test(name) || HAND_STEM.test(name) || /hand|carpal|metacarp|finger/.test(name) ? 'hand' : ARM_NAME.test(name) || /coracohumeral|oblique cord|quadrate ligament/.test(name) ? 'arm' : LEG_NAME.test(name) || /popliteal|frenula capsulae/.test(name) ? 'leg' : null;
const isBone = entry => entry?.motionCategory === '骨' || entry?.part?.color_category === '骨';
const isFollower = entry => FOLLOWER_CATEGORY.test(entry?.motionCategory || entry?.part?.color_category || '') || /sesamoid.*foot/.test(cleanName(entry));

function samplePoints(THREE, entry, inverseBasis) {
  const points = [];
  for (const mesh of entry.meshes || []) {
    const position = mesh.geometry?.attributes?.position;
    if (!position) continue;
    const stride = Math.max(1, Math.ceil(position.count / 48));
    for (let i = 0; i < position.count; i += stride) {
      const point = new THREE.Vector3().fromBufferAttribute(position, i);
      if (inverseBasis) point.applyMatrix4(inverseBasis);
      points.push(point);
    }
  }
  if (!points.length && entry.motionCenter) points.push(entry.motionCenter.clone());
  return points;
}

function surfaceDistance(a, b) {
  if (!a.length || !b.length) return Infinity;
  let best = Infinity;
  for (const p of a) for (const q of b) best = Math.min(best, p.distanceToSquared(q));
  return best;
}

function matrixMoved(matrix) {
  if (!matrix?.elements) return false;
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return matrix.elements.some((value, index) => Math.abs(value - identity[index]) > 1e-9);
}

function sameMatrix(a, b) {
  return a.elements.every((value, index) => Math.abs(value - b.elements[index]) <= 1e-9);
}

export function createSkeletalFollowers({ THREE, entries = [], basis = null } = {}) {
  if (!THREE?.Matrix4 || !THREE?.Vector3) throw new TypeError('THREE is required');
  const inverseBasis = basis?.clone?.().invert?.() || null;
  const bones = entries.filter(isBone);
  if (!bones.length) return { extendTargets: mode => mode?.targets || [], apply: () => 0, reset() {}, dispose() {}, getBindings: () => [], getUnbound: () => [] };
  const followerEntries = entries.filter(isFollower);
  const anchorBones = bones.filter(entry => !followerEntries.includes(entry));
  const names = new Map(entries.map(entry => [entry, cleanName(entry)]));
  const samples = new Map([...new Set([...bones, ...followerEntries])].map(entry => [entry, samplePoints(THREE, entry, inverseBasis)]));
  const byName = regex => anchorBones.filter(entry => regex.test(names.get(entry)));
  const withSide = (candidates, side) => side ? candidates.filter(entry => sideOf(names.get(entry)) === side) : [];
  const nearest = (follower, candidates, count = 1) => candidates.filter(candidate => candidate !== follower)
    .sort((a, b) => surfaceDistance(samples.get(follower), samples.get(a)) - surfaceDistance(samples.get(follower), samples.get(b)))
    .slice(0, count);
  const bone = (regex, side) => withSide(byName(regex), side);
  const handBones = side => withSide(anchorBones.filter(entry => HAND_BONE.test(names.get(entry))), side);
  const footBones = side => withSide(anchorBones.filter(entry => FOOT_BONE.test(names.get(entry))), side);

  function resolve(follower) {
    const name = names.get(follower), region = regionOf(name);
    let side = sideOf(name), inferredSide = false, sideInference = null;
    if (!side && name === 'ulnopisiform ligament') {
      const choices = ['left', 'right'].map(candidateSide => {
        const candidates = [...bone(/^ulna /, candidateSide), ...bone(/^pisiform /, candidateSide)];
        return { side: candidateSide, distance: Math.sqrt(Math.min(...candidates.map(anchor => surfaceDistance(samples.get(follower), samples.get(anchor))))) };
      }).sort((a, b) => a.distance - b.distance);
      if (Number.isFinite(choices[0].distance) && choices[0].distance < choices[1].distance * .85) {
        side = choices[0].side; inferredSide = true;
        sideInference = { method: 'static-surface-distance', selected: side, thresholdRatio: .85, ratio: choices[0].distance / choices[1].distance, distances: Object.fromEntries(choices.map(choice => [choice.side, choice.distance])) };
      }
    }
    if (!side) return { follower, unbound: true, reason: 'unsided-ambiguous' };
    if (AXIAL_EXCLUSION.test(name)) return { follower, unbound: true, reason: 'axial-excluded' };
    if (FIXED_CONNECTION.test(name)) return { follower, unbound: true, reason: 'fixed-proximal-connection' };
    let anchors = [], rule = '', strategy = 'rigid';

    if (/interosseous membrane of leg/.test(name)) {
      anchors = [nearest(follower, bone(/^tibia /, side))[0], nearest(follower, bone(/^fibula /, side))[0]].filter(Boolean);
      rule = 'leg-interosseous:tibia+fibula'; strategy = 'blend';
    } else if (/interosseous membrane of forearm/.test(name)) {
      anchors = [nearest(follower, bone(/^radius /, side))[0], nearest(follower, bone(/^ulna /, side))[0]].filter(Boolean);
      rule = 'forearm-interosseous:radius+ulna'; strategy = 'blend';
    } else if (/articular capsule of hip|iliofemoral|ischiofemoral|pubofemoral|ligament of head of femur|zona orbicularis/.test(name)) {
      anchors = [nearest(follower, bone(/^hip bone /, side))[0], nearest(follower, bone(/^femur /, side))[0]].filter(Boolean);
      rule = 'hip-joint:hip-bone+femur'; strategy = 'blend';
    } else if (/frenula capsulae/.test(name)) {
      anchors = [nearest(follower, bone(/^hip bone /, side))[0], nearest(follower, bone(/^femur /, side))[0]].filter(Boolean);
      rule = 'hip-frenula:hip-bone+femur'; strategy = 'blend';
    } else if (/knee|menisc|patell|cruciate|tibial collateral|fibular collateral|popliteofibular/.test(name)) {
      const distal = /patell/.test(name) ? bone(/^patella /, side) : bone(/^tibia /, side);
      anchors = [nearest(follower, bone(/^femur /, side))[0], nearest(follower, distal)[0]].filter(Boolean);
      rule = /patell/.test(name) ? 'knee:femur+patella' : 'knee:femur+tibia'; strategy = 'blend';
    } else if (/popliteal/.test(name)) {
      anchors = [nearest(follower, bone(/^femur /, side))[0], nearest(follower, bone(/^tibia /, side))[0]].filter(Boolean);
      rule = 'knee-popliteal:femur+tibia'; strategy = 'blend';
    } else if (/tibiofibular|fibular head/.test(name)) {
      anchors = [nearest(follower, bone(/^tibia /, side))[0], nearest(follower, bone(/^fibula /, side))[0]].filter(Boolean);
      rule = 'tibiofibular:tibia+fibula'; strategy = 'blend';
    } else if (/talofibular/.test(name)) {
      anchors = [nearest(follower, bone(/^fibula /, side))[0], nearest(follower, bone(/^talus /, side))[0]].filter(Boolean);
      rule = 'ankle:fibula+talus'; strategy = 'blend';
    } else if (/calcaneofibular/.test(name)) {
      anchors = [nearest(follower, bone(/^fibula /, side))[0], nearest(follower, bone(/^calcaneus /, side))[0]].filter(Boolean);
      rule = 'ankle:fibula+calcaneus'; strategy = 'blend';
    } else if (/tibiotalar/.test(name)) {
      anchors = [nearest(follower, bone(/^tibia /, side))[0], nearest(follower, bone(/^talus /, side))[0]].filter(Boolean);
      rule = 'ankle:tibia+talus'; strategy = 'blend';
    } else if (/tibiocalcaneal/.test(name)) {
      anchors = [nearest(follower, bone(/^tibia /, side))[0], nearest(follower, bone(/^calcaneus /, side))[0]].filter(Boolean);
      rule = 'ankle:tibia+calcaneus'; strategy = 'blend';
    } else if (/tibionavicular/.test(name)) {
      anchors = [nearest(follower, bone(/^tibia /, side))[0], nearest(follower, bone(/^navicular bone /, side))[0]].filter(Boolean);
      rule = 'ankle:tibia+navicular'; strategy = 'blend';
    } else if (/talocalcaneal/.test(name)) {
      anchors = [nearest(follower, bone(/^talus /, side))[0], nearest(follower, bone(/^calcaneus /, side))[0]].filter(Boolean);
      rule = 'foot:talus+calcaneus'; strategy = 'blend';
    } else if (/talonavicular/.test(name)) {
      anchors = [nearest(follower, bone(/^talus /, side))[0], nearest(follower, bone(/^navicular bone /, side))[0]].filter(Boolean);
      rule = 'foot:talus+navicular'; strategy = 'blend';
    } else if (/calcaneonavicular/.test(name)) {
      anchors = [nearest(follower, bone(/^calcaneus /, side))[0], nearest(follower, bone(/^navicular bone /, side))[0]].filter(Boolean);
      rule = 'foot:calcaneus+navicular'; strategy = 'blend';
    } else if (/cuneonavicular/.test(name)) {
      anchors = [nearest(follower, bone(/cuneiform.* (?:left|right)$/, side))[0], nearest(follower, bone(/^navicular bone /, side))[0]].filter(Boolean);
      rule = 'foot:cuneiform+navicular'; strategy = 'blend';
    } else if (/glenohumeral|coracohumeral|transverse humeral/.test(name)) {
      anchors = [nearest(follower, bone(/^scapula /, side))[0], nearest(follower, bone(/^humerus /, side))[0]].filter(Boolean);
      rule = 'shoulder:scapula+humerus'; strategy = 'blend';
    } else if (/annular ligament of radius/.test(name)) {
      anchors = [nearest(follower, bone(/^radius /, side))[0], nearest(follower, bone(/^ulna /, side))[0]].filter(Boolean);
      rule = 'proximal-radioulnar:radius+ulna'; strategy = 'blend';
    } else if (/articular capsule of elbow|annular ligament of radius|radial collateral ligament(?! of wrist)|ulnar collateral ligament(?! of wrist)/.test(name)) {
      const forearm = /radial|radius/.test(name) ? bone(/^radius /, side) : bone(/^ulna /, side);
      anchors = [nearest(follower, bone(/^humerus /, side))[0], nearest(follower, forearm)[0]].filter(Boolean);
      rule = 'elbow:humerus+forearm'; strategy = 'blend';
    } else if (/oblique cord|quadrate ligament/.test(name)) {
      anchors = [nearest(follower, bone(/^radius /, side))[0], nearest(follower, bone(/^ulna /, side))[0]].filter(Boolean);
      rule = 'forearm:radius+ulna'; strategy = 'blend';
    } else if (/radio ulnar|radioulnar/.test(name)) {
      anchors = [nearest(follower, bone(/^radius /, side))[0], nearest(follower, bone(/^ulna /, side))[0]].filter(Boolean);
      rule = 'distal-radioulnar:radius+ulna'; strategy = 'blend';
    } else if (/^ulnopisiform ligament(?: (?:left|right))?$/.test(name)) {
      anchors = [nearest(follower, bone(/^ulna /, side))[0], nearest(follower, bone(/^pisiform /, side))[0]].filter(Boolean);
      rule = inferredSide ? `wrist:geometry-inferred-${side}:ulna+pisiform` : 'wrist:named-side:ulna+pisiform'; strategy = 'blend';
    } else if (region === 'hand' && !/radio.*carp|ulno.*carp|radiocarpal|ulnocarpal|wrist|radio ulnar/.test(name)) {
      anchors = nearest(follower, handBones(side)); rule = 'hand:nearest-named-side-bone';
    } else if (/radio.*carp|ulno.*carp|radiocarpal|ulnocarpal|wrist|radio ulnar/.test(name)) {
      const proximal = /ulna|ulno/.test(name) ? bone(/^ulna /, side) : bone(/^radius /, side);
      anchors = [nearest(follower, proximal)[0], nearest(follower, handBones(side))[0]].filter(Boolean);
      rule = 'wrist:forearm+carpal'; strategy = 'blend';
    } else if (region === 'hand') {
      anchors = nearest(follower, handBones(side)); rule = 'hand:nearest-named-side-bone';
    } else if (region === 'foot' || /sesamoid.*foot/.test(name)) {
      anchors = nearest(follower, footBones(side)); rule = /sesamoid/.test(name) ? 'foot-sesamoid:nearest-foot-bone' : 'foot:nearest-named-side-bone';
    } else if (region === 'leg') {
      anchors = nearest(follower, withSide(byName(/^(femur|patella|tibia|fibula) /), side)); rule = 'leg:nearest-long-bone';
    } else if (region === 'arm') {
      anchors = nearest(follower, withSide(byName(/^(humerus|radius|ulna) /), side)); rule = 'arm:nearest-long-bone';
    }

    anchors = [...new Set(anchors.filter(Boolean))];
    if (!anchors.length) return { follower, unbound: true, reason: region ? `no-${region}-anchor` : 'outside-moving-limb-rules' };
    if (anchors.length === 1) strategy = 'rigid';
    return { follower, anchors, rule, strategy, region: region || regionOf(names.get(anchors[0])), sideInference };
  }

  const decisions = followerEntries.map(resolve);
  const bindings = decisions.filter(decision => !decision.unbound);
  const unbound = decisions.filter(decision => decision.unbound);
  const fixed = unbound.filter(decision => decision.reason === 'fixed-proximal-connection');
  const geometryBase = new Map();
  const dirty = new Set();
  const bindingRegions = binding => binding.regions || (binding.regions = new Set(binding.anchors.map(anchor => regionOf(names.get(anchor))).filter(Boolean)));
  const intersects = (a, b) => [...a].some(value => b.has(value));
  const bindingModes = binding => [...MODE_REGIONS].filter(([, regions]) => intersects(regions, bindingRegions(binding))).map(([id]) => id);

  function cacheGeometry(binding) {
    if (binding.geometry) return binding.geometry;
    binding.geometry = (binding.follower.meshes || []).map(mesh => {
      const position = mesh.geometry?.attributes?.position;
      if (!position) return null;
      const original = position.array.slice();
      const normal = mesh.geometry.attributes.normal?.array.slice() || null;
      const anchorSamples = binding.anchors.map(anchor => samples.get(anchor));
      const weights = new Float32Array(position.count);
      if (binding.anchors.length === 2) {
        const point = new THREE.Vector3();
        for (let i = 0; i < position.count; i++) {
          point.fromBufferAttribute(position, i);
          if (inverseBasis) point.applyMatrix4(inverseBasis);
          const d0 = Math.sqrt(surfaceDistance([point], anchorSamples[0])) + 1e-6;
          const d1 = Math.sqrt(surfaceDistance([point], anchorSamples[1])) + 1e-6;
          weights[i] = d0 + d1 > 0 ? d0 / (d0 + d1) : .5;
        }
      }
      const value = { mesh, original, normal, weights };
      geometryBase.set(mesh, value);
      return value;
    }).filter(Boolean);
    return binding.geometry;
  }

  function restoreGeometry(value) {
    const position = value.mesh.geometry.attributes.position;
    position.array.set(value.original); position.needsUpdate = true;
    if (value.normal) { value.mesh.geometry.attributes.normal.array.set(value.normal); value.mesh.geometry.attributes.normal.needsUpdate = true; }
    value.mesh.geometry.computeBoundingBox?.(); value.mesh.geometry.computeBoundingSphere?.();
  }

  function restoreBindings(set) {
    for (const binding of set) {
      binding.follower.motion?.matrix?.identity();
      if (binding.follower.motion) binding.follower.motion.matrixWorldNeedsUpdate = true;
      for (const value of binding.geometry || []) restoreGeometry(value);
    }
  }

  function reset() {
    restoreBindings(dirty);
    dirty.clear();
  }

  function extendTargets(mode) {
    const regions = MODE_REGIONS.get(mode?.id);
    if (!regions) return mode?.targets || [];
    const targetSet = new Set(mode.targets || []);
    for (const binding of bindings) {
      if (!intersects(regions, bindingRegions(binding))) continue;
      if (binding.anchors.some(anchor => targetSet.has(anchor))) targetSet.add(binding.follower);
    }
    mode.targets = [...targetSet];
    return mode.targets;
  }

  function apply(mode, posed = new Set()) {
    const regions = MODE_REGIONS.get(typeof mode === 'string' ? mode : mode?.id);
    if (!regions) return 0;
    reset();
    let applied = 0;
    const point = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const item of fixed) {
      item.follower.motion.matrix.identity();
      item.follower.motion.matrixWorldNeedsUpdate = true;
      posed.add(item.follower); dirty.add(item);
    }
    for (const binding of bindings) {
      if (!intersects(regions, bindingRegions(binding))) continue;
      const moved = binding.anchors.filter(anchor => matrixMoved(anchor.motion?.matrix));
      if (!moved.length) continue;
      if (binding.strategy === 'rigid' || binding.anchors.length === 1 || (binding.anchors.length === 2 && sameMatrix(binding.anchors[0].motion.matrix, binding.anchors[1].motion.matrix))) {
        binding.follower.motion.matrix.copy(moved[0].motion.matrix);
        binding.follower.motion.matrixWorldNeedsUpdate = true;
        posed.add(binding.follower); dirty.add(binding); applied++; continue;
      }
      const [anchor0, anchor1] = binding.anchors;
      binding.follower.motion.matrix.identity();
      binding.follower.motion.matrixWorldNeedsUpdate = true;
      posed.add(binding.follower);
      for (const value of cacheGeometry(binding)) {
        const output = value.mesh.geometry.attributes.position.array;
        for (let i = 0; i < output.length; i += 3) {
          point.fromArray(value.original, i);
          a.copy(point).applyMatrix4(anchor0.motion.matrix);
          b.copy(point).applyMatrix4(anchor1.motion.matrix);
          a.lerp(b, value.weights[i / 3]).toArray(output, i);
        }
        value.mesh.geometry.attributes.position.needsUpdate = true;
        value.mesh.geometry.computeVertexNormals?.();
        value.mesh.geometry.computeBoundingBox?.(); value.mesh.geometry.computeBoundingSphere?.();
      }
      dirty.add(binding); applied++;
    }
    return applied;
  }

  function getBindings() {
    return bindings.map(binding => ({
      followerId: entryId(binding.follower),
      followerName: names.get(binding.follower),
      anchorIds: binding.anchors.map(entryId),
      anchorNames: binding.anchors.map(anchor => names.get(anchor)),
      rule: binding.rule,
      strategy: binding.strategy,
      modes: bindingModes(binding),
      ...(binding.sideInference ? { sideInference: binding.sideInference } : {}),
    }));
  }

  function getUnbound() {
    return unbound.map(item => ({
      followerId: entryId(item.follower),
      followerName: names.get(item.follower),
      reason: item.reason,
    }));
  }

  function dispose() {
    reset();
    bindings.length = 0;
    geometryBase.clear(); samples.clear(); names.clear();
  }

    return { extendTargets, apply, reset, dispose, getBindings, getUnbound };
}
