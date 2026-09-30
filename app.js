import { organs, messages } from './content.js';
import { createViewer } from './viewer.js?v=20260930-model-size';
// 首页暂时下线，保留导入代码以便恢复。
// import { createDesktopTour } from './desktop-tour.js?v=20260929-explode';
import { preloadModels } from './model-loading.js';
import { collectionIdForOrgan, collectionLabels, collectionRootLabels, groupOrgansBySystem, resolveCollectionRoute, revealOrganInTree } from './collection-tree.js';

const $ = (id) => document.getElementById(id);
const icons = {
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  next: '<path d="m5 5 10 7-10 7ZM19 5v14"/>',
  arrow: '<path d="M6 18 18 6M6 6h12v12"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  moon: '<path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  rotate: '<path d="m16 3 4 4-4 4M20 7H9a6 6 0 0 0-6 6m5 8-4-4 4-4m-4 4h11a6 6 0 0 0 6-6"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  collapse: '<path d="M3 8h5V3m13 5h-5V3M3 16h5v5m13-5h-5v5"/>',
  minus: '<path d="M5 12h14"/>', plus: '<path d="M5 12h14M12 5v14"/>',
  slice: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  explode: '<path d="m12 3 8 4-8 4-8-4 8-4ZM4 15l8 4 8-4M12 11v8"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
const readPreference = (key) => { try { return localStorage.getItem(`3dai-${key}`); } catch { return null; } };
const savePreference = (key, value) => { try { localStorage.setItem(`3dai-${key}`, value); } catch { /* Preferences are optional in storage-restricted browsers. */ } };
let language = readPreference('language') === 'en' ? 'en' : 'zh';
let theme = readPreference('theme');
if (!['light', 'dark'].includes(theme)) theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
let selected = organs[0];
const lastCollectionIds = { human: null, plant: null };
let currentCollection = 'human';
let detail = false;
let taskGeneralization = false;
// 关于页面暂时下线，保留状态代码以便恢复。
// let about = false;
let collectionOpen = false;
let desktopCollectionOpen = true;
const narrowLayout = matchMedia('(max-width: 899px)');
let collectionBeforeExpand = false;
let scrollBeforeExpand = 0;
const collapsedCollectionBranches = new Set(['root', ...['human', 'plant'].flatMap((collectionId) => groupOrgansBySystem(organs, collectionId).map((system) => system.id))]);
let viewer;
let loadedId;
let loadState = { phase: 'loading', progress: 0 };
let graphicsError = false;
let rotating = false;
let slicing = false;
let flipped = false;
let exploding = false;
let explodeAvailable = false;
let explodePercent = 0;
let expanded = false;
let expandAnimations = [];
let pageAnimation;
let modelAnimation;
let sliceAnimation;
// 首页暂时下线，保留轮播状态代码以便恢复。
// let tour;
// let tourOrgan = organs[0];
// let tourPaused = false;
// let tourState = { phase: 'loading', progress: 0 };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const PREVIEW_VIEW_SCALE = 1.4;
const EXPANDED_VIEW_SCALE = 1.1;
const t = (key) => messages[language][key] || key;

document.querySelectorAll('[data-icon]').forEach((element) => { element.innerHTML = icon(element.dataset.icon); });

function renderNavigation() {
  const activeTreeItem = $('organ-nav').contains(document.activeElement)
    ? document.activeElement.closest('[role="treeitem"]') : null;
  const focusKey = activeTreeItem?.dataset.treeToggle
    ? `branch:${activeTreeItem.dataset.treeToggle}` : activeTreeItem?.getAttribute('href');
  const tree = document.createElement('ul');
  tree.className = 'collection-tree';
  tree.setAttribute('role', 'tree');
  tree.setAttribute('aria-label', collectionLabels[currentCollection][language]);

  const root = document.createElement('li');
  root.className = 'tree-node';
  root.setAttribute('role', 'none');
  const rootToggle = document.createElement('button');
  rootToggle.className = 'tree-branch';
  rootToggle.type = 'button';
  rootToggle.dataset.treeToggle = 'root';
  rootToggle.setAttribute('role', 'treeitem');
  rootToggle.setAttribute('aria-expanded', String(!collapsedCollectionBranches.has('root')));
  rootToggle.setAttribute('aria-owns', 'collection-root-group');
  rootToggle.setAttribute('aria-controls', 'collection-root-group');
  rootToggle.innerHTML = '<span class="tree-marker" aria-hidden="true"></span><span class="tree-label"></span>';
  rootToggle.querySelector('.tree-label').textContent = collectionRootLabels[currentCollection][language];
  root.append(rootToggle);

  const systems = document.createElement('ul');
  systems.className = 'tree-group';
  systems.id = 'collection-root-group';
  systems.setAttribute('role', 'group');
  systems.hidden = collapsedCollectionBranches.has('root');
  groupOrgansBySystem(organs, currentCollection).forEach((system) => {
    const branch = document.createElement('li');
    branch.className = 'tree-node';
    branch.setAttribute('role', 'none');
    const toggle = document.createElement('button');
    toggle.className = 'tree-branch';
    toggle.type = 'button';
    toggle.dataset.treeToggle = system.id;
    toggle.setAttribute('role', 'treeitem');
    toggle.setAttribute('aria-expanded', String(!collapsedCollectionBranches.has(system.id)));
    toggle.setAttribute('aria-owns', `collection-${system.id}-group`);
    toggle.setAttribute('aria-controls', `collection-${system.id}-group`);
    toggle.innerHTML = '<span class="tree-marker" aria-hidden="true"></span><span class="tree-label"></span>';
    toggle.querySelector('.tree-label').textContent = system.label[language];
    branch.append(toggle);

    const leaves = document.createElement('ul');
    leaves.className = 'tree-group';
    leaves.id = `collection-${system.id}-group`;
    leaves.setAttribute('role', 'group');
    leaves.hidden = collapsedCollectionBranches.has(system.id);
    system.organs.forEach((organ) => {
      const item = document.createElement('li');
      item.setAttribute('role', 'none');
      const nav = document.createElement('a');
      nav.className = 'tree-leaf';
      nav.href = `#${organ.id}`;
      nav.setAttribute('role', 'treeitem');
      nav.innerHTML = '<span class="tree-marker" aria-hidden="true"></span><span class="tree-label"></span>';
      nav.querySelector('.tree-label').textContent = organ.name[language];
      if (detail && selected.id === organ.id) nav.setAttribute('aria-current', 'page');
      item.append(nav);
      leaves.append(item);
    });
    branch.append(leaves);
    systems.append(branch);
  });
  root.append(systems);
  tree.append(root);
  $('organ-nav').replaceChildren(tree);
  if (focusKey) {
    const replacement = [...$('organ-nav').querySelectorAll('[role="treeitem"]')].find((item) => (
      item.dataset.treeToggle ? `branch:${item.dataset.treeToggle}` : item.getAttribute('href')
    ) === focusKey);
    replacement?.focus({ preventScroll: true });
  }
  // 首页暂时下线，保留导航状态代码以便恢复。
  // if (!detail && !about) $('home-link').setAttribute('aria-current', 'page'); else $('home-link').removeAttribute('aria-current');
  if (detail && currentCollection === 'human') $('collection-link').setAttribute('aria-current', 'page'); else $('collection-link').removeAttribute('aria-current');
  if (detail && currentCollection === 'plant') $('plant-collection-link').setAttribute('aria-current', 'page'); else $('plant-collection-link').removeAttribute('aria-current');
  if (taskGeneralization) $('task-generalization-link').setAttribute('aria-current', 'page'); else $('task-generalization-link').removeAttribute('aria-current');
  // 关于页面暂时下线，保留导航状态代码以便恢复。
  // if (about) $('about-link').setAttribute('aria-current', 'page'); else $('about-link').removeAttribute('aria-current');
}

function setControlsEnabled(enabled) {
  for (const element of document.querySelectorAll('#reset, #rotate, #slice, #zoom-in, #zoom-out, #slice-axis, #slice-depth, #slice-flip, [data-view]')) element.disabled = !enabled;
  $('explode').disabled = !enabled || !explodeAvailable;
  $('explode-depth').disabled = !enabled || !explodeAvailable;
}

function renderExplodeState() {
  $('explode-controls').hidden = !exploding;
  $('explode').setAttribute('aria-expanded', String(exploding));
  $('explode-depth').value = String(explodePercent);
  $('explode-value').value = `${explodePercent}%`;
  $('explode-depth').setAttribute('aria-valuetext', `${explodePercent}%`);
  const unavailable = loadState.phase === 'ready' && !explodeAvailable;
  const label = t(unavailable ? 'explodeUnavailable' : 'explode');
  $('explode').setAttribute('aria-label', label);
  $('explode').title = label;
  setControlsEnabled(loadState.phase === 'ready');
}

function renderLoadState() {
  const { phase, progress } = loadState;
  const ready = phase === 'ready';
  const failed = phase === 'error';
  $('load-overlay').hidden = ready;
  $('load-overlay').dataset.error = String(failed);
  $('viewport').setAttribute('aria-busy', String(!ready && !failed));
  $('loader').hidden = failed;
  $('progress').hidden = failed;
  $('retry').hidden = !failed;
  if (progress === null) $('progress').removeAttribute('value'); else $('progress').value = progress;
  $('status').textContent = failed ? t(graphicsError ? 'noWebGL' : 'error') : progress >= 94 ? t('preparing') : `${t('loading')}${progress === null ? '…' : ` · ${progress}%`}`;
  setControlsEnabled(ready);
}

function updateRotation(value) {
  rotating = value;
  $('rotate').setAttribute('aria-pressed', String(value));
  $('rotate').querySelector('[data-i18n]').textContent = t(value ? 'pause' : 'rotate');
}

function renderText() {
  $('download-model').href = selected.downloadUrl;
  $('download-model').download = `${selected.modelId}.glb`;
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  // 首页和关于页面暂时下线，保留原始标题逻辑以便恢复。
  // document.title = detail ? `${selected.name[language]} — Bio3D` : about ? `${t('about')} — Bio3D` : 'Bio3D';
  document.title = taskGeneralization ? `${t('taskGeneralization')} — Bio3D` : `${selected.name[language]} — Bio3D`;
  document.querySelectorAll('[data-i18n]').forEach((element) => { element.textContent = t(element.dataset.i18n); });
  document.querySelectorAll('[data-label]').forEach((element) => { element.setAttribute('aria-label', t(element.dataset.label)); element.title = t(element.dataset.label); });
  $('language').textContent = language === 'zh' ? 'EN' : '中文';
  $('language').setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换中文');
  $('task-generalization-section').setAttribute('aria-label', t('taskGeneralization'));
  document.querySelector('.task-generalization-sidebar').setAttribute('aria-label', t('taskSidebar'));
  // 关于页面暂时下线，保留无障碍标签代码以便恢复。
  // $('about-section').setAttribute('aria-label', t('about'));
  const system = groupOrgansBySystem(organs, currentCollection).find((group) => group.organs.some((organ) => organ.id === selected.id));
  $('eyebrow').textContent = `${collectionRootLabels[currentCollection][language]} / ${system?.label[language] || t('organs')}`;
  $('collection-toggle').querySelector('[data-i18n="collection"]').textContent = collectionLabels[currentCollection][language];
  $('organ-secondary-name').textContent = language === 'zh' ? selected.name.en : '';
  $('organ-secondary-name').hidden = language !== 'zh';
  $('organ-description').textContent = selected.description[language];
  $('observation-points').replaceChildren(...selected.observationPoints[language].map((point) => {
    const item = document.createElement('li');
    item.textContent = point;
    return item;
  }));
  $('organ-title').textContent = selected.name[language];
  $('navigation').setAttribute('aria-label', t('navigation'));
  $('view-presets').setAttribute('aria-label', t('viewLabel'));
  $('view-presets').title = t('sliceNote');
  $('progress').setAttribute('aria-label', t('progress'));
  $('viewport').querySelector('canvas')?.setAttribute('aria-label', t(expanded ? 'canvas' : 'previewCanvas'));
  updateRotation(rotating);
  renderExplodeState();
  renderTheme();
  renderNavigation();
  setCollectionOpen(collectionOpen);
  renderLoadState();
  updateExpandLabel();
  // 首页暂时下线，保留轮播渲染调用以便恢复。
  // renderTour();
}

/* 首页暂时下线，保留轮播代码以便恢复。
function renderTour() {
  $('tour-organ').textContent = tourOrgan.name[language];
  $('tour-counter').textContent = `${String(organs.indexOf(tourOrgan) + 1).padStart(2, '0')} / ${String(organs.length).padStart(2, '0')}`;
  $('tour-open').href = `#${tourOrgan.id}`;
  const playLabel = t(tourPaused ? 'playTour' : 'pauseTour');
  $('tour-play').innerHTML = icon(tourPaused ? 'play' : 'pause');
  $('tour-play').setAttribute('aria-label', playLabel);
  $('tour-play').title = playLabel;
  $('tour-play').disabled = reducedMotion.matches || tourState.phase === 'error';
  $('desktop-viewport').querySelector('canvas')?.setAttribute('aria-label', `${t('tour')} · ${tourOrgan.name[language]}`);
  const ready = tourState.phase === 'ready';
  const failed = tourState.phase === 'error';
  $('tour-overlay').hidden = !failed;
  $('tour-retry').hidden = !failed;
  $('desktop-viewport').setAttribute('aria-busy', String(!ready && !failed));
  $('tour-status').textContent = failed ? t('error') : '';
}

function startTour() {
  if (tour) return;
  tourState = { phase: 'loading', progress: 0 };
  renderTour();
  try {
    tour = createDesktopTour($('desktop-viewport'), {
      onOrgan(organ) { tourOrgan = organ; $('desktop').dataset.organ = organ.id; renderTour(); },
      onStatus(state) { tourState = state; renderTour(); },
      onPlayback(paused) { tourPaused = paused; renderTour(); },
      onError(error) { console.error('Bio3D desktop:', error); },
      onActivate(organ) { location.hash = organ.id; },
      onSide(side) { $('desktop').dataset.side = side; },
    });
    tour.setTheme(theme);
    tour.start();
  } catch (error) {
    console.error('Bio3D desktop:', error);
    tourState = { phase: 'error', progress: null };
    renderTour();
  }
}
*/

function renderTheme() {
  document.documentElement.dataset.theme = theme;
  $('theme').innerHTML = icon(theme === 'light' ? 'moon' : 'sun');
  const label = t(theme === 'light' ? 'dark' : 'light');
  $('theme').setAttribute('aria-label', label); $('theme').title = label;
  viewer?.setTheme(theme);
  // 首页暂时下线，保留轮播主题代码以便恢复。
  // tour?.setTheme(theme);
}

function ensureViewer() {
  if (viewer) return true;
  try {
    viewer = createViewer($('viewport'), {
      viewScale: EXPANDED_VIEW_SCALE,
      onStatus(state) { loadState = state; renderLoadState(); },
      onReady() {
        $('viewport').querySelector('canvas')?.setAttribute('aria-label', t(expanded ? 'canvas' : 'previewCanvas'));
        const info = viewer.getExplodeInfo();
        explodeAvailable = info.available;
        explodePercent = info.percent;
        renderExplodeState();
        revealModel();
      },
      onError(error) { console.error('Bio3D model viewer:', error); },
      onRotateChange: updateRotation,
      onReset() {
        explodePercent = 0;
        renderExplodeState();
        document.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', 'false'));
      },
    });
    viewer.setTheme(theme);
    viewer.setFullControls(expanded);
    viewer.setViewScale(expanded ? EXPANDED_VIEW_SCALE : PREVIEW_VIEW_SCALE);
    graphicsError = false;
    return true;
  } catch (error) {
    console.error('Bio3D graphics initialization:', error);
    graphicsError = true;
    loadState = { phase: 'error', progress: null };
    renderLoadState();
    return false;
  }
}

function applySlice() {
  viewer?.setSlice({ enabled: slicing, axis: $('slice-axis').value, percent: Number($('slice-depth').value), flip: flipped });
  $('slice-value').value = `${$('slice-depth').value}%`;
  $('slice-depth').setAttribute('aria-valuetext', `${$('slice-depth').value}%`);
  $('slice-flip').setAttribute('aria-pressed', String(flipped));
}

// Match the compact horizontal rail used by the model-height container query.
new ResizeObserver(() => {
  $('slice-depth').setAttribute('aria-orientation', 'horizontal');
}).observe($('viewer-shell'));

function finishSliceAnimation() {
  if (!sliceAnimation) return;
  sliceAnimation.onfinish = null;
  sliceAnimation.cancel();
  sliceAnimation = null;
}

function toggleSlice() {
  finishSliceAnimation();
  const opening = !slicing;
  if (opening && exploding) closeExplode();
  slicing = opening;
  $('slice-panel').hidden = !slicing;
  $('slice').setAttribute('aria-expanded', String(slicing));
  applySlice();
  if (slicing && !reducedMotion.matches) {
    sliceAnimation = $('slice-panel').animate([
      { opacity: 0 },
      { opacity: 1 },
    ], { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    sliceAnimation.onfinish = finishSliceAnimation;
  }
}

function closeExplode() {
  exploding = false;
  explodePercent = 0;
  viewer?.setExplode(0);
  renderExplodeState();
}

function toggleExplode() {
  if (!explodeAvailable) return;
  if (exploding) {
    closeExplode();
    return;
  }
  finishSliceAnimation();
  slicing = false;
  $('slice-panel').hidden = true;
  $('slice').setAttribute('aria-expanded', 'false');
  applySlice();
  exploding = true;
  explodePercent = 0;
  viewer?.setExplode(0);
  renderExplodeState();
}

function applyExplode() {
  explodePercent = Number($('explode-depth').value);
  viewer?.setExplode(explodePercent);
  renderExplodeState();
}

function loadSelected() {
  finishSliceAnimation();
  finishModelReveal();
  $('viewport').style.opacity = '0';
  slicing = false; flipped = false;
  exploding = false; explodeAvailable = false; explodePercent = 0;
  $('slice-panel').hidden = true; $('slice').setAttribute('aria-expanded', 'false');
  $('slice-axis').value = 'x'; $('slice-depth').value = '50';
  renderExplodeState();
  document.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', 'false'));
  if (ensureViewer()) {
    applySlice();
    loadedId = selected.id;
    viewer.load(selected);
  }
}

function route() {
  if (location.hash === '#main') return;
  finishPageTransition();
  finishModelReveal();
  const id = location.hash.slice(1);
  taskGeneralization = id === 'task-generalization';
  const match = resolveCollectionRoute(id, organs, lastCollectionIds);
  // 首页和关于页面暂时下线；根地址、关于页及未知路由临时进入成果集。
  if (!match && !taskGeneralization) {
    history.replaceState(history.state, '', '#collection');
    route();
    return;
  }
  if (match) {
    // Keep the fresh collection folded; explicit links and return visits reveal the selected path.
    const nextCollection = collectionIdForOrgan(match.id);
    if (!['collection', 'plants'].includes(id) || lastCollectionIds[nextCollection] !== null) revealOrganInTree(organs, match.id, collapsedCollectionBranches);
    selected = match;
    currentCollection = nextCollection;
    lastCollectionIds[currentCollection] = match.id;
    // Give each history entry its actual organ so Back/Forward cannot resolve a stale alias.
    if (['collection', 'plants'].includes(id)) history.replaceState(history.state, '', `#${match.id}`);
  }
  detail = Boolean(match);
  // 关于页面暂时下线，保留路由状态代码以便恢复。
  // about = id === 'about';
  if (expanded) setExpanded(false);
  finishExpansion();
  $('collection-sidebar').hidden = !detail;
  setCollectionOpen(!narrowLayout.matches && desktopCollectionOpen);
  // 首页暂时下线，保留页面显隐代码以便恢复。
  // $('desktop').hidden = detail || about;
  $('detail-section').hidden = !detail;
  $('task-generalization-section').hidden = !taskGeneralization;
  // 关于页面暂时下线，保留页面显隐代码以便恢复。
  // $('about-section').hidden = !about;
  // $('main').classList.toggle('desktop-main', !detail && !about);
  $('main').classList.toggle('detail-main', detail);
  $('main').classList.toggle('task-generalization-main', taskGeneralization);
  // 关于页面暂时下线，保留页面样式代码以便恢复。
  // $('main').classList.toggle('about-main', about);
  // 首页暂时下线，保留轮播清理代码以便恢复。
  // if (detail || about) {
  //   tour?.dispose();
  //   tour = null;
  // }
  if (!detail) {
    viewer?.dispose();
    viewer = null;
    loadedId = null;
  }
  renderText();
  if (detail) {
    if (loadedId !== selected.id) loadSelected();
    else if (loadState.phase === 'ready') revealModel();
    else if (loadState.phase === 'loading') $('viewport').style.opacity = '0';
  // 首页暂时下线，保留轮播启动代码以便恢复。
  // } else if (!about) startTour();
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (!reducedMotion.matches) {
    // Move only the page content inside a stationary clip, so the animation
    // cannot temporarily extend the document and toggle its scrollbar.
    // 首页和关于页面暂时下线，当前只对成果集详情执行转场。
    // const page = $(detail ? 'detail-section' : about ? 'about-section' : 'desktop');
    const page = taskGeneralization ? $('task-generalization-section') : $('detail-section');
    $('main').classList.add('page-transitioning');
    pageAnimation = page.animate([
      { opacity: 0, transform: 'translateY(24px)' },
      { opacity: 1, transform: 'none' },
    ], { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    pageAnimation.onfinish = finishPageTransition;
  }
}

function finishPageTransition() {
  if (pageAnimation) {
    pageAnimation.onfinish = null;
    pageAnimation.cancel();
    pageAnimation = null;
  }
  $('main').classList.remove('page-transitioning');
}

function finishModelReveal() {
  if (modelAnimation) {
    modelAnimation.onfinish = null;
    modelAnimation.cancel();
    modelAnimation = null;
  }
  $('viewport').style.opacity = '1';
}

function revealModel() {
  finishModelReveal();
  if (!detail || reducedMotion.matches) return;
  modelAnimation = $('viewport').animate([
    { opacity: 0, transform: 'scale(0.97)' },
    { opacity: 1, transform: 'none' },
  ], { duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' });
  modelAnimation.onfinish = finishModelReveal;
}

function updateExpandLabel() {
  const label = t(expanded ? 'collapse' : 'expand');
  $('expand').setAttribute('aria-label', label); $('expand').title = label;
  $('expand').setAttribute('aria-expanded', String(expanded));
  $('expand').innerHTML = icon(expanded ? 'collapse' : 'expand');
  document.querySelector('.model-hint').textContent = t(expanded ? 'hint' : 'previewHint');
  $('viewport').querySelector('canvas')?.setAttribute('aria-label', t(expanded ? 'canvas' : 'previewCanvas'));
}

function finishExpansion() {
  for (const animation of expandAnimations) {
    animation.onfinish = null;
    animation.cancel();
  }
  expandAnimations = [];
  $('viewer-shell').classList.remove('is-transitioning');
}

function setExpanded(value) {
  finishPageTransition();
  finishExpansion();
  if (value) {
    collectionBeforeExpand = collectionOpen;
    scrollBeforeExpand = window.scrollY;
  } else {
    // Return the reading view to a plain draggable preview.
    viewer?.setRotate(false);
    finishSliceAnimation();
    slicing = false;
    flipped = false;
    $('slice-panel').hidden = true;
    $('slice').setAttribute('aria-expanded', 'false');
    applySlice();
    closeExplode();
  }
  expanded = value;
  viewer?.setFullControls(value);
  viewer?.setViewScale(value ? EXPANDED_VIEW_SCALE : PREVIEW_VIEW_SCALE);
  $('detail-section').classList.toggle('expanded', value);
  for (const element of document.querySelectorAll('.skip-link,.topbar,.collection-edge,.organ-introduction,.anatomy-note')) element.inert = value;
  $('organ-introduction').setAttribute('aria-hidden', String(value));
  setCollectionOpen(value ? false : collectionBeforeExpand);
  updateExpandLabel();
  $('expand').focus({ preventScroll: true });
  if (!value) window.scrollTo({ top: scrollBeforeExpand, behavior: 'instant' });
  if (!reducedMotion.matches) {
    const animation = $('model-card').animate([{ opacity: 0.7 }, { opacity: 1 }], { duration: 180 });
    expandAnimations = [animation];
    animation.onfinish = finishExpansion;
  }
}

function setCollectionOpen(open) {
  collectionOpen = open && detail && !expanded;
  open = collectionOpen;
  if (detail && !narrowLayout.matches && !expanded) desktopCollectionOpen = open;
  document.body.dataset.collectionOpen = String(open && !narrowLayout.matches);
  const edgeHadFocus = document.activeElement === $('collection-edge');
  $('collection-edge').hidden = !detail || open || expanded;
  $('organ-nav').hidden = false;
  $('collection-sidebar').dataset.open = String(open);
  if (!open && $('collection-sidebar').contains(document.activeElement)) $('collection-edge').focus({ preventScroll: true });
  $('collection-sidebar').inert = !open;
  $('collection-sidebar').setAttribute('aria-hidden', String(!open));
  $('collection-edge').setAttribute('aria-expanded', String(open));
  $('collection-toggle').setAttribute('aria-expanded', String(open));
  const collectionName = collectionLabels[currentCollection][language];
  const label = language === 'zh' ? `${open ? '收起' : '展开'}${collectionName}` : `${open ? 'Close' : 'Open'} ${collectionName.toLowerCase()}`;
  $('collection-edge').setAttribute('aria-label', t('modelDirectory'));
  $('collection-edge').title = t('modelDirectory');
  $('collection-toggle').setAttribute('aria-label', label);
  $('collection-toggle').title = label;
  if (open && edgeHadFocus) $('collection-toggle').focus({ preventScroll: true });
}
$('collection-edge').addEventListener('click', () => setCollectionOpen(!collectionOpen));
document.addEventListener('pointerdown', (event) => {
  if (narrowLayout.matches && !$('collection-sidebar').contains(event.target) && !$('collection-edge').contains(event.target)) setCollectionOpen(false);
});
$('collection-toggle').addEventListener('click', () => setCollectionOpen(!collectionOpen));
$('collection-edge').addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown') return;
  event.preventDefault();
  setCollectionOpen(true);
  const visibleItems = [...$('organ-nav').querySelectorAll('[role="treeitem"]')]
    .filter((item) => !item.closest('[hidden]'));
  (visibleItems.find((item) => item.getAttribute('aria-current') === 'page') || visibleItems[0])?.focus();
});
$('organ-nav').addEventListener('keydown', (event) => {
  const current = event.target.closest('[role="treeitem"]');
  if (!current) return;
  const items = [...$('organ-nav').querySelectorAll('[role="treeitem"]')]
    .filter((item) => !item.closest('[hidden]'));
  const index = items.indexOf(current);
  let next;
  if (event.key === 'ArrowDown') next = items[index + 1] || items[0];
  else if (event.key === 'ArrowUp') next = items[index - 1] || items.at(-1);
  else if (event.key === 'Home') next = items[0];
  else if (event.key === 'End') next = items.at(-1);
  else if (event.key === 'ArrowRight') {
    if (current.matches('button[aria-expanded="false"]')) current.click();
    else next = current.parentElement.querySelector(':scope > .tree-group [role="treeitem"]');
  } else if (event.key === 'ArrowLeft') {
    if (current.matches('button[aria-expanded="true"]')) current.click();
    else next = current.closest('.tree-group')?.parentElement?.querySelector(':scope > .tree-branch');
  }
  else return;
  event.preventDefault();
  next?.focus();
});
$('organ-nav').addEventListener('click', (event) => {
  const toggle = event.target.closest('button[data-tree-toggle]');
  if (toggle) {
    const group = toggle.parentElement.querySelector(':scope > .tree-group');
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    group.hidden = !open;
    if (open) collapsedCollectionBranches.delete(toggle.dataset.treeToggle);
    else collapsedCollectionBranches.add(toggle.dataset.treeToggle);
    return;
  }
  const link = event.target.closest('a');
  if (link) {
    if (narrowLayout.matches) setCollectionOpen(false);
    if (link.hash === location.hash && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      route();
    }
  }
});
$('language').addEventListener('click', () => { language = language === 'zh' ? 'en' : 'zh'; savePreference('language', language); renderText(); });
// 首页暂时下线，保留轮播事件代码以便恢复。
// $('tour-play').addEventListener('click', () => tour?.setPaused(!tourPaused));
// $('tour-next').addEventListener('click', () => tour?.next());
// $('tour-retry').addEventListener('click', () => { tour?.dispose(); tour = null; startTour(); });
$('theme').addEventListener('click', () => { theme = theme === 'light' ? 'dark' : 'light'; savePreference('theme', theme); renderTheme(); });
$('reset').addEventListener('click', () => viewer?.reset());
$('rotate').addEventListener('click', () => viewer?.setRotate(!rotating));
$('zoom-in').addEventListener('click', () => viewer?.zoom(1.2));
$('zoom-out').addEventListener('click', () => viewer?.zoom(1 / 1.2));
$('retry').addEventListener('click', () => { viewer?.dispose(); viewer = null; loadSelected(); });
$('slice').addEventListener('click', toggleSlice);
$('slice-axis').addEventListener('change', applySlice);
$('slice-depth').addEventListener('input', applySlice);
$('slice-flip').addEventListener('click', () => { flipped = !flipped; applySlice(); });
$('explode').addEventListener('click', toggleExplode);
$('explode-depth').addEventListener('input', applyExplode);
$('expand').addEventListener('click', () => setExpanded(!expanded));
$('view-presets').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-view]');
  if (!button || button.disabled) return;
  viewer?.setView(button.dataset.view);
  document.querySelectorAll('[data-view]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
});
$('viewport').addEventListener('pointerdown', () => { viewer?.setRotate(false); document.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', 'false')); });
$('viewport').addEventListener('focusin', () => viewer?.setRotate(false));
document.addEventListener('keydown', (event) => {
  if (expanded && event.key === 'Escape') { event.preventDefault(); setExpanded(false); }
  else if (collectionOpen && event.key === 'Escape') { event.preventDefault(); setCollectionOpen(false); $('collection-edge').focus(); }
  if (expanded && event.key === 'Tab') {
    const items = [...$('model-card').querySelectorAll('a[href], button:not(:disabled), select:not(:disabled), input:not(:disabled), canvas[tabindex="0"]')]
      .filter((element) => element.getClientRects().length > 0);
    const first = items[0]; const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
narrowLayout.addEventListener('change', () => {
  if (expanded) collectionBeforeExpand = !narrowLayout.matches && desktopCollectionOpen;
  setCollectionOpen(!narrowLayout.matches && desktopCollectionOpen);
});
window.addEventListener('hashchange', route);
window.addEventListener('resize', finishExpansion);
reducedMotion.addEventListener('change', () => {
  finishExpansion();
  finishPageTransition();
  finishSliceAnimation();
  if (loadState.phase === 'ready') finishModelReveal();
  // 首页暂时下线，保留轮播渲染代码以便恢复。
  // renderTour();
});
route();
preloadModels(organs);
