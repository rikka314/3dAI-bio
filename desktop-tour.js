import { organs } from './content.js';
import { createViewer } from './viewer.js?v=20260929-explode';
import { prioritizeModelDownload } from './model-loading.js';

const EDGE_OPACITY = 0.78;

function call(callback, ...args) {
  try { callback?.(...args); } catch (error) { console.error(error); }
}

function smoothstep(value) {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

export function createDesktopTour(host, {
  onOrgan,
  onStatus,
  onPlayback,
  onError,
  onActivate,
  onSide,
  random = Math.random,
} = {}) {
  if (!(host instanceof Element)) throw new TypeError('createDesktopTour requires a host Element');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = {
    viewer: null,
    canvas: null,
    index: -1,
    shot: 0,
    phase: 'idle',
    elapsed: 0,
    lastTime: 0,
    raf: 0,
    running: false,
    disposed: false,
    userPaused: reducedMotion.matches,
    errorStopped: false,
    playbackState: null,
    pendingIndex: null,
    reservedIndex: null,
    xPercent: -100,
    opacity: EDGE_OPACITY,
    transitionFromX: -100,
    transitionFromOpacity: EDGE_OPACITY,
    queue: [],
    shots: [],
    initialShot: null,
    transitionMs: 450,
    side: 'right',
  };

  const between = (min, max) => min + random() * (max - min);

  function nextOrganIndex() {
    if (!state.queue.length) {
      state.queue = organs.map((_, index) => index);
      for (let index = state.queue.length - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1));
        [state.queue[index], state.queue[other]] = [state.queue[other], state.queue[index]];
      }
      // Keep every organ in each round, without a repeat at the round boundary.
      if (state.queue.length > 1 && state.queue[0] === state.index) {
        const other = 1 + Math.floor(random() * (state.queue.length - 1));
        [state.queue[0], state.queue[other]] = [state.queue[other], state.queue[0]];
      }
    }
    return state.queue.shift() ?? 0;
  }

  function prepareShots() {
    let azimuth = between(-Math.PI, Math.PI);
    const direction = () => [Math.sin(azimuth), between(0.18, 0.65), Math.cos(azimuth)];
    state.initialShot = { direction: direction(), distanceFactor: 1, duration: 0 };
    state.shots = Array.from({ length: 4 }, () => {
      azimuth += between(0.65, 1.8) * (random() < 0.5 ? -1 : 1);
      return {
        direction: direction(),
        distanceFactor: between(0.96, 1.12),
        duration: between(1300, 1900),
        hold: between(3000, 4400),
      };
    });
    state.transitionMs = between(360, 520);
  }

  function effectivePaused() {
    return state.userPaused || state.errorStopped || document.hidden;
  }

  function emitPlayback() {
    const paused = effectivePaused();
    if (paused === state.playbackState) return;
    state.playbackState = paused;
    call(onPlayback, paused);
  }

  function stopFrame() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.lastTime = 0;
  }

  function scheduleFrame() {
    if (state.disposed || !state.running || effectivePaused() || state.phase === 'loading'
      || state.phase === 'error' || state.raf) return;
    state.raf = requestAnimationFrame(frame);
  }

  function transitionDuration() {
    return reducedMotion.matches ? 0 : state.transitionMs;
  }

  function setPresentation(xPercent, opacity) {
    state.xPercent = Math.max(-100, Math.min(0, xPercent));
    state.opacity = Math.max(0, Math.min(1, opacity));
    if (Math.abs(state.xPercent) > 0.01) host.classList.remove('is-model-hovered');
    if (!state.canvas) return;
    const signedX = state.side === 'left' ? state.xPercent : -state.xPercent;
    state.canvas.style.transform = `translate3d(${signedX}%, 0, 0)`;
    state.canvas.style.opacity = String(state.opacity);
  }

  function beginShot(index) {
    state.shot = index;
    state.phase = 'shot';
    state.elapsed = 0;
    state.viewer.playShot(state.shots[index]);
  }

  function handlePhase() {
    if (state.phase === 'slide-in') {
      const duration = transitionDuration();
      const progress = duration ? smoothstep(state.elapsed / duration) : 1;
      setPresentation(-100 + 100 * progress, EDGE_OPACITY + (1 - EDGE_OPACITY) * progress);
      if (!duration || state.elapsed >= duration) {
        setPresentation(0, 1);
        beginShot(0);
      }
      return;
    }
    if (state.phase === 'shot' && state.elapsed >= state.shots[state.shot].duration) {
      state.phase = 'hold';
      state.elapsed = 0;
      return;
    }
    if (state.phase === 'hold' && state.elapsed >= state.shots[state.shot].hold) {
      if (state.shot + 1 < state.shots.length) beginShot(state.shot + 1);
      else {
        state.phase = 'slide-out';
        state.elapsed = 0;
        host.classList.remove('is-model-hovered');
        state.transitionFromX = state.xPercent;
        state.transitionFromOpacity = state.opacity;
        state.pendingIndex = takeReservedIndex();
      }
      return;
    }
    if (state.phase === 'slide-out') {
      const duration = transitionDuration();
      const progress = duration ? smoothstep(state.elapsed / duration) : 1;
      const x = state.transitionFromX + (-100 - state.transitionFromX) * progress;
      const opacity = state.transitionFromOpacity
        + (EDGE_OPACITY - state.transitionFromOpacity) * progress;
      setPresentation(x, opacity);
      if (!duration || state.elapsed >= duration) {
        setPresentation(-100, EDGE_OPACITY);
        const nextIndex = state.pendingIndex ?? takeReservedIndex();
        state.pendingIndex = null;
        loadOrgan(nextIndex);
      }
    }
  }

  function frame(timestamp) {
    if (state.disposed || !state.running || effectivePaused()) {
      state.raf = 0;
      state.lastTime = 0;
      return;
    }
    if (!state.lastTime) state.lastTime = timestamp;
    const delta = Math.min(Math.max(timestamp - state.lastTime, 0), 100);
    state.lastTime = timestamp;
    state.elapsed += delta;
    handlePhase();
    state.raf = 0;
    scheduleFrame();
  }

  function handleReady() {
    if (state.disposed || !state.running) return;
    state.viewer.playShot(state.initialShot);
    state.elapsed = 0;
    state.lastTime = 0;
    if (effectivePaused()) {
      state.phase = 'ready';
      setPresentation(0, 1);
    } else {
      state.phase = 'slide-in';
      setPresentation(transitionDuration() ? -100 : 0, transitionDuration() ? EDGE_OPACITY : 1);
      scheduleFrame();
    }
  }

  function handleError(error) {
    if (state.disposed) return;
    state.errorStopped = true;
    state.phase = 'error';
    stopFrame();
    state.viewer.setMotionPaused(true);
    emitPlayback();
    call(onError, error);
  }

  function loadOrgan(index) {
    if (state.disposed || !organs.length) return;
    stopFrame();
    state.index = ((index % organs.length) + organs.length) % organs.length;
    state.phase = 'loading';
    state.pendingIndex = null;
    state.elapsed = 0;
    prepareShots();
    state.side = state.side === 'left' ? 'right' : 'left';
    call(onSide, state.side);
    setPresentation(-100, EDGE_OPACITY);
    const entry = organs[state.index];
    call(onOrgan, entry);
    state.viewer.setMotionPaused(effectivePaused());
    state.viewer.load(entry);
    state.reservedIndex = nextOrganIndex();
    prioritizeModelDownload(organs[state.reservedIndex]);
  }

  function takeReservedIndex() {
    const index = state.reservedIndex ?? nextOrganIndex();
    state.reservedIndex = null;
    return index;
  }

  function syncPlayback() {
    const paused = effectivePaused();
    state.viewer.setMotionPaused(paused);
    if (paused) {
      stopFrame();
    } else if (state.phase === 'ready') {
      beginShot(0);
      scheduleFrame();
    } else {
      scheduleFrame();
    }
    emitPlayback();
  }

  function start() {
    if (state.disposed || state.running) return;
    state.running = true;
    emitPlayback();
    if (!organs.length) {
      const error = new Error('Desktop tour has no organ entries');
      call(onStatus, { phase: 'error', progress: null });
      handleError(error);
      return;
    }
    loadOrgan(nextOrganIndex());
  }

  function setTheme(theme) {
    state.viewer.setTheme(theme);
  }

  function setPaused(paused) {
    if (state.disposed) return;
    state.userPaused = Boolean(paused);
    syncPlayback();
  }

  function next() {
    if (state.disposed) return;
    if (state.phase === 'slide-out' && state.pendingIndex !== null) {
      if (effectivePaused()) loadOrgan(state.pendingIndex);
      return;
    }
    if (!state.running) state.running = true;
    state.errorStopped = false;
    emitPlayback();
    const nextIndex = takeReservedIndex();
    if (effectivePaused() || reducedMotion.matches || state.phase === 'loading' || state.phase === 'error') {
      loadOrgan(nextIndex);
      return;
    }
    state.pendingIndex = nextIndex;
    state.transitionFromX = state.xPercent;
    state.transitionFromOpacity = state.opacity;
    state.phase = 'slide-out';
    host.classList.remove('is-model-hovered');
    state.elapsed = 0;
    state.lastTime = 0;
    scheduleFrame();
  }

  function onVisibilityChange() {
    if (state.disposed) return;
    syncPlayback();
  }

  function onReducedMotionChange() {
    if (!reducedMotion.matches || state.disposed) return;
    state.userPaused = true;
    if (state.phase !== 'loading' && state.phase !== 'error') {
      state.phase = 'ready';
      state.elapsed = 0;
      if (state.pendingIndex !== null) state.queue.unshift(state.pendingIndex);
      state.pendingIndex = null;
      setPresentation(0, 1);
    }
    syncPlayback();
  }

  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    stopFrame();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    reducedMotion.removeEventListener?.('change', onReducedMotionChange);
    host.classList.remove('is-model-hovered');
    state.viewer.dispose();
    state.viewer = null;
    state.canvas = null;
  }

  try {
    state.viewer = createViewer(host, {
      transparent: true,
      onStatus: (status) => call(onStatus, status),
      onReady: handleReady,
      onError: handleError,
      onModelActivate() {
        if (['shot', 'hold', 'ready'].includes(state.phase)) call(onActivate, organs[state.index]);
      },
      onModelHover(hovered) {
        const stable = ['shot', 'hold', 'ready'].includes(state.phase) && Math.abs(state.xPercent) <= 0.01;
        host.classList.toggle('is-model-hovered', Boolean(hovered) && stable);
      },
    });
  } catch (error) {
    call(onStatus, { phase: 'error', progress: null });
    call(onError, error);
    throw error;
  }
  state.viewer.setInteractive(false);
  state.viewer.setMotionPaused(effectivePaused());
  state.canvas = host.querySelector('.viewer-canvas');
  setPresentation(-100, EDGE_OPACITY);
  document.addEventListener('visibilitychange', onVisibilityChange);
  reducedMotion.addEventListener?.('change', onReducedMotionChange);

  return { start, setTheme, setPaused, next, dispose };
}
