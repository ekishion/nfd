// ==============================================================================
// src/moderation.js - Moderation Engine (Blacklist, Username, Avatar & Keywords)
// ==============================================================================

import { getAdminUid, getKeywordViolationTtl, asArray } from './config.js';
import {
  cachedKvGetJson,
  cachedKvPutJson,
  getMemoryCache,
  setMemoryCache,
  kvGetJson,
  kvPutJson,
  incrementStat,
  fetchKeywordDb,
} from './cache.js';
import { requestTelegram, getMessageText, sendMarkdown, mdLine, buildUserName } from './telegram.js';

export async function isUserBlocked(chatId) {
  return cachedKvGetJson(`isblocked-${chatId}`, 60000, false);
}

export async function setUserBlocked(chatId, blocked) {
  return cachedKvPutJson(`isblocked-${chatId}`, blocked, {}, 60000);
}

export async function checkUserHasPhoto(userId) {
  const numericId = Number(userId);
  if (!numericId || Number.isNaN(numericId) || numericId <= 0) return true;

  const key = `has-photo-${numericId}`;
  const cached = getMemoryCache(key);
  if (typeof cached === 'boolean') return cached;

  const kvVal = await kvGetJson(key, null);
  if (typeof kvVal === 'boolean') {
    setMemoryCache(key, kvVal, kvVal ? 3600000 : 300000);
    return kvVal;
  }

  try {
    const res = await requestTelegram('getUserProfilePhotos', { user_id: numericId, limit: 1 });
    if (!res.ok) return true; // fail open on error
    const hasPhoto = Boolean(res.result && Number(res.result.total_count) > 0);
    const ttl = hasPhoto ? 3600 : 300;
    setMemoryCache(key, hasPhoto, ttl * 1000);
    await kvPutJson(key, hasPhoto, { expirationTtl: ttl });
    return hasPhoto;
  } catch (e) {
    console.log(JSON.stringify({ error: 'checkUserHasPhoto-failed', userId, message: e.message }));
    return true;
  }
}

export async function getKeywordRules() {
  const cacheKey = 'merged-keywords';
  const cached = getMemoryCache(cacheKey);
  if (cached) return cached;

  const fromKv = await cachedKvGetJson('blocked-keywords', 120000, []);
  const fromDb = await fetchKeywordDb();
  const rules = Array.from(new Set([...fromDb, ...asArray(fromKv)]));
  setMemoryCache(cacheKey, rules, 60000);
  return rules;
}

export async function findBlockedKeyword(message) {
  const content = getMessageText(message).toLowerCase();
  if (!content) return '';

  const rules = await getKeywordRules();
  return rules.find((keyword) => content.includes(keyword.toLowerCase())) || '';
}

export async function recordKeywordViolation(message, keyword) {
  const chatId = String(message.chat.id);
  const key = `keyword-violation-${chatId}`;
  const current = await kvGetJson(key, { count: 0, expiresAt: 0 });
  const now = Date.now();
  const count = current.expiresAt > now ? Number(current.count || 0) + 1 : 1;
  const ttl = getKeywordViolationTtl();
  const record = {
    count,
    lastKeyword: keyword,
    updatedAt: now,
    expiresAt: now + ttl * 1000,
  };
  await kvPutJson(key, record, { expirationTtl: ttl });
  return record;
}

export async function notifyKeywordBlocked(message, keyword, violation, config) {
  await incrementStat('keyword-blocked');
  if (!config.notice_admin) return null;
  const adminUid = getAdminUid();
  if (!adminUid) return null;

  const lines = [
    '*人偶拦下了一条留言*',
    mdLine('关键词', keyword),
    mdLine('累计次数', violation.count),
    mdLine('用户ID', message.chat.id),
    mdLine('客人', buildUserName(message.from || {})),
  ];
  if (config.auto_block && violation.count >= config.violation_limit) {
    lines.push(mdLine('处理', '已自动拉入黑名单'));
  }
  return sendMarkdown(adminUid, lines.join('\n'));
}
