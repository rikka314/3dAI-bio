import { createModelCacheKey, modelBufferCache } from './model-cache.js';

const SHOWCASE_BASE = new URL('./', import.meta.url);
export const MODEL_PRIORITY = Object.freeze({ background: 0, next: 50, foreground: 100 });

function abortError() {
  return new DOMException('The operation was aborted', 'AbortError');
}

function partsOf(entry) {
  return Array.isArray(entry?.parts) && entry.parts.length
    ? entry.parts
    : entry?.src
      ? [entry.src]
      : [];
}

function expectedBytesOf(entry) {
  return Number.isSafeInteger(entry?.bytes) && entry.bytes >= 0 ? entry.bytes : 0;
}

function validateGLB(buffer, expectedBytes) {
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError('Model response must be an ArrayBuffer');
  if (expectedBytes && buffer.byteLength !== expectedBytes) {
    throw new Error(`Model byte length mismatch: expected ${expectedBytes}, received ${buffer.byteLength}`);
  }
  if (buffer.byteLength < 12) throw new Error('Model response is too short to be a GLB');
  const header = new DataView(buffer, 0, 12);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2) {
    throw new Error('Model response is not a GLB 2.0 file');
  }
  if (header.getUint32(8, true) !== buffer.byteLength) {
    throw new Error('Model GLB header length does not match the downloaded data');
  }
}

export function createModelLoader({
  cache = modelBufferCache,
  baseURL = SHOWCASE_BASE,
  fetchImpl = (...args) => fetch(...args),
  concurrency = 1,
} = {}) {
  const jobs = new Map();
  const queue = [];
  let active = 0;
  let sequence = 0;

  function notify(job, progress) {
    job.progress = progress;
    for (const callback of job.progressCallbacks) {
      try { callback(progress); } catch (error) { console.error(error); }
    }
  }

  async function readPart(job, part, index, count, loadedBefore) {
    const response = await fetchImpl(new URL(part, baseURL).href, { signal: job.controller.signal });
    if (!response.ok) throw new Error(`Failed to load model part: HTTP ${response.status}`);
    if (!response.body) {
      const buffer = await response.arrayBuffer();
      const progress = job.expectedBytes
        ? Math.min(90, Math.round(((loadedBefore + buffer.byteLength) / job.expectedBytes) * 90))
        : Math.round(((index + 1) / count) * 90);
      notify(job, progress);
      return buffer;
    }
    const encoded = Boolean(response.headers.get('content-encoding'));
    const total = encoded ? 0 : Number(response.headers.get('content-length')) || 0;
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      const fraction = total ? received / total : 0;
      notify(job, job.expectedBytes
        ? Math.min(90, Math.round(((loadedBefore + received) / job.expectedBytes) * 90))
        : total
          ? Math.min(90, Math.round(((index + fraction) / count) * 90))
          : null);
    }
    return new Blob(chunks).arrayBuffer();
  }

  async function fetchJob(job) {
    const buffers = [];
    let loadedBytes = 0;
    for (let index = 0; index < job.parts.length; index += 1) {
      const buffer = await readPart(job, job.parts[index], index, job.parts.length, loadedBytes);
      buffers.push(buffer);
      loadedBytes += buffer.byteLength;
    }
    const packed = buffers.length === 1
      ? buffers[0]
      : await new Blob(buffers, { type: 'model/gltf-binary' }).arrayBuffer();
    validateGLB(packed, job.expectedBytes);
    cache.set(job.key, packed);
    return packed;
  }

  function sortQueue() {
    queue.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
  }

  function pump() {
    sortQueue();
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      if (job.state !== 'queued') continue;
      job.state = 'running';
      job.preempted = false;
      job.controller = new AbortController();
      active += 1;
      fetchJob(job).then((buffer) => {
        jobs.delete(job.key);
        job.resolve(buffer);
      }).catch((error) => {
        if (error?.name === 'AbortError' && job.preempted) {
          job.state = 'queued';
          job.sequence = ++sequence;
          queue.push(job);
          return;
        }
        jobs.delete(job.key);
        job.reject(error instanceof Error ? error : new Error(String(error)));
      }).finally(() => {
        active -= 1;
        job.controller = null;
        pump();
      });
    }
    requestQueuedSlot();
  }

  function requestQueuedSlot() {
    if (active < concurrency || [...jobs.values()].some((job) => job.state === 'running' && job.preempted)) return;
    sortQueue();
    const waiting = queue.find((job) => job.state === 'queued');
    if (!waiting) return;
    const candidate = [...jobs.values()]
      .filter((job) => job.state === 'running' && !job.preempted && job.priority < waiting.priority)
      .sort((left, right) => left.priority - right.priority || right.sequence - left.sequence)[0];
    if (!candidate) return;
    candidate.preempted = true;
    candidate.controller.abort();
  }

  function ensureJob(entry, priority) {
    const key = createModelCacheKey(entry, baseURL);
    const cached = cache.get(key);
    const expectedBytes = expectedBytesOf(entry);
    if (cached) {
      try {
        validateGLB(cached, expectedBytes);
        return { key, cached };
      } catch {
        cache.delete(key);
      }
    }
    let job = jobs.get(key);
    if (job) {
      if (priority > job.priority) {
        job.priority = priority;
        if (job.state === 'queued') pump();
      }
      return { key, job };
    }
    const parts = partsOf(entry);
    if (!parts.length) throw new Error('Model entry has no parts');
    job = {
      key,
      parts,
      expectedBytes,
      priority,
      sequence: ++sequence,
      state: 'queued',
      preempted: false,
      controller: null,
      progress: 0,
      progressCallbacks: new Set(),
      consumerPriorities: new Map(),
    };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    // Background callers often intentionally ignore completion; keep failures handled here.
    job.promise.catch(() => {});
    jobs.set(key, job);
    queue.push(job);
    pump();
    return { key, job };
  }

  function load(entry, { priority = MODEL_PRIORITY.foreground, signal, onProgress } = {}) {
    if (signal?.aborted) return Promise.reject(abortError());
    let result;
    try { result = ensureJob(entry, Number(priority) || 0); } catch (error) { return Promise.reject(error); }
    if (result.cached) {
      onProgress?.(90);
      return Promise.resolve(result.cached);
    }
    const { job } = result;
    const consumer = Symbol('model-consumer');
    job.consumerPriorities.set(consumer, Number(priority) || 0);
    job.priority = Math.max(...job.consumerPriorities.values());
    if (job.state === 'queued') pump();
    if (onProgress) {
      job.progressCallbacks.add(onProgress);
      if (job.progress !== 0) onProgress(job.progress);
    }
    const releaseConsumer = () => {
      job.progressCallbacks.delete(onProgress);
      job.consumerPriorities.delete(consumer);
      if (job.consumerPriorities.size) job.priority = Math.max(...job.consumerPriorities.values());
      else job.priority = MODEL_PRIORITY.background;
      if (job.state === 'queued') pump();
    };
    if (!signal) return job.promise.finally(releaseConsumer);
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        releaseConsumer();
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      job.promise.then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', onAbort);
        releaseConsumer();
      });
    });
  }

  function preload(entries, { priority = MODEL_PRIORITY.background } = {}) {
    for (const entry of entries || []) load(entry, { priority }).catch(() => {});
  }

  function prioritize(entry) {
    if (!entry) return;
    load(entry, { priority: MODEL_PRIORITY.next }).catch(() => {});
  }

  function invalidate(entry) {
    cache.delete(createModelCacheKey(entry, baseURL));
  }

  return { load, preload, prioritize, invalidate };
}

const sharedModelLoader = createModelLoader();

export const loadModelBuffer = (entry, options) => sharedModelLoader.load(entry, options);
export const preloadModels = (entries, options) => sharedModelLoader.preload(entries, options);
export const prioritizeModelDownload = (entry) => sharedModelLoader.prioritize(entry);
export const invalidateModelBuffer = (entry) => sharedModelLoader.invalidate(entry);
