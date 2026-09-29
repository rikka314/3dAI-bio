const SYSTEMS = [
  { id: 'circulatory', label: { zh: '循环系统', en: 'Circulatory system' }, organs: ['heart'] },
  { id: 'digestive', label: { zh: '消化系统', en: 'Digestive system' }, organs: ['teeth', 'stomach', 'liver', 'pancreas', 'intestines'] },
  { id: 'respiratory', label: { zh: '呼吸系统', en: 'Respiratory system' }, organs: ['lungs', 'alveoli'] },
  { id: 'nervous', label: { zh: '神经系统', en: 'Nervous system' }, organs: ['brain'] },
  { id: 'urinary', label: { zh: '泌尿系统', en: 'Urinary system' }, organs: ['kidneys'] },
  { id: 'lymphatic', label: { zh: '淋巴系统', en: 'Lymphatic system' }, organs: ['spleen'] },
  { id: 'regional', label: { zh: '局部解剖', en: 'Regional anatomy' }, organs: ['thorax'] },
  { id: 'cellular', label: { zh: '细胞结构', en: 'Cell structures' }, organs: ['ribosome', 'chloroplast'] },
];

export const collectionRootLabel = { zh: '生物结构', en: 'Biological structures' };

export function resolveCollectionRoute(routeId, organs, lastOrganId) {
  if (routeId !== 'collection') return organs.find((organ) => organ.id === routeId) || null;
  return organs.find((organ) => organ.id === lastOrganId)
    || organs.find((organ) => organ.id === 'heart') || organs[0] || null;
}

export function revealOrganInTree(organs, organId, collapsedBranches) {
  const system = groupOrgansBySystem(organs).find((group) => group.organs.some((organ) => organ.id === organId));
  if (!system) return;
  collapsedBranches.delete('root');
  collapsedBranches.delete(system.id);
}

export function groupOrgansBySystem(organs) {
  const rank = new Map(SYSTEMS.flatMap((system) => system.organs.map((id, index) => [id, { system, index }])));
  const grouped = new Map(SYSTEMS.map((system) => [system.id, []]));
  const other = [];

  for (const organ of organs) {
    const placement = rank.get(organ.id);
    if (placement) grouped.get(placement.system.id).push(organ);
    else other.push(organ);
  }

  const branches = SYSTEMS.map((system) => ({
    id: system.id,
    label: system.label,
    organs: grouped.get(system.id).sort((a, b) => rank.get(a.id).index - rank.get(b.id).index),
  })).filter((system) => system.organs.length);

  if (other.length) branches.push({ id: 'other', label: { zh: '其他模型', en: 'Other models' }, organs: other });
  return branches;
}
