// ==============================================================================
// src/memory-cache.js - Isolate-level Memory TTL Cache & Update De-duplication
// ==============================================================================

export const memoryCache = new Map();
const recentUpdates = new Set();

function pruneExpiredMemoryCache() {
  const now = Date.now();
  for (const [key, item] of memoryCache.entries()) {
    if (item.expiresAt <= now) {
      memoryCache.delete(key);
    }
  }
}

export function getMemoryCache(key) {
  const item = memoryCache.get(key);
  if (!item) return undefined;
  if (item.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return undefined;
  }
  return item.value;
}

export function setMemoryCache(key, value, ttlMs = 60000) {
  if (memoryCache.size >= 500) {
    pruneExpiredMemoryCache();
  }
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

export function invalidateMemoryCache(key) {
  memoryCache.delete(key);
}

// Webhook update_id 去重（近似 LRU：Set 按插入序淘汰最旧条目）
export function isDuplicateUpdate(updateId) {
  if (!updateId) return false;
  if (recentUpdates.has(updateId)) return true;
  if (recentUpdates.size >= 200) {
    const first = recentUpdates.values().next().value;
    recentUpdates.delete(first);
  }
  recentUpdates.add(updateId);
  return false;
}
