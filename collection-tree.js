const HUMAN_SYSTEMS = [
  { id: 'circulatory', label: { zh: '循环系统', en: 'Circulatory system' }, organs: ['heart'] },
  { id: 'digestive', label: { zh: '消化系统', en: 'Digestive system' }, organs: ['teeth', 'stomach', 'liver', 'pancreas', 'intestines'] },
  { id: 'respiratory', label: { zh: '呼吸系统', en: 'Respiratory system' }, organs: ['lungs', 'alveoli'] },
  { id: 'nervous', label: { zh: '神经系统', en: 'Nervous system' }, organs: ['brain'] },
  { id: 'urinary', label: { zh: '泌尿系统', en: 'Urinary system' }, organs: ['kidneys'] },
  { id: 'lymphatic', label: { zh: '淋巴系统', en: 'Lymphatic system' }, organs: ['spleen'] },
  { id: 'regional', label: { zh: '局部解剖', en: 'Regional anatomy' }, organs: ['thorax'] },
];

const PLANT_SYSTEMS = [
  { id: 'plant-cellular', label: { zh: '植物细胞与细胞器', en: 'Plant cells and organelles' }, organs: ['chloroplast', 'ribosome'] },
];

const COLLECTIONS = {
  human: { route: 'collection', label: { zh: '人体解剖', en: 'Human Anatomy' }, rootLabel: { zh: '系统解剖', en: 'Systematic Anatomy' }, systems: HUMAN_SYSTEMS, fallback: 'heart' },
  plant: { route: 'plants', label: { zh: '植物解剖', en: 'Plant Anatomy' }, rootLabel: { zh: '植物结构', en: 'Plant Structures' }, systems: PLANT_SYSTEMS, fallback: 'chloroplast' },
};

export const collectionLabels = Object.fromEntries(Object.entries(COLLECTIONS).map(([id, collection]) => [id, collection.label]));
export const collectionRootLabels = Object.fromEntries(Object.entries(COLLECTIONS).map(([id, collection]) => [id, collection.rootLabel]));

export function collectionIdForOrgan(organId) {
  return Object.entries(COLLECTIONS).find(([, collection]) => (
    collection.systems.some((system) => system.organs.includes(organId))
  ))?.[0] || 'human';
}

export function resolveCollectionRoute(routeId, organs, lastOrganIds = {}) {
  const direct = organs.find((organ) => organ.id === routeId);
  if (direct) return direct;
  const collectionEntry = Object.entries(COLLECTIONS).find(([, collection]) => collection.route === routeId);
  if (!collectionEntry) return null;
  const [collectionId, collection] = collectionEntry;
  const candidates = new Set(collection.systems.flatMap((system) => system.organs));
  return organs.find((organ) => organ.id === lastOrganIds[collectionId] && candidates.has(organ.id))
    || organs.find((organ) => organ.id === collection.fallback)
    || organs.find((organ) => candidates.has(organ.id)) || null;
}

export function revealOrganInTree(organs, organId, collapsedBranches) {
  const system = groupOrgansBySystem(organs, collectionIdForOrgan(organId)).find((group) => group.organs.some((organ) => organ.id === organId));
  if (!system) return;
  collapsedBranches.delete('root');
  collapsedBranches.delete(system.id);
}

export function groupOrgansBySystem(organs, collectionId = 'human') {
  const systems = COLLECTIONS[collectionId]?.systems || HUMAN_SYSTEMS;
  const rank = new Map(systems.flatMap((system) => system.organs.map((id, index) => [id, { system, index }])));
  const grouped = new Map(systems.map((system) => [system.id, []]));
  const other = [];

  for (const organ of organs) {
    const placement = rank.get(organ.id);
    if (placement) grouped.get(placement.system.id).push(organ);
    else if (collectionIdForOrgan(organ.id) === collectionId) other.push(organ);
  }

  const branches = systems.map((system) => ({
    id: system.id,
    label: system.label,
    organs: grouped.get(system.id).sort((a, b) => rank.get(a.id).index - rank.get(b.id).index),
  })).filter((system) => system.organs.length);

  if (other.length) branches.push({ id: 'other', label: { zh: '其他模型', en: 'Other models' }, organs: other });
  return branches;
}
