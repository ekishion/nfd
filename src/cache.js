// ==============================================================================
// src/cache.js - Memory TTL Cache, KV Wrapper & Remote DB Management
// ==============================================================================

import { FRAUD_CACHE_TTL, getFraudDbUrl, getKeywordDbUrl, getDefaultEnvConfig, asArray } from './config.js';
import { sendPlainText } from './telegram.js';

export const memoryCache = new Map();
const pendingStats = new Map();
const recentUpdates = new Set();

function pruneExpiredMemoryCache() {
  const now = Date.now();
  for (const [key, item] of memoryCache.entries()) {
    if (item.expiresAt <= now) {
      memoryCache.delete(key);
    }
  }
}

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
  const count = (pendingStats.get(name) || 0) + 1;
  if (count >= 5) {
    pendingStats.delete(name);
    const key = `stat-${name}`;
    const current = Number((await nfd.get(key)) || 0);
    await nfd.put(key, String(current + count));
  } else {
    pendingStats.set(name, count);
  }
}

export async function getStatCount(name) {
  const key = `stat-${name}`;
  const fromKv = Number((await nfd.get(key)) || 0);
  const fromMem = Number(pendingStats.get(name) || 0);
  return fromKv + fromMem;
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

// Guest Tagging System
export async function getGuestTag(chatId) {
  const key = `guest-tag-${chatId}`;
  return cachedKvGetJson(key, 300000, '');
}

export async function setGuestTag(chatId, tag) {
  const key = `guest-tag-${chatId}`;
  if (!tag) {
    invalidateMemoryCache(key);
    await nfd.delete(key);
    return '';
  }
  await cachedKvPutJson(key, tag, {}, 300000);
  return tag;
}

// Forum Topic Mapping System
export async function getGuestTopicId(chatId) {
  const key = `guest-topic-${chatId}`;
  return cachedKvGetJson(key, 300000, null);
}

export async function setGuestTopicId(chatId, topicId) {
  const key = `guest-topic-${chatId}`;
  const reverseKey = `topic-guest-${topicId}`;
  await Promise.all([
    cachedKvPutJson(key, Number(topicId), {}, 300000),
    cachedKvPutJson(reverseKey, String(chatId), {}, 300000),
  ]);
  return topicId;
}

export async function getGuestIdByTopic(topicId) {
  const reverseKey = `topic-guest-${topicId}`;
  return cachedKvGetJson(reverseKey, 300000, null);
}

// Guest Profiling System
export async function trackGuestProfile(message) {
  const chatId = String(message.chat.id);
  const key = `profile-${chatId}`;
  const now = Date.now();
  const current = (await kvGetJson(key, null)) || {
    firstSeen: now,
    messageCount: 0,
  };

  const fromUser = message.from || {};
  const nickname = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ').trim();

  const updated = {
    chatId,
    userId: String(fromUser.id || message.chat.id),
    firstSeen: current.firstSeen || now,
    lastSeen: now,
    messageCount: Number(current.messageCount || 0) + 1,
    name: nickname || current.name || '',
    username: fromUser.username ? `@${fromUser.username}` : (current.username || ''),
    languageCode: fromUser.language_code || current.languageCode || '',
    chatType: message.chat?.type || current.chatType || '',
    chatTitle: message.chat?.title || current.chatTitle || '',
  };

  setMemoryCache(key, updated, 300000);
  await kvPutJson(key, updated, { expirationTtl: 180 * 24 * 3600 });
  return updated;
}

export async function getGuestProfile(chatId) {
  const key = `profile-${chatId}`;
  return cachedKvGetJson(key, 300000, null);
}

// Quick Reply System
export async function listQuickReplies() {
  const cacheKey = 'quick-replies-index';
  const cached = getMemoryCache(cacheKey);
  if (cached) return cached;

  const list = asArray(await kvGetJson('quick-replies-list', []));
  setMemoryCache(cacheKey, list, 120000);
  return list;
}

export async function getQuickReply(tag) {
  const key = `quick-reply-${tag.toLowerCase()}`;
  return cachedKvGetJson(key, 300000, null);
}

export async function setQuickReply(tag, content) {
  const cleanTag = tag.toLowerCase().trim();
  const key = `quick-reply-${cleanTag}`;
  await cachedKvPutJson(key, content, {}, 300000);

  const list = await listQuickReplies();
  if (!list.includes(cleanTag)) {
    const nextList = [...list, cleanTag];
    await cachedKvPutJson('quick-replies-list', nextList, {}, 300000);
    setMemoryCache('quick-replies-index', nextList, 120000);
  }
}

export async function deleteQuickReply(tag) {
  const cleanTag = tag.toLowerCase().trim();
  const key = `quick-reply-${cleanTag}`;
  invalidateMemoryCache(key);
  await nfd.delete(key);

  const list = await listQuickReplies();
  const nextList = list.filter((t) => t !== cleanTag);
  await cachedKvPutJson('quick-replies-list', nextList, {}, 300000);
  setMemoryCache('quick-replies-index', nextList, 120000);
}

export async function fetchRemoteDb(url, ttl = FRAUD_CACHE_TTL) {
  const cacheKey = `remote-${url}`;
  const cached = getMemoryCache(cacheKey);
  if (cached) return cached;

  const kvBackupKey = `backup-${url}`;
  try {
    const text = await fetch(url).then((r) => r.text());
    const lines = text.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
    setMemoryCache(cacheKey, lines, ttl);
    // Background backup to KV for offline resilience
    await kvPutJson(kvBackupKey, lines, { expirationTtl: 7 * 24 * 3600 });
    return lines;
  } catch (e) {
    console.log(JSON.stringify({ error: 'fetch-remote-db-failed', url, message: e.message }));
    // Fallback to KV backup if network/remote fails
    const backup = await kvGetJson(kvBackupKey, null);
    if (Array.isArray(backup) && backup.length > 0) {
      setMemoryCache(cacheKey, backup, ttl);
      return backup;
    }
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
