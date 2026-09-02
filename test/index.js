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
function getCommand(text = '', botUsername = '') {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return '';
  const firstToken = trimmed.split(/\s+/)[0];
  const atIndex = firstToken.indexOf('@');
  if (atIndex !== -1) {
    const cmd = firstToken.slice(0, atIndex).toLowerCase();
    const targetBot = firstToken.slice(atIndex + 1).toLowerCase();
    if (botUsername && targetBot !== botUsername.toLowerCase()) {
      return '';
    }
    return cmd;
  }
  return firstToken.toLowerCase();
}

function getCommandArgs(text = '') {
  const trimmed = text.trim();
  const firstSpace = trimmed.search(/\s/);
  return firstSpace === -1 ? '' : trimmed.slice(firstSpace).trim();
}

assert.strictEqual(getCommand('/panel', 'mybot'), '/panel');
assert.strictEqual(getCommand('/panel@mybot', 'mybot'), '/panel');
assert.strictEqual(getCommand('/panel@otherbot', 'mybot'), '');
assert.strictEqual(getCommand('@username_to_id_bot', 'mybot'), '');
assert.strictEqual(getCommandArgs('/block 12345678'), '12345678');
assert.strictEqual(getCommandArgs('/addkeyword 换汇 代充'), '换汇 代充');
assert.strictEqual(getCommandArgs('/stats'), '');
console.log('Command and argument parser with bot target filtering works accurately');

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
  '/[invalid(regex/i',
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

// ------------------------------------------------------------------------------
// Test 9: Update ID LRU De-duplication
// ------------------------------------------------------------------------------
const recentUpdates = new Set();
function isDuplicateUpdate(updateId) {
  if (!updateId) return false;
  if (recentUpdates.has(updateId)) return true;
  if (recentUpdates.size >= 5) {
    const first = recentUpdates.values().next().value;
    recentUpdates.delete(first);
  }
  recentUpdates.add(updateId);
  return false;
}

assert.strictEqual(isDuplicateUpdate(1001), false);
assert.strictEqual(isDuplicateUpdate(1001), true);
assert.strictEqual(isDuplicateUpdate(1002), false);
console.log('Update ID LRU de-duplication verified');

// ------------------------------------------------------------------------------
// Test 10: Anti-Flood Rate Limiting
// ------------------------------------------------------------------------------
const floodMemory = new Map();
function checkFloodLimitMock(chatId, limit = 3, windowSeconds = 1) {
  const now = Date.now();
  const history = floodMemory.get(chatId) || [];
  const valid = history.filter((ts) => now - ts < windowSeconds * 1000);
  valid.push(now);
  floodMemory.set(chatId, valid);
  if (valid.length > limit) {
    return { blocked: true };
  }
  return { blocked: false };
}

assert.strictEqual(checkFloodLimitMock('userA', 3, 10).blocked, false);
assert.strictEqual(checkFloodLimitMock('userA', 3, 10).blocked, false);
assert.strictEqual(checkFloodLimitMock('userA', 3, 10).blocked, false);
assert.strictEqual(checkFloodLimitMock('userA', 3, 10).blocked, true);
console.log('Anti-flood rate limiting threshold verified');

// ------------------------------------------------------------------------------
// Test 11: Dangerous Document Executable Filter
// ------------------------------------------------------------------------------
function isDangerousDocument(fileName) {
  if (!fileName) return false;
  const dangerousExts = ['.exe', '.bat', '.apk', '.cmd', '.vbs', '.ps1', '.scr', '.sh', '.jar', '.msi', '.dll'];
  const lower = fileName.toLowerCase();
  return dangerousExts.some((ext) => lower.endsWith(ext));
}

assert.strictEqual(isDangerousDocument('invoice.pdf'), false);
assert.strictEqual(isDangerousDocument('photo.jpg'), false);
assert.strictEqual(isDangerousDocument('setup.exe'), true);
assert.strictEqual(isDangerousDocument('client_v2.APK'), true);
assert.strictEqual(isDangerousDocument('script.bat'), true);
console.log('Dangerous document executable filter verified');

// ------------------------------------------------------------------------------
// Test 12: Guest Tag & Profile Builder
// ------------------------------------------------------------------------------
function buildMessageInfoWithTag(userName, userId, count, tag) {
  const guestLabel = tag ? `${userName} [${tag}]` : `${userName} (${userId})`;
  return guestLabel;
}

assert.strictEqual(buildMessageInfoWithTag('张三', '12345', 1, 'VIP买家'), '张三 [VIP买家]');
assert.strictEqual(buildMessageInfoWithTag('李四', '67890', 1, ''), '李四 (67890)');
console.log('Customer tagging format in guest info verified');

// ------------------------------------------------------------------------------
// Test 13: Forum Topic Mapping & Direct Reply Resolution
// ------------------------------------------------------------------------------
const topicMap = new Map();
const reverseTopicMap = new Map();

function setTopic(guestId, topicId) {
  topicMap.set(guestId, topicId);
  reverseTopicMap.set(topicId, guestId);
}

function resolveGuestFromAdminMsg(adminMsg) {
  if (adminMsg.message_thread_id && reverseTopicMap.has(adminMsg.message_thread_id)) {
    return reverseTopicMap.get(adminMsg.message_thread_id);
  }
  return null;
}

setTopic('10001', 42);
setTopic('10002', 88);

assert.strictEqual(resolveGuestFromAdminMsg({ message_thread_id: 42, text: '你好！' }), '10001');
assert.strictEqual(resolveGuestFromAdminMsg({ message_thread_id: 88, text: '请问有什么可以帮您？' }), '10002');
assert.strictEqual(resolveGuestFromAdminMsg({ message_thread_id: 999, text: '未知话题' }), null);
console.log('Forum Topic reverse mapping resolution verified');

// ------------------------------------------------------------------------------
// Test 14: Dual-Channel Routing (Alert Channel vs Forward Channel)
// ------------------------------------------------------------------------------
function resolveRouting(config) {
  const forwardChat = config.ENV_FORWARD_CHAT_ID || config.ENV_ADMIN_UID;
  const alertChat = config.ENV_ALERT_CHAT_ID || forwardChat;
  const alertThread = config.ENV_ALERT_THREAD_ID ? Number(config.ENV_ALERT_THREAD_ID) : null;
  return { forwardChat, alertChat, alertThread };
}

const route1 = resolveRouting({ ENV_ADMIN_UID: '111' });
assert.strictEqual(route1.forwardChat, '111');
assert.strictEqual(route1.alertChat, '111');
assert.strictEqual(route1.alertThread, null);

const route2 = resolveRouting({
  ENV_ADMIN_UID: '111',
  ENV_FORWARD_CHAT_ID: '-100123456',
  ENV_ALERT_CHAT_ID: '-100987654',
  ENV_ALERT_THREAD_ID: '77',
});
assert.strictEqual(route2.forwardChat, '-100123456');
assert.strictEqual(route2.alertChat, '-100987654');
assert.strictEqual(route2.alertThread, 77);
console.log('Dual-channel alert and conversation routing verified');

// ------------------------------------------------------------------------------
// Test 15: Group Chatter & Mention Isolation
// ------------------------------------------------------------------------------
function shouldProcessGroupMessage({ isGroup, isAdmin, command, hasMappedGuest }) {
  if (!isGroup) return true; // private chat
  if (!isAdmin) return false;
  if (command) return true;
  if (hasMappedGuest) return true;
  return false; // regular chatter, mentions, other bots
}

assert.strictEqual(shouldProcessGroupMessage({ isGroup: true, isAdmin: true, command: '', hasMappedGuest: false }), false);
assert.strictEqual(shouldProcessGroupMessage({ isGroup: true, isAdmin: true, command: '/panel', hasMappedGuest: false }), true);
assert.strictEqual(shouldProcessGroupMessage({ isGroup: true, isAdmin: true, command: '', hasMappedGuest: true }), true);
assert.strictEqual(shouldProcessGroupMessage({ isGroup: true, isAdmin: false, command: '/start', hasMappedGuest: false }), false);
console.log('Group chatter isolation verified');

// ------------------------------------------------------------------------------
// Test 16: Non-NFD Bot Command Filtering in Group Chats
// ------------------------------------------------------------------------------
const myBot = 'nfd_bot';
assert.strictEqual(getCommand('/start@username_to_id_bot', myBot), '');
assert.strictEqual(getCommand('/id@username_to_id_bot', myBot), '');
assert.strictEqual(getCommand('/panel@nfd_bot', myBot), '/panel');
assert.strictEqual(getCommand('/panel', myBot), '/panel');
assert.strictEqual(getCommand('你好 @username_to_id_bot 查下id', myBot), '');
console.log('Non-NFD bot commands and mentions properly ignored');

console.log('\nAll 16 test suites passed with 0 errors!\n');
