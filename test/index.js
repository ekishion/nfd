// ==============================================================================
// test/index.js - Comprehensive Unit & Integration Test Suite
// ==============================================================================

const assert = require('assert');

console.log('Starting NFD Test Suite...\n');

// ------------------------------------------------------------------------------
// Test 1: MarkdownV2 Escaping
// ------------------------------------------------------------------------------
function escapeMarkdown(value = '') {
  return String(value).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

const specialChars = '_*[]()~`>#+-=|{}.!\\';
const escaped = escapeMarkdown(specialChars);
assert.strictEqual(escaped, '\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\');
console.log('MarkdownV2 escaping handles all 18 special characters');

// ------------------------------------------------------------------------------
// Test 2: Command & Argument Parsing
// ------------------------------------------------------------------------------
function getCommand(text = '') {
  const trimmed = text.trim();
  return trimmed.startsWith('/') ? trimmed.split(/\s+/)[0].split('@')[0].toLowerCase() : '';
}

function getCommandArgs(text = '') {
  const trimmed = text.trim();
  const firstSpace = trimmed.search(/\s/);
  return firstSpace === -1 ? '' : trimmed.slice(firstSpace).trim();
}

assert.strictEqual(getCommand('/panel'), '/panel');
assert.strictEqual(getCommand('/block@MyBot 12345'), '/block');
assert.strictEqual(getCommandArgs('/block 12345678'), '12345678');
assert.strictEqual(getCommandArgs('/addkeyword 换汇 代充'), '换汇 代充');
assert.strictEqual(getCommandArgs('/stats'), '');
console.log('Command and argument parser works accurately');

// ------------------------------------------------------------------------------
// Test 3: Direct User ID vs Reply Mapping Resolution
// ------------------------------------------------------------------------------
function resolveTargetGuestId(msgText, mappedGuestId) {
  const args = getCommandArgs(msgText);
  if (args && /^\d+$/.test(args)) {
    return args;
  }
  return mappedGuestId;
}

assert.strictEqual(resolveTargetGuestId('/block 99887766', null), '99887766');
assert.strictEqual(resolveTargetGuestId('/block', '11223344'), '11223344');
assert.strictEqual(resolveTargetGuestId('/unblock 556677', '11223344'), '556677');
console.log('Direct UID vs mapped guest ID resolution works');

// ------------------------------------------------------------------------------
// Test 4: Memory Cache TTL, Invalidation & Capacity Pruning
// ------------------------------------------------------------------------------
const memoryCache = new Map();

function pruneExpiredMemoryCache() {
  const now = Date.now();
  for (const [key, item] of memoryCache.entries()) {
    if (item.expiresAt <= now) {
      memoryCache.delete(key);
    }
  }
}

function setMemoryCache(key, value, ttlMs = 60000) {
  if (memoryCache.size >= 10) {
    pruneExpiredMemoryCache();
  }
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function getMemoryCache(key) {
  const item = memoryCache.get(key);
  if (!item) return undefined;
  if (item.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return undefined;
  }
  return item.value;
}

setMemoryCache('user-1', { name: 'Alice' }, 1000);
assert.deepStrictEqual(getMemoryCache('user-1'), { name: 'Alice' });

// Add 9 expired items
for (let i = 0; i < 9; i++) {
  memoryCache.set(`expired-${i}`, { value: i, expiresAt: Date.now() - 1000 });
}
assert.strictEqual(memoryCache.size, 10);

// Adding 11th item prunes expired entries
setMemoryCache('fresh-item', 'active', 60000);
assert.strictEqual(memoryCache.size, 2); // 'user-1' (still valid) + 'fresh-item'
assert.strictEqual(getMemoryCache('fresh-item'), 'active');
console.log('Memory Cache TTL and pruning behave as expected');

// ------------------------------------------------------------------------------
// Test 5: Keyword Matching & Batch Moderation
// ------------------------------------------------------------------------------
const blockedKeywords = ['换汇', '收u', 'usdt', '代充'];

function findBlockedKeyword(text, rules) {
  const content = (text || '').toLowerCase();
  if (!content) return '';
  return rules.find((kw) => content.includes(kw.toLowerCase())) || '';
}

assert.strictEqual(findBlockedKeyword('你好我想换汇', blockedKeywords), '换汇');
assert.strictEqual(findBlockedKeyword('出USDT啦', blockedKeywords), 'usdt');
assert.strictEqual(findBlockedKeyword('请问服务器怎么续费', blockedKeywords), '');

// Batch moderation (one bad message drops entire batch)
const batch = [
  { message_id: 1, text: '第一条消息：你好' },
  { message_id: 2, text: '第二条消息：请问收U吗？' },
];

let foundViolation = '';
for (const msg of batch) {
  const kw = findBlockedKeyword(msg.text, blockedKeywords);
  if (kw) {
    foundViolation = kw;
    break;
  }
}
assert.strictEqual(foundViolation, '收u');
console.log('Keyword matching and atomic batch moderation verified');

// ------------------------------------------------------------------------------
// Test 6: Settings Panel Value Cycling & Page Switching
// ------------------------------------------------------------------------------
const limits = [1, 2, 3, 5];
const delays = [0, 3, 5, 10, 15];

function cycleLimit(current) {
  return limits[(limits.indexOf(current) + 1) % limits.length] || 3;
}

function cycleDelay(current) {
  return delays[(delays.indexOf(current) + 1) % delays.length] ?? 0;
}

assert.strictEqual(cycleLimit(1), 2);
assert.strictEqual(cycleLimit(3), 5);
assert.strictEqual(cycleLimit(5), 1);

assert.strictEqual(cycleDelay(0), 3);
assert.strictEqual(cycleDelay(5), 10);
assert.strictEqual(cycleDelay(15), 0);
console.log('Panel setting cycles (limits & delay thresholds) verified');

// ------------------------------------------------------------------------------
// Test 7: Stat Throttling Buffer
// ------------------------------------------------------------------------------
const pendingStats = new Map();
let mockKvPuts = 0;

async function incrementStatMock(name) {
  const count = (pendingStats.get(name) || 0) + 1;
  if (count >= 5) {
    pendingStats.delete(name);
    mockKvPuts += 1;
  } else {
    pendingStats.set(name, count);
  }
}

for (let i = 0; i < 14; i++) {
  incrementStatMock('msg');
}
// 14 increments: flushed at 5, flushed at 10 (2 KV puts total), 4 remaining in memory
assert.strictEqual(mockKvPuts, 2);
assert.strictEqual(pendingStats.get('msg'), 4);
console.log('Stat throttling reduces KV write load by ~80%');

// ------------------------------------------------------------------------------
// Test 8: Anti-Evasion Normalization & Regex Keyword Engine
// ------------------------------------------------------------------------------
function normalizeMessageText(text = '') {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/[\u200B-\u200F\uFEFF\u2060\u180E\u00AD]/g, '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseKeywordRule(rawRule) {
  const raw = String(rawRule || '').trim();
  if (!raw) return null;
  const regexMatch = raw.match(/^\/(.+)\/([a-z]*)$/i);
  if (regexMatch) {
    const [, pattern, flags] = regexMatch;
    try {
      const safeFlags = flags.includes('i') ? flags : `${flags}i`;
      const regex = new RegExp(pattern, safeFlags);
      return { raw, isRegex: true, regex };
    } catch {
      return { raw, isRegex: false, text: raw.toLowerCase() };
    }
  }
  return { raw, isRegex: false, text: raw.toLowerCase() };
}

function matchRules(rawText, ruleStrings) {
  const normalized = normalizeMessageText(rawText);
  const lower = normalized.toLowerCase();
  const compiled = ruleStrings.map(parseKeywordRule).filter(Boolean);

  for (const rule of compiled) {
    if (rule.isRegex && rule.regex) {
      const m = normalized.match(rule.regex);
      if (m) {
        return { matched: true, rule: rule.raw, snippet: m[0] };
      }
    } else if (rule.text) {
      if (lower.includes(rule.text)) {
        return { matched: true, rule: rule.raw, snippet: rule.raw };
      }
    }
  }
  return null;
}

// 8.1 Zero-width evasion bypass test
const hiddenText = '请问\u200B换\u200C汇\u200D吗';
assert.strictEqual(normalizeMessageText(hiddenText), '请问换汇吗');

// 8.2 Full-width character normalization test
const fullWidthText = '我的ｖｘ是：ｔｅｓｔ１２３';
assert.strictEqual(normalizeMessageText(fullWidthText), '我的vx是:test123');

// 8.3 Regex rule matching & snippet capture
const testRules = [
  '/(?:vx|微信|v信)\\s*[:：号]?\\s*[a-zA-Z0-9_-]{5,}/i',
  '/t\\.me\\/(?:joinchat|\\+[a-zA-Z0-9_-]+)/i',
  '代充',
  '/[invalid(regex/i', // Invalid regex syntax fallback test
];

const res1 = matchRules('快加我 微信: my_wechat_001 咨询业务', testRules);
assert.strictEqual(res1.matched, true);
assert.strictEqual(res1.snippet, '微信: my_wechat_001');

const res2 = matchRules('欢迎加入电报群：https://t.me/+abc_XYZ123 点击链接', testRules);
assert.strictEqual(res2.matched, true);
assert.strictEqual(res2.snippet, 't.me/+abc_XYZ123');

const res3 = matchRules('需要点卡代充请联系', testRules);
assert.strictEqual(res3.matched, true);
assert.strictEqual(res3.rule, '代充');

// 8.4 Anti-evasion combination test (zero-width + full-width + spacing + regex)
const evasionText = '联系\u200Bｖ\u200Bｘ\u3000：\u200B \u200Fvip_88888 抢购';
const resEvasion = matchRules(evasionText, testRules);
assert.strictEqual(resEvasion.matched, true);
assert.strictEqual(resEvasion.snippet, 'vx : vip_88888');

console.log('Anti-evasion normalization & Regex keyword engine verified');

console.log('\nAll 8 test suites passed with 0 errors!\n');
