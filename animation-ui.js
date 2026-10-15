const COPY = {
  zh: {
    motion: '结构动画', play: '播放', pause: '暂停', reset: '重置动画',
    progress: '动画进度', speed: '速度', amplitude: '幅度', side: '侧别',
    both: '双侧', left: '左侧', right: '右侧', particles: '流线粒子',
    illustrative: '示意运动，未经生理验证',
    loadError: '动画数据未能加载，模型可继续静态查看。', retry: '重新加载',
  },
  en: {
    motion: 'Structure motion', play: 'Play', pause: 'Pause', reset: 'Reset motion',
    progress: 'Motion progress', speed: 'Speed', amplitude: 'Amplitude', side: 'Side',
    both: 'Both', left: 'Left', right: 'Right', particles: 'Flow particles',
    illustrative: 'Illustrative motion; not physiologically validated',
    loadError: 'Motion data could not load. The model remains available as a static view.', retry: 'Reload',
  },
};

function modeLabel(mode, language) {
  if (!mode) return '';
  const label = mode.label || mode.name || mode.id;
  if (typeof label === 'object') return label[language] || label.en || label.zh || mode.id;
  if (language === 'zh') return mode.labelZh || mode.nameZh || label;
  return mode.labelEn || mode.nameEn || String(mode.id)
    .split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function capabilities(mode, state = {}) {
  const sides = mode?.sides || mode?.availableSides || state.availableSides || [];
  return {
    side: mode?.hasSide ?? mode?.supportsSide ?? mode?.sideSelectable ?? sides.length > 1,
    particles: mode?.hasParticles ?? mode?.supportsParticles ?? mode?.particlesAvailable ?? Boolean(state.particlesAvailable),
  };
}

export function deriveMotionUiModel(info = {}, language = 'zh', blocked = false) {
  const modes = Array.isArray(info.modes) ? info.modes.filter((mode) => mode?.id) : [];
  const state = info.state || {};
  const active = modes.find((mode) => mode.id === state.modeId) || modes[0] || null;
  return {
    visible: Boolean(info.error || (info.available && modes.length)),
    error: info.error || '',
    disabled: Boolean(info.disabled || info.error || blocked),
    modes: modes.map((mode) => ({ id: mode.id, label: modeLabel(mode, language) })),
    modeId: active?.id || '',
    playing: Boolean(state.playing),
    progress: Math.max(0, Math.min(1, Number(state.progress) || 0)),
    speed: Number(state.speed) || 1,
    amplitude: Math.max(0, Math.min(1.5, Number(state.amplitude) || 0)),
    side: ['both', 'left', 'right'].includes(state.side) ? state.side : 'both',
    particlesEnabled: Boolean(state.particlesEnabled),
    phaseLabel: state.phaseLabel || '',
    phaseDetail: state.phaseDetail || '',
    activeNames: Array.isArray(state.activeNames) ? state.activeNames : [],
    capabilities: capabilities(active, state),
  };
}

export function createAnimationUi(root, handlers = {}) {
  if (!(root instanceof Element)) throw new TypeError('createAnimationUi requires a root Element');
  let language = 'zh';
  let info = {};
  let blocked = false;
  let expanded = false;
  let renderedModeSignature = '';

  const elements = Object.fromEntries([...root.querySelectorAll('[data-motion]')]
    .map((element) => [element.dataset.motion, element]));

  function emit(name, value) { handlers[name]?.(value); }

  function render() {
    const copy = COPY[language];
    const model = deriveMotionUiModel(info, language, blocked);
    root.hidden = !model.visible || blocked || !expanded;
    if (root.hidden) return;
    root.dataset.playing = String(model.playing);
    root.dataset.error = String(Boolean(model.error));
    root.setAttribute('aria-label', copy.motion);
    elements.error.hidden = !model.error;
    elements.errorText.textContent = copy.loadError;
    elements.retry.textContent = copy.retry;
    elements.main.hidden = Boolean(model.error);
    elements.options.hidden = Boolean(model.error);
    elements.status.hidden = Boolean(model.error);
    elements.disclaimer.hidden = Boolean(model.error);
    if (model.error) return;

    const modeSignature = `${language}:${model.modes.map(({ id, label }) => `${id}:${label}`).join('|')}`;
    if (modeSignature !== renderedModeSignature) {
      elements.mode.replaceChildren(...model.modes.map(({ id, label }) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = label;
        return option;
      }));
      renderedModeSignature = modeSignature;
    }
    elements.mode.value = model.modeId;
    elements.mode.disabled = model.disabled;

    elements.toggle.textContent = model.playing ? copy.pause : copy.play;
    elements.toggle.setAttribute('aria-label', elements.toggle.textContent);
    elements.toggle.setAttribute('aria-pressed', String(model.playing));
    elements.toggle.disabled = model.disabled;
    elements.reset.setAttribute('aria-label', copy.reset);
    elements.reset.title = copy.reset;
    elements.reset.disabled = model.disabled;

    elements.progress.value = String(Math.round(model.progress * 1000));
    elements.progress.disabled = model.disabled;
    elements.progress.setAttribute('aria-label', copy.progress);
    elements.progress.setAttribute('aria-valuetext', `${Math.round(model.progress * 100)}%`);
    elements.progressValue.value = `${Math.round(model.progress * 100)}%`;

    elements.speed.value = String(model.speed);
    elements.speed.disabled = model.disabled;
    elements.speed.setAttribute('aria-label', copy.speed);
    elements.speedLabel.textContent = copy.speed;
    elements.amplitude.value = String(model.amplitude);
    elements.amplitude.disabled = model.disabled;
    elements.amplitude.setAttribute('aria-label', copy.amplitude);
    elements.amplitudeValue.value = `${Math.round(model.amplitude * 100)}%`;
    elements.amplitudeLabel.textContent = copy.amplitude;

    elements.sideWrap.hidden = !model.capabilities.side;
    elements.side.value = model.side;
    elements.side.disabled = model.disabled;
    elements.side.setAttribute('aria-label', copy.side);
    elements.sideLabel.textContent = copy.side;
    for (const option of elements.side.options) option.textContent = copy[option.value];

    elements.particlesWrap.hidden = !model.capabilities.particles;
    elements.particles.checked = model.particlesEnabled;
    elements.particles.disabled = model.disabled;
    elements.particlesLabel.textContent = copy.particles;

    const phase = [model.phaseLabel, model.phaseDetail].filter(Boolean).join(' · ');
    const names = model.activeNames.slice(0, 3).join(' / ');
    elements.status.textContent = [phase, names].filter(Boolean).join(' — ') || copy.illustrative;
    elements.disclaimer.textContent = copy.illustrative;
  }

  elements.mode.addEventListener('change', () => emit('select', elements.mode.value));
  elements.toggle.addEventListener('click', () => emit('toggle'));
  elements.reset.addEventListener('click', () => emit('reset'));
  elements.progress.addEventListener('input', () => emit('seek', Number(elements.progress.value) / 1000));
  elements.speed.addEventListener('change', () => emit('speed', Number(elements.speed.value)));
  elements.amplitude.addEventListener('input', () => emit('amplitude', Number(elements.amplitude.value)));
  elements.side.addEventListener('change', () => emit('side', elements.side.value));
  elements.particles.addEventListener('change', () => emit('particles', elements.particles.checked));
  elements.retry.addEventListener('click', () => emit('retry'));

  return {
    update(nextInfo) { info = nextInfo || {}; render(); },
    setExpanded(nextExpanded) {
      const next = Boolean(nextExpanded);
      if (next === expanded) return;
      expanded = next;
      render();
    },
    setLanguage(nextLanguage) {
      const next = nextLanguage === 'en' ? 'en' : 'zh';
      if (next === language) return;
      language = next;
      render();
    },
    setBlocked(nextBlocked) {
      const next = Boolean(nextBlocked);
      if (next === blocked) return;
      blocked = next;
      render();
    },
  };
}
