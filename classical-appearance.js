// Reproduce the supplied Classical systems HTML's initial shading (lines 358–380).
// The GLB defaults to unlit teaching colors; the source viewer makes them respond to light.
export function applyClassicalSourceMaterials(THREE, root) {
  const replacements = new Map();
  root.traverse(object => {
    if (!object.isMesh) return;
    if (!object.geometry.getAttribute('normal')) object.geometry.computeVertexNormals();
    const convert = source => {
      if (!source) return source;
      let material = source;
      if (source.isMeshBasicMaterial) {
        material = replacements.get(source);
        if (!material) {
          material = new THREE.MeshStandardMaterial({
            color: source.color.clone(), map: source.map, vertexColors: source.vertexColors,
            transparent: source.transparent, opacity: source.opacity, roughness: 0.7, metalness: 0,
          });
          material.name = source.name;
          replacements.set(source, material);
        }
      }
      material.side = THREE.DoubleSide;
      material.clippingPlanes = [];
      return material;
    };
    object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
  });
  // Maps are retained by the replacements. Dispose only materials no longer used in this scene.
  root.traverse(object => {
    for (const material of [object.material].flat().filter(Boolean)) replacements.delete(material);
  });
  for (const material of replacements.keys()) material.dispose();
}

export function createClassicalSourceLights(THREE) {
  const lights = new THREE.Group();
  lights.name = 'classical-source-lighting';
  // The source viewer is Z-up; rotate every light with the model's display coordinate conversion.
  lights.rotation.x = -Math.PI / 2;
  lights.add(new THREE.HemisphereLight(0xffffff, 0xb4b9c6, 2));
  for (const [position, intensity] of [[[3, -4, 6], 2.8], [[-4, 2, 1], 1.1]]) {
    const light = new THREE.DirectionalLight(0xffffff, intensity);
    light.position.fromArray(position);
    lights.add(light);
  }
  return lights;
}
