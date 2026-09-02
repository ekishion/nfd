// ==============================================================================
// src/moderation.js - Moderation Engine (Blacklist, Username, Avatar & Regex Keywords)
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

export function normalizeMessageText(text = '') {
  if (!text || typeof text !== 'string') return '';
  return text
    // Strip zero-width, invisible & direction marks
    .replace(/[\u200B-\u200F\uFEFF\u2060\u180E\u00AD]/g, '')
    // Convert full-width ASCII to standard half-width
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    // Convert full-width space to standard space
    .replace(/\u3000/g, ' ')
    // Normalize multi-whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseKeywordRule(rawRule) {
  const raw = String(rawRule || '').trim();
  if (!raw) return null;

  const regexMatch = raw.match(/^\/(.+)\/([a-z]*)$/i);
  if (regexMatch) {
    const [, pattern, flags] = regexMatch;
    try {
      const safeFlags = flags.includes('i') ? flags : `${flags}i`;
      const regex = new RegExp(pattern, safeFlags);
      return {
        raw,
        isRegex: true,
        regex,
      };
    } catch (err) {
      console.log(JSON.stringify({ error: 'invalid-regex-rule', raw, message: err.message }));
      return {
        raw,
        isRegex: false,
        text: raw.toLowerCase(),
      };
    }
  }

  return {
    raw,
    isRegex: false,
    text: raw.toLowerCase(),
  };
}

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
  const cacheKey = 'merged-keyword-rules';
  const cached = getMemoryCache(cacheKey);
  if (cached) return cached;

  const fromKv = await cachedKvGetJson('blocked-keywords', 120000, []);
  const fromDb = await fetchKeywordDb();
  const rawList = Array.from(new Set([...fromDb, ...asArray(fromKv)]));

  const parsedRules = rawList.map(parseKeywordRule).filter(Boolean);
  setMemoryCache(cacheKey, parsedRules, 60000);
  return parsedRules;
}

export async function findBlockedKeyword(message) {
  const rawContent = getMessageText(message);
  if (!rawContent) return null;

  const normalized = normalizeMessageText(rawContent);
  const lowerNormalized = normalized.toLowerCase();
  const rules = await getKeywordRules();

  for (const rule of rules) {
    if (rule.isRegex && rule.regex) {
      const match = normalized.match(rule.regex);
      if (match) {
        return {
          matched: true,
          rule: rule.raw,
          snippet: match[0],
        };
      }
    } else if (rule.text) {
      if (lowerNormalized.includes(rule.text)) {
        return {
          matched: true,
          rule: rule.raw,
          snippet: rule.raw,
        };
      }
    }
  }

  return null;
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

export async function notifyKeywordBlocked(message, matchResult, violation, config) {
  await incrementStat('keyword-blocked');
  if (!config.notice_admin) return null;
  const adminUid = getAdminUid();
  if (!adminUid) return null;

  const ruleName = typeof matchResult === 'string' ? matchResult : matchResult.rule;
  const snippet = typeof matchResult === 'object' && matchResult?.snippet ? matchResult.snippet : '';

  const lines = [
    '*人偶拦下了一条留言*',
    mdLine('触发规则', ruleName),
  ];

  if (snippet && snippet !== ruleName) {
    lines.push(mdLine('命中切片', snippet));
  }

  lines.push(
    mdLine('累计次数', violation.count),
    mdLine('用户ID', message.chat.id),
    mdLine('客人', buildUserName(message.from || {})),
  );

  if (config.auto_block && violation.count >= config.violation_limit) {
    lines.push(mdLine('处理', '已自动拉入黑名单'));
  }
  return sendMarkdown(adminUid, lines.join('\n'));
}
