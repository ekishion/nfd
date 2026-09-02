// ==============================================================================
// src/cache.js - Memory TTL Cache, KV Wrapper & Remote DB Management
// ==============================================================================

import { FRAUD_CACHE_TTL, getFraudDbUrl, getKeywordDbUrl, getDefaultEnvConfig } from './config.js';
import { sendPlainText } from './telegram.js';

export const memoryCache = new Map();

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

export async function kvGetJson(key, fallback = null) {
  const value = await nfd.get(key, { type: 'json' });
  return value === null || value === undefined ? fallback : value;
}

export async function kvPutJson(key, value, options = {}) {
  return nfd.put(key, JSON.stringify(value), options);
}

export async function cachedKvGetJson(key, ttlMs = 60000, fallback = null) {
  const mem = getMemoryCache(key);
  if (mem !== undefined) return mem;
  const value = await kvGetJson(key, fallback);
  setMemoryCache(key, value, ttlMs);
  return value;
}

export async function cachedKvPutJson(key, value, kvOptions = {}, ttlMs = 60000) {
  setMemoryCache(key, value, ttlMs);
  return kvPutJson(key, value, kvOptions);
}

// Runtime Dynamic Settings (KV > Env > Default)
export async function getRuntimeConfig() {
  const cached = getMemoryCache('runtime-config');
  if (cached) return cached;

  const kvCfg = await kvGetJson('runtime-settings', {});
  const merged = {
    ...getDefaultEnvConfig(),
    ...(kvCfg && typeof kvCfg === 'object' ? kvCfg : {}),
  };
  setMemoryCache('runtime-config', merged, 60000);
  return merged;
}

export async function updateRuntimeConfig(patch) {
  const current = await getRuntimeConfig();
  const next = { ...current, ...patch };
  setMemoryCache('runtime-config', next, 60000);
  await kvPutJson('runtime-settings', next);
  return next;
}

export async function incrementStat(name) {
  const key = `stat-${name}`;
  const current = Number((await nfd.get(key)) || 0);
  await nfd.put(key, String(current + 1));
}

export async function checkCooldown(key, cooldownMs) {
  const now = Date.now();
  const mem = getMemoryCache(`cd-${key}`);
  if (mem && now - mem < cooldownMs) return false;

  const lastSentAt = Number((await nfd.get(key)) || 0);
  if (lastSentAt && now - lastSentAt < cooldownMs) {
    setMemoryCache(`cd-${key}`, lastSentAt, cooldownMs);
    return false;
  }

  setMemoryCache(`cd-${key}`, now, cooldownMs);
  await nfd.put(key, String(now));
  return true;
}

export async function sendCooldownPlainText(chatId, key, text, cooldownMs) {
  const allowed = await checkCooldown(key, cooldownMs);
  if (!allowed) return null;
  return sendPlainText(chatId, text);
}

export async function fetchRemoteDb(url, ttl = FRAUD_CACHE_TTL) {
  const cached = getMemoryCache(`remote-${url}`);
  if (cached) return cached;
  try {
    const text = await fetch(url).then((r) => r.text());
    const lines = text.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
    setMemoryCache(`remote-${url}`, lines, ttl);
    return lines;
  } catch (e) {
    console.log(JSON.stringify({ error: 'fetch-remote-db-failed', url, message: e.message }));
    return [];
  }
}

export async function isFraud(id) {
  const lines = await fetchRemoteDb(getFraudDbUrl());
  return lines.includes(String(id));
}

export async function fetchKeywordDb() {
  return fetchRemoteDb(getKeywordDbUrl());
}

export async function fetchTextOrDefault(url, fallback) {
  if (!url) return fallback;
  const cached = getMemoryCache(`text-${url}`);
  if (cached) return cached;
  try {
    const response = await fetch(url);
    if (response.ok) {
      const text = await response.text();
      setMemoryCache(`text-${url}`, text, 10 * 60 * 1000);
      return text;
    }
    return fallback;
  } catch (error) {
    console.log(JSON.stringify({ error: 'fetch-text-failed', url, message: error.message }));
    return fallback;
  }
}
