// ==============================================================================
// src/cache.js - Memory TTL Cache, KV Wrapper & Remote DB Management
// ==============================================================================

import {
  FRAUD_CACHE_TTL,
  getKeywordDbUrl,
  getDefaultEnvConfig,
  getForwardChatId,
  getForwardThreadId,
  getAlertChatId,
  getAlertThreadId,
  getEnableForumTopics,
  asArray,
} from './config.js';
import { getMemoryCache, setMemoryCache, invalidateMemoryCache } from './memory-cache.js';
import { utcDateKey } from './format.js';
import { sendPlainText, requestTelegram } from './telegram.js';

const pendingStats = new Map();

export function getKv() {
  return typeof nfd !== 'undefined' ? nfd : null;
}

export async function kvGetText(key, fallback = '') {
  const kv = getKv();
  if (!kv) return fallback;
  try {
    const val = await kv.get(key);
    return val !== null && val !== undefined ? val : fallback;
  } catch (err) {
    console.log(JSON.stringify({ error: 'kvGetText-failed', key, message: err.message }));
    return fallback;
  }
}

export async function kvList(prefix, limit = 100) {
  const kv = getKv();
  if (!kv || typeof kv.list !== 'function') return [];
  try {
    const res = await kv.list({ prefix, limit });
    return asArray(res?.keys);
  } catch (err) {
    console.log(JSON.stringify({ error: 'kvList-failed', prefix, message: err.message }));
    return [];
  }
}

export async function kvPutText(key, value, options = {}) {
  const kv = getKv();
  if (!kv) return;
  try {
    await kv.put(key, String(value), options);
  } catch (err) {
    console.log(JSON.stringify({ error: 'kvPutText-failed', key, message: err.message }));
  }
}

export async function kvDelete(key) {
  const kv = getKv();
  if (!kv) return;
  try {
    await kv.delete(key);
  } catch (err) {
    console.log(JSON.stringify({ error: 'kvDelete-failed', key, message: err.message }));
  }
}

export async function kvGetJson(key, fallback = null) {
  const kv = getKv();
  if (!kv) return fallback;
  try {
    const value = await kv.get(key, { type: 'json' });
    return value === null || value === undefined ? fallback : value;
  } catch (err) {
    console.log(JSON.stringify({ error: 'kvGetJson-failed', key, message: err.message }));
    return fallback;
  }
}

export async function kvPutJson(key, value, options = {}) {
  const kv = getKv();
  if (!kv) return;
  try {
    return await kv.put(key, JSON.stringify(value), options);
  } catch (err) {
    console.log(JSON.stringify({ error: 'kvPutJson-failed', key, message: err.message }));
  }
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
  const envDefaults = getDefaultEnvConfig();
  const merged = {
    ...envDefaults,
    ...(kvCfg && typeof kvCfg === 'object' ? kvCfg : {}),
    // 路由目标与话题模式始终以最新环境变量为准，防止历史 KV 记录锁定旧的私聊 UID
    forward_chat_id: getForwardChatId(),
    forward_thread_id: getForwardThreadId(),
    alert_chat_id: getAlertChatId(),
    alert_thread_id: getAlertThreadId(),
    enable_forum_topics: getEnableForumTopics(),
  };
  setMemoryCache('runtime-config', merged, 60000);
  return merged;
}

export async function updateRuntimeConfig(patch) {
  const currentKv = await kvGetJson('runtime-settings', {});
  const nextKv = { ...(currentKv && typeof currentKv === 'object' ? currentKv : {}), ...patch };
  // 剥离静态路由字段，防止持久化到 KV 中
  delete nextKv.forward_chat_id;
  delete nextKv.forward_thread_id;
  delete nextKv.alert_chat_id;
  delete nextKv.alert_thread_id;
  delete nextKv.enable_forum_topics;

  await kvPutJson('runtime-settings', nextKv);
  invalidateMemoryCache('runtime-config');
  return getRuntimeConfig();
}

// 统计按 UTC 日期分 key（48h 过期自动回收），/stats 与面板展示真正的「今日」数据
export async function incrementStat(name) {
  const dateKey = utcDateKey();
  const mapKey = `${name}@${dateKey}`;
  const count = (pendingStats.get(mapKey) || 0) + 1;
  if (count >= 5) {
    pendingStats.delete(mapKey);
    const key = `stat-${name}-${dateKey}`;
    const current = Number((await kvGetText(key, '0')) || 0);
    await kvPutText(key, String(current + count), { expirationTtl: 2 * 24 * 3600 });
  } else {
    pendingStats.set(mapKey, count);
  }
}

export async function getStatCount(name, dateKey = utcDateKey()) {
  const key = `stat-${name}-${dateKey}`;
  const fromKv = Number((await kvGetText(key, '0')) || 0);
  const fromMem = Number(pendingStats.get(`${name}@${dateKey}`) || 0);
  return fromKv + fromMem;
}

export async function checkCooldown(key, cooldownMs) {
  const now = Date.now();
  const mem = getMemoryCache(`cd-${key}`);
  if (mem && now - mem < cooldownMs) return false;

  const lastSentAt = Number((await kvGetText(key, '0')) || 0);
  if (lastSentAt && now - lastSentAt < cooldownMs) {
    setMemoryCache(`cd-${key}`, lastSentAt, cooldownMs);
    return false;
  }

  setMemoryCache(`cd-${key}`, now, cooldownMs);
  await kvPutText(key, String(now));
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
    await kvDelete(key);
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

// Guest Profiling System（profileFlushAt 为落盘节流状态，见 trackGuestProfile）
const profileFlushAt = new Map();
const PROFILE_FLUSH_INTERVAL_MS = 5 * 60 * 1000;

export async function trackGuestProfile(message, identityKey = null, extraProfile = {}) {
  const chatId = identityKey || String(message.chat.id);
  const key = `profile-${chatId}`;
  const now = Date.now();
  // 优先读内存缓存：两次落盘之间的累计都在这里，KV 里的值要到落盘那一刻才是新的
  const existing = getMemoryCache(key) ?? await kvGetJson(key, null);
  const current = existing || {
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
    bio: extraProfile?.bio !== undefined ? extraProfile.bio : (current.bio || ''),
    languageCode: fromUser.language_code || current.languageCode || '',
    chatType: message.chat?.type || current.chatType || '',
    chatTitle: message.chat?.title || current.chatTitle || '',
  };

  setMemoryCache(key, updated, 300000);
  // 每条留言都落盘会很快耗尽 KV 写入配额，改为建档首条 + 每 10 条 + 距上次落盘 ≥5 分钟才写
  const lastFlushAt = profileFlushAt.get(key) || 0;
  if (!existing || updated.messageCount % 10 === 0 || now - lastFlushAt >= PROFILE_FLUSH_INTERVAL_MS) {
    if (profileFlushAt.size >= 1000) profileFlushAt.clear();
    profileFlushAt.set(key, now);
    await kvPutJson(key, updated, { expirationTtl: 180 * 24 * 3600 });
  }
  return updated;
}

export async function getGuestProfile(chatId) {
  const key = `profile-${chatId}`;
  return cachedKvGetJson(key, 300000, null);
}

// Quick Reply System
export async function listQuickReplies() {
  return cachedKvGetJson('quick-replies-list', 120000, []);
}

export async function getQuickReply(tag) {
  const key = `quick-reply-${tag.toLowerCase()}`;
  return cachedKvGetJson(key, 300000, null);
}

export async function setQuickReply(tag, content) {
  const cleanTag = tag.toLowerCase().trim();
  const key = `quick-reply-${cleanTag}`;
  await cachedKvPutJson(key, content, {}, 300000);

  const list = asArray(await listQuickReplies());
  if (!list.includes(cleanTag)) {
    await cachedKvPutJson('quick-replies-list', [...list, cleanTag], {}, 120000);
  }
}

export async function deleteQuickReply(tag) {
  const cleanTag = tag.toLowerCase().trim();
  const key = `quick-reply-${cleanTag}`;
  invalidateMemoryCache(key);
  await kvDelete(key);

  const list = asArray(await listQuickReplies());
  await cachedKvPutJson('quick-replies-list', list.filter((t) => t !== cleanTag), {}, 120000);
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

export async function fetchKeywordDb() {
  return fetchRemoteDb(getKeywordDbUrl());
}

export async function syncRemoteKeywordRules() {
  const remote = await fetchKeywordDb();
  if (!remote || !remote.length) return null;
  const current = asArray(await cachedKvGetJson('keyword-rules', 120000, []));
  const merged = Array.from(new Set([...current, ...remote]));
  await cachedKvPutJson('keyword-rules', merged, {}, 3600000);
  invalidateMemoryCache('merged-keyword-rules');
  return merged.length;
}

export async function getBotUsername() {
  const cacheKey = 'bot-username';
  const cached = getMemoryCache(cacheKey);
  if (cached) return cached;
  try {
    const data = await requestTelegram('getMe');
    if (data.ok && data.result?.username) {
      setMemoryCache(cacheKey, data.result.username, 86400000);
      return data.result.username;
    }
  } catch (err) {
    console.log(JSON.stringify({ error: 'getMe-failed', message: err.message }));
  }
  return '';
}
