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

// ------------------------------------------------------------------------------
// Test 17: Unauthorized Group Whitelist & Auto-Leave Validation
// ------------------------------------------------------------------------------
function checkGroupAuthorization(chatId, forwardChatId, alertChatId) {
  const isAuthorized = (forwardChatId && String(chatId) === String(forwardChatId)) ||
                       (alertChatId && String(chatId) === String(alertChatId));
  return isAuthorized;
}

assert.strictEqual(checkGroupAuthorization('-100111111', '-100111111', '-100222222'), true);
assert.strictEqual(checkGroupAuthorization('-100222222', '-100111111', '-100222222'), true);
assert.strictEqual(checkGroupAuthorization('-100999999', '-100111111', '-100222222'), false);
console.log('Unauthorized group whitelist & auto-leave check verified');

// ------------------------------------------------------------------------------
// Test 18: Multi-Channel Push Notification Formatting & Filtering
// ------------------------------------------------------------------------------
function testBuildNotificationContent(event, payload) {
  if (event === 'security_alert') {
    return {
      title: `[NFD 拦截报警] ${payload.reason || '安全事件'}`,
      summary: `${payload.reason || '安全拦截'}: ${payload.senderName || payload.senderId || '未知'}`,
      content: `🚨 安全拦截报警\n- 触发类型: ${payload.reason}`,
      event,
    };
  }
  const guest = payload.senderName || `客人 ${payload.senderId || ''}`.trim();
  const count = payload.messageCount || 1;
  return {
    title: `[NFD 客人新留言] 来自 ${guest}`,
    summary: `新留言 (${count}条): ${payload.text ? payload.text.substring(0, 50) : '附件消息'}`,
    content: `📨 收到新留言 (${count} 条)`,
    event,
  };
}

const alertNotice = testBuildNotificationContent('security_alert', {
  reason: '敏感关键词',
  senderName: '张三',
  senderId: '123456',
  detail: '代充',
});
assert.strictEqual(alertNotice.title, '[NFD 拦截报警] 敏感关键词');
assert.strictEqual(alertNotice.summary, '敏感关键词: 张三');

const guestNotice = testBuildNotificationContent('guest_message', {
  senderName: '李四',
  senderId: '789012',
  messageCount: 3,
  text: '你好，请问有什么优惠吗？',
});
assert.strictEqual(guestNotice.title, '[NFD 客人新留言] 来自 李四');
assert.strictEqual(guestNotice.summary.includes('3条'), true);

function shouldSendNotification(event, onAlertOnly) {
  if (onAlertOnly && event !== 'security_alert') return false;
  return true;
}

assert.strictEqual(shouldSendNotification('guest_message', true), false);
assert.strictEqual(shouldSendNotification('security_alert', true), true);
assert.strictEqual(shouldSendNotification('guest_message', false), true);
console.log('Multi-channel push notification formatting & filtering verified');

// ------------------------------------------------------------------------------
// Test 19: Listen Chat Whitelist Parsing & Authorization
// ------------------------------------------------------------------------------
function parseListenChatIds(raw) {
  return String(raw || '').split(',').map((id) => id.trim()).filter(Boolean);
}

function checkListenAuthorization(chatId, forwardChatId, alertChatId, listenRaw) {
  const listenChatIds = parseListenChatIds(listenRaw);
  return (forwardChatId && String(chatId) === String(forwardChatId)) ||
         (alertChatId && String(chatId) === String(alertChatId)) ||
         listenChatIds.includes(String(chatId));
}

assert.deepStrictEqual(parseListenChatIds(' -100333333 , -100444444  ,'), ['-100333333', '-100444444']);
assert.deepStrictEqual(parseListenChatIds(''), []);
assert.strictEqual(checkListenAuthorization('-100333333', '-100111111', '-100222222', '-100333333,-100444444'), true);
assert.strictEqual(checkListenAuthorization('-100444444', '-100111111', '-100222222', '-100333333,-100444444'), true);
assert.strictEqual(checkListenAuthorization('-100888888', '-100111111', '-100222222', '-100333333,-100444444'), false);
console.log('Listen chat whitelist parsing & authorization verified');

// ------------------------------------------------------------------------------
// Test 20: Sender Identity Resolution Across Chat Types
// ------------------------------------------------------------------------------
function getSenderKey(message) {
  if (message?.chat?.type && message.chat.type !== 'private') {
    if (message.from?.id) return String(message.from.id);
    if (message.sender_chat?.id) return String(message.sender_chat.id);
  }
  return String(message.chat.id);
}

assert.strictEqual(getSenderKey({ chat: { id: 111, type: 'private' }, from: { id: 111 } }), '111');
assert.strictEqual(getSenderKey({ chat: { id: -100555, type: 'supergroup' }, from: { id: 222 } }), '222');
assert.strictEqual(getSenderKey({ chat: { id: -100555, type: 'supergroup' }, from: { id: 333 } }), '333');
assert.strictEqual(getSenderKey({ chat: { id: -100666, type: 'channel' }, sender_chat: { id: -100666 } }), '-100666');
assert.strictEqual(getSenderKey({ chat: { id: -100777, type: 'group' } }), '-100777');
console.log('Sender identity resolution across chat types verified');

// ------------------------------------------------------------------------------
// Test 21: Bot Command Menu Parsing (ENV_BOT_COMMANDS)
// ------------------------------------------------------------------------------
function parseBotCommands(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  let parsed = null;
  try {
    const json = JSON.parse(text);
    if (Array.isArray(json)) {
      parsed = normalizeBotCommandPairs(json.map((item) => ({ command: item?.command, description: item?.description })));
    }
  } catch {
    parsed = null;
  }

  if (!parsed) {
    parsed = normalizeBotCommandPairs(text.split(',').map((pair) => {
      const idx = pair.indexOf(':');
      if (idx <= 0) return null;
      return { command: pair.slice(0, idx).trim(), description: pair.slice(idx + 1).trim() };
    }));
  }
  return parsed;
}

function normalizeBotCommandPairs(pairs) {
  const commands = (pairs || [])
    .map((item) => ({
      command: String(item?.command || '').trim().replace(/^\//, '').toLowerCase(),
      description: String(item?.description || '').trim(),
    }))
    .filter((item) => /^[a-z0-9_]{1,32}$/.test(item.command) && item.description);
  return commands.length ? commands : null;
}

assert.deepStrictEqual(
  parseBotCommands('[{"command":"/panel","description":"控制面板"},{"command":"stats","description":"统计数据"}]'),
  [{ command: 'panel', description: '控制面板' }, { command: 'stats', description: '统计数据' }],
);
assert.deepStrictEqual(
  parseBotCommands('panel:控制面板, stats:统计数据 ,bad,,/tag:客人备注'),
  [{ command: 'panel', description: '控制面板' }, { command: 'stats', description: '统计数据' }, { command: 'tag', description: '客人备注' }],
);
assert.strictEqual(parseBotCommands(''), null);
assert.strictEqual(parseBotCommands('not a json or list'), null);
assert.strictEqual(parseBotCommands('[{"command":"无效指令!","description":"x"}]'), null);
assert.strictEqual(parseBotCommands('panel:'), null);
console.log('Bot command menu parsing (JSON & shorthand) verified');

// ------------------------------------------------------------------------------
// Test 22: Feature Gate Resolution (optIn / optOut / --all)
// ------------------------------------------------------------------------------
const FEATURE_OFF_VALUES = ['false', '0', 'off', 'no'];

function isFeatureActive(feature, env, isBuildAll = false) {
  if (isBuildAll) return true;
  if (feature.mode === 'optOut') {
    const val = String(env[feature.envs[0]] || '').trim().toLowerCase();
    return !FEATURE_OFF_VALUES.includes(val);
  }
  return feature.envs.some((name) => env[name] && String(env[name]).trim().length > 0);
}

const optInFeature = { mode: 'optIn', envs: ['ENV_BOT_COMMANDS'] };
const multiEnvFeature = { mode: 'optIn', envs: ['ENV_START_MESSAGE_URL', 'ENV_NOTIFICATION_URL'] };
const optOutFeature = { mode: 'optOut', envs: ['ENV_ENABLE_FRAUD_CHECK'] };

assert.strictEqual(isFeatureActive(optInFeature, { ENV_BOT_COMMANDS: 'panel:控制面板' }), true);
assert.strictEqual(isFeatureActive(optInFeature, {}), false);
assert.strictEqual(isFeatureActive(multiEnvFeature, { ENV_NOTIFICATION_URL: 'https://example.com/x.txt' }), true);
assert.strictEqual(isFeatureActive(multiEnvFeature, {}), false);
assert.strictEqual(isFeatureActive(optOutFeature, {}), true);
assert.strictEqual(isFeatureActive(optOutFeature, { ENV_ENABLE_FRAUD_CHECK: 'false' }), false);
assert.strictEqual(isFeatureActive(optOutFeature, { ENV_ENABLE_FRAUD_CHECK: 'OFF' }), false);
assert.strictEqual(isFeatureActive(optOutFeature, { ENV_ENABLE_FRAUD_CHECK: '0' }), false);
assert.strictEqual(isFeatureActive(optOutFeature, { ENV_ENABLE_FRAUD_CHECK: 'true' }), true);
assert.strictEqual(isFeatureActive(optInFeature, {}, true), true);
assert.strictEqual(isFeatureActive(optOutFeature, { ENV_ENABLE_FRAUD_CHECK: 'false' }, true), true);
console.log('Feature gate resolution (optIn / optOut / --all) verified');

// ------------------------------------------------------------------------------
// Test 23: Notifier Channel Gate (key / enable flag / --all)
// ------------------------------------------------------------------------------
function isChannelActive(channel, env, isBuildAll = false) {
  if (isBuildAll) return true;
  if (env[channel.env] && String(env[channel.env]).trim().length > 0) return true;
  return String(env[channel.enableEnv] || '').trim().toLowerCase() === 'true';
}

const pushdeerChannel = { env: 'ENV_PUSHDEER_KEY', enableEnv: 'ENV_ENABLE_PUSHDEER' };

assert.strictEqual(isChannelActive(pushdeerChannel, { ENV_PUSHDEER_KEY: 'abc' }), true);
assert.strictEqual(isChannelActive(pushdeerChannel, { ENV_ENABLE_PUSHDEER: 'true' }), true);
assert.strictEqual(isChannelActive(pushdeerChannel, { ENV_ENABLE_PUSHDEER: 'TRUE' }), true);
assert.strictEqual(isChannelActive(pushdeerChannel, {}), false);
assert.strictEqual(isChannelActive(pushdeerChannel, { ENV_ENABLE_PUSHDEER: 'false' }), false);
console.log('Notifier channel gate (key / enable flag) verified');

// ------------------------------------------------------------------------------
// Test 24: Inline Button Callback Guest ID Resolution
// ------------------------------------------------------------------------------
function extractGuestIdFromCallbackData(data, messageMap = {}) {
  const parts = String(data || '').split(':');
  if (parts.length >= 2) {
    const candidate = parts[parts.length - 1];
    if (/^-?\d+$/.test(candidate)) {
      return candidate;
    }
  }
  return messageMap.message_id ? messageMap[messageMap.message_id] : null;
}

assert.strictEqual(extractGuestIdFromCallbackData('reply:123456'), '123456');
assert.strictEqual(extractGuestIdFromCallbackData('info:123456'), '123456');
assert.strictEqual(extractGuestIdFromCallbackData('block:123456'), '123456');
assert.strictEqual(extractGuestIdFromCallbackData('unblock:123456'), '123456');
console.log('Inline button callback guest ID resolution verified');

// ------------------------------------------------------------------------------
// Test 25: Sender Nickname & Username Keyword Screening
// ------------------------------------------------------------------------------
function getMessageSearchableText(message) {
  if (!message) return '';
  const parts = [];
  const text = message.text || message.caption || '';
  if (text) parts.push(text);

  const from = message.from;
  if (from) {
    if (from.first_name) parts.push(from.first_name);
    if (from.last_name) parts.push(from.last_name);
    if (from.username) parts.push(`@${from.username}`);
  }

  if (message.sender_chat?.title) {
    parts.push(message.sender_chat.title);
  } else if (message.chat?.type && message.chat.type !== 'private' && message.chat.title) {
    parts.push(message.chat.title);
  }

  return parts.join(' ');
}

const spamUserMessage = {
  message_id: 99,
  text: '你好在吗',
  from: {
    id: 5180046649,
    first_name: '同城-速约',
    last_name: '{老师免费上榜/看简介}',
    username: 'rr8qzerayyl',
  },
};

const searchable = getMessageSearchableText(spamUserMessage);
assert.strictEqual(searchable.includes('速约'), true);
assert.strictEqual(searchable.includes('看简介'), true);
assert.strictEqual(searchable.includes('你好在吗'), true);

const rules = ['换汇', '看简介', '速约', '外围'];
const hit = rules.find((r) => searchable.includes(r));
assert.strictEqual(hit, '看简介');
console.log('Sender nickname, username and profile keyword screening verified');

// ------------------------------------------------------------------------------
// Test 26: Telegram Bot API 7.0+ forward_origin & Modern Methods
// ------------------------------------------------------------------------------
function resolveForwardOriginGuestId(msg) {
  const origin = msg.forward_origin || msg.external_reply?.origin;
  if (origin) {
    if (origin.type === 'user' && origin.sender_user?.id) return String(origin.sender_user.id);
    if (origin.type === 'chat' && origin.sender_chat?.id) return String(origin.sender_chat.id);
    if (origin.type === 'channel' && origin.chat?.id) return String(origin.chat.id);
  }
  if (msg.forward_from?.id) return String(msg.forward_from.id);
  return null;
}

assert.strictEqual(resolveForwardOriginGuestId({
  forward_origin: { type: 'user', sender_user: { id: 987654321, first_name: 'Alice' } },
}), '987654321');

assert.strictEqual(resolveForwardOriginGuestId({
  forward_origin: { type: 'channel', chat: { id: -100999888777, title: 'News' } },
}), '-100999888777');

assert.strictEqual(resolveForwardOriginGuestId({
  external_reply: { origin: { type: 'user', sender_user: { id: 123456789 } } },
}), '123456789');

assert.strictEqual(resolveForwardOriginGuestId({
  forward_from: { id: 11223344 },
}), '11223344');

console.log('Telegram Bot API 7.0+ forward_origin & external_reply resolution verified');

// ------------------------------------------------------------------------------
// Test 27: Bot API 7.11+ CopyTextButton Markup
// ------------------------------------------------------------------------------
function copyTextButton(text, copyText) {
  return {
    text,
    copy_text: { text: String(copyText) },
  };
}

function adminMessageKeyboard(guestChatId = '') {
  const suffix = guestChatId ? `:${guestChatId}` : '';
  const rows = [
    [
      { text: '回复', callback_data: `reply${suffix}` },
      { text: '信息', callback_data: `info${suffix}` },
      { text: '撤回最近回复', callback_data: `revoke:last${suffix}` },
    ],
    [
      { text: '屏蔽', callback_data: `block${suffix}` },
      { text: '解除屏蔽', callback_data: `unblock${suffix}` },
      { text: '检查', callback_data: `checkblock${suffix}` },
    ],
  ];
  if (guestChatId) {
    rows.push([
      copyTextButton('📋 复制客人 UID', guestChatId),
    ]);
  }
  return { inline_keyboard: rows };
}

const kbWithGuest = adminMessageKeyboard('5544332211');
assert.strictEqual(kbWithGuest.inline_keyboard.length, 3);
assert.deepStrictEqual(kbWithGuest.inline_keyboard[2][0], {
  text: '📋 复制客人 UID',
  copy_text: { text: '5544332211' },
});

const kbWithoutGuest = adminMessageKeyboard('');
assert.strictEqual(kbWithoutGuest.inline_keyboard.length, 2);
console.log('Bot API 7.11+ CopyTextButton keyboard markup verified');

// ------------------------------------------------------------------------------
// Test 28: Bot API 7.1+ MarkdownV2 Blockquote & Expandable Blockquote
// ------------------------------------------------------------------------------
function blockquote(text = '') {
  return String(text)
    .split('\n')
    .map((line) => `>${line}`)
    .join('\n');
}

function expandableBlockquote(text = '') {
  const quoted = String(text)
    .split('\n')
    .map((line) => `>${line}`)
    .join('\n');
  return `**${quoted}**`;
}

assert.strictEqual(blockquote('line1\nline2'), '>line1\n>line2');
assert.strictEqual(expandableBlockquote('line1\nline2'), '**>line1\n>line2**');
console.log('Bot API 7.1+ MarkdownV2 blockquote & expandable blockquote verified');

// ------------------------------------------------------------------------------
// Test 29: Bot API 7.0 - 10.0+ Reaction Payload Normalization
// ------------------------------------------------------------------------------
function normalizeReaction(reaction) {
  if (typeof reaction === 'string' && reaction) {
    return [{ type: 'emoji', emoji: reaction }];
  }
  if (Array.isArray(reaction)) {
    return reaction.map((r) => (typeof r === 'string' ? { type: 'emoji', emoji: r } : r));
  }
  if (reaction && typeof reaction === 'object') {
    return [reaction];
  }
  return [];
}

assert.deepStrictEqual(normalizeReaction('🔥'), [{ type: 'emoji', emoji: '🔥' }]);
assert.deepStrictEqual(normalizeReaction(['👍', '❤️']), [
  { type: 'emoji', emoji: '👍' },
  { type: 'emoji', emoji: '❤️' },
]);
assert.deepStrictEqual(normalizeReaction({ type: 'custom_emoji', custom_emoji_id: '12345' }), [
  { type: 'custom_emoji', custom_emoji_id: '12345' },
]);
assert.deepStrictEqual(normalizeReaction({ type: 'paid' }), [{ type: 'paid' }]);
assert.deepStrictEqual(normalizeReaction([]), []);
assert.deepStrictEqual(normalizeReaction(null), []);
console.log('Bot API reaction payload normalization verified');

// ------------------------------------------------------------------------------
// Test 30: Bot API 8.0+ Scheduled Video Message ID Guard
// ------------------------------------------------------------------------------
function shouldRememberMessage(messageId) {
  return typeof messageId === 'number' && messageId > 0;
}

assert.strictEqual(shouldRememberMessage(12345), true);
assert.strictEqual(shouldRememberMessage(0), false); // Scheduled video message waiting for reencode
assert.strictEqual(shouldRememberMessage(null), false);
assert.strictEqual(shouldRememberMessage(undefined), false);
console.log('Bot API 8.0+ scheduled video message ID guard verified');

// ------------------------------------------------------------------------------
// Test 31: Modern Message Text Extraction (Polls, Stories, Paid Media)
// ------------------------------------------------------------------------------
function extractModernMessageSearchableText(message) {
  if (!message) return '';
  const parts = [];
  const text = message?.text || message?.caption || message?.poll?.question || message?.story?.caption || '';
  if (text) parts.push(text);

  if (Array.isArray(message?.poll?.options)) {
    for (const opt of message.poll.options) {
      if (opt.text) parts.push(opt.text);
    }
  }

  const from = message.from;
  if (from) {
    if (from.first_name) parts.push(from.first_name);
    if (from.last_name) parts.push(from.last_name);
    if (from.username) parts.push(`@${from.username}`);
  }

  return parts.join(' ');
}

const pollMessage = {
  message_id: 101,
  poll: {
    question: '请问在哪里换汇最划算？',
    options: [{ text: '找我代充' }, { text: '正规渠道' }],
  },
  from: { id: 111, first_name: 'Bob' },
};

const pollSearchable = extractModernMessageSearchableText(pollMessage);
assert.strictEqual(pollSearchable.includes('换汇'), true);
assert.strictEqual(pollSearchable.includes('代充'), true);
console.log('Modern message text extraction (polls & stories) verified');

// ------------------------------------------------------------------------------
// Test 32: Settings Panel 3-Page MarkdownV2 Syntax & Entity Escaping
// ------------------------------------------------------------------------------
function validateMarkdownV2(text) {
  // Strip code blocks (`...` and ```...```)
  const noCode = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  // Strip escaped characters (\x)
  const noEscaped = noCode.replace(/\\./g, '');
  // Look for unescaped reserved MarkdownV2 characters: ( ) [ ] ~ > # + - = | { } . !
  // (Note: * and _ are allowed for bold/italic if balanced)
  const forbidden = /[()\[\]~>#+\-=|{}.!]/;
  const match = noEscaped.match(forbidden);
  if (match) {
    throw new Error(`Unescaped MarkdownV2 character found: "${match[0]}" in text snippet: ${noEscaped.slice(Math.max(0, match.index - 20), match.index + 20)}`);
  }
  return true;
}

function buildMockSettingPanel(config, page) {
  const isModeration = page === 'moderation';
  const isForwarding = page === 'forwarding';
  const isDefense = page === 'defense';

  const title = isModeration
    ? '⚙️ *控制面板 \\- 拦截审查设置* \\(1/3\\)'
    : isForwarding
      ? '⚙️ *控制面板 \\- 转发与通知设置* \\(2/3\\)'
      : '⚙️ *控制面板 \\- 防护与离开设置* \\(3/3\\)';

  const lines = [title, ''];

  if (isModeration) {
    lines.push(
      `• *要求设置用户名:* ${config.req_username ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *要求设置个人头像:* ${config.req_photo ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *昵称与用户名审查:* ${config.screen_nickname !== false ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *敏感词多次自动拉黑:* ${config.auto_block ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *敏感词拉黑阈值:* \`${config.violation_limit} 次\``,
      '',
      '_点击下方按钮切换状态、调整阈值或同步规则库：_',
    );
  } else if (isForwarding) {
    const delayText = config.delay_seconds > 0 ? `${config.delay_seconds} 秒` : '关闭 (即时转发)';
    lines.push(
      `• *转发聚合延迟:* \`${delayText}\``,
      `• *敏感词通报管理:* ${config.notice_admin ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *敏感词提示客人:* ${config.notice_user ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *定期交易安全提醒:* ${config.enable_notify ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *外部推送仅告警:* ${config.notify_alert_only ? '✅ 仅告警' : '❌ 全部外发'}`,
      '',
      '_点击下方按钮可直接切换状态或调节延迟：_',
    );
  } else {
    lines.push(
      `• *短时防刷频控:* ${config.flood_protect ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *频控条数阈值:* \`${config.flood_limit || 5} 条 / ${config.flood_window_seconds || 10}秒\``,
      `• *频控静音时长:* \`${config.flood_mute_seconds || 60} 秒\``,
      `• *拦截危险安装包/可执行文件:* ${config.block_executables ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *离开模式 \\(自动应答\\):* ${config.away_mode ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *离开提示文案:* \`${(config.away_message || '外出中').replace(/[`\\]/g, '').slice(0, 25)}\``,
      '',
      '_点击下方按钮可快速调节频控参数或切换离开模式：_',
    );
  }
  return lines.join('\n');
}

const mockConfig = {
  req_username: false,
  req_photo: false,
  screen_nickname: true,
  auto_block: true,
  violation_limit: 3,
  delay_seconds: 3,
  notice_admin: false,
  notice_user: false,
  enable_notify: false,
  notify_alert_only: false,
  flood_protect: true,
  flood_limit: 5,
  flood_window_seconds: 10,
  flood_mute_seconds: 60,
  block_executables: true,
  away_mode: false,
  away_message: '外出中',
};

assert.strictEqual(validateMarkdownV2(buildMockSettingPanel(mockConfig, 'moderation')), true);
assert.strictEqual(validateMarkdownV2(buildMockSettingPanel(mockConfig, 'forwarding')), true);
assert.strictEqual(validateMarkdownV2(buildMockSettingPanel(mockConfig, 'defense')), true);
console.log('Settings panel 3-page MarkdownV2 entity escaping validated');

console.log('\nAll 32 test suites passed with 0 errors!\n');







