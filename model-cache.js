export const DEFAULT_MODEL_CACHE_BYTES = 128 * 1024 * 1024;

function normalizeLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit < 0) throw new RangeError('Model cache limit must be a non-negative number');
  return Math.floor(limit);
}

export function createModelCache({ maxBytes = DEFAULT_MODEL_CACHE_BYTES } = {}) {
  const limit = normalizeLimit(maxBytes);
  const entries = new Map();
  let usedBytes = 0;

  function remove(key) {
    const existing = entries.get(key);
    if (!existing) return false;
    entries.delete(key);
    usedBytes -= existing.byteLength;
    return true;
  }

  return {
    get(key) {
      const buffer = entries.get(key);
      if (!buffer) return undefined;
      entries.delete(key);
      entries.set(key, buffer);
      return buffer;
    },

    set(key, buffer) {
      if (!(buffer instanceof ArrayBuffer)) throw new TypeError('Model cache values must be ArrayBuffer instances');
      remove(key);
      if (buffer.byteLength > limit) return false;

      entries.set(key, buffer);
      usedBytes += buffer.byteLength;
      while (usedBytes > limit) remove(entries.keys().next().value);
      return entries.has(key);
    },

    delete: remove,

    clear() {
      entries.clear();
      usedBytes = 0;
    },

    has(key) {
      return entries.has(key);
    },

    get size() {
      return entries.size;
    },

    get bytes() {
      return usedBytes;
    },

    get maxBytes() {
      return limit;
    },
  };
}

export function createModelCacheKey(entry, baseURL) {
  const parts = Array.isArray(entry?.parts) && entry.parts.length
    ? entry.parts
    : entry?.src
      ? [entry.src]
      : [];
  const urls = parts.map((part) => new URL(part, baseURL).href);
  return JSON.stringify({ bytes: entry?.bytes ?? null, parts: urls });
}

export const modelBufferCache = createModelCache();
