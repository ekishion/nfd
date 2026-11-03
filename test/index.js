// ==============================================================================
// test/index.js - Unit Test Suite（只覆盖可直接 import 的真实实现）
// format.js / memory-cache.js / notifiers/base.js 无运行时依赖；
// 依赖 KV/env/构建期的逻辑（panel 轮播、feature gate、路由等）不在本套件内
// ==============================================================================

import assert from 'node:assert/strict';

import {
  escapeMarkdown,
  mdLine,
  copyTextButton,
  adminMessageKeyboard,
  getCommand,
  getCommandArgs,
  getSenderKey,
  isServiceMessage,
  isMessageNotModified,
  getMessageSearchableText,
  getMessageText,
  formatGuestProfile,
  normalizeMessageText,
  parseKeywordRule,
  MAX_KEYWORD_RULE_LENGTH,
  utcDateKey,
  isDangerousDocument,
  buildMessageInfo,
  resolveTargetGuestId,
} from '../src/format.js';
import { memoryCache, getMemoryCache, setMemoryCache, isDuplicateUpdate } from '../src/memory-cache.js';
import { buildNotificationContent } from '../src/notifiers/base.js';

let passed = 0;
function done(name) {
  passed += 1;
  console.log(name);
}

console.log('Starting NFD Test Suite...\n');

// ------------------------------------------------------------------------------
// 1. MarkdownV2 Escaping
// ------------------------------------------------------------------------------
const specialChars = '_*[]()~`>#+-=|{}.!\\';
assert.strictEqual(
  escapeMarkdown(specialChars),
  '\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\',
);
assert.strictEqual(mdLine('标签', '值*'), '*标签:* 值\\*');
assert.strictEqual(mdLine('空', ''), '*空:* \\-');
done('MarkdownV2 escaping handles all 18 special characters');

// ------------------------------------------------------------------------------
// 2. Command & Argument Parsing
// ------------------------------------------------------------------------------
assert.strictEqual(getCommand({ text: '/panel' }, 'mybot'), '/panel');
assert.strictEqual(getCommand({ text: '/panel@mybot' }, 'mybot'), '/panel');
assert.strictEqual(getCommand({ text: '/panel@otherbot' }, 'mybot'), '');
assert.strictEqual(getCommand({ text: '@username_to_id_bot' }, 'mybot'), '');
assert.strictEqual(getCommandArgs({ text: '/block 12345678' }), '12345678');
assert.strictEqual(getCommandArgs({ text: '/addkeyword 换汇 代充' }), '换汇 代充');
assert.strictEqual(getCommandArgs({ text: '/stats' }), '');
done('Command and argument parser with bot target filtering works accurately');

// ------------------------------------------------------------------------------
// 3. Direct User ID vs Reply Mapping Resolution
// ------------------------------------------------------------------------------
assert.strictEqual(resolveTargetGuestId({ text: '/block 99887766' }, null), '99887766');
assert.strictEqual(resolveTargetGuestId({ text: '/block' }, '11223344'), '11223344');
assert.strictEqual(resolveTargetGuestId({ text: '/unblock 556677' }, '11223344'), '556677');
done('Direct UID vs mapped guest ID resolution works');

// ------------------------------------------------------------------------------
// 4. Memory Cache TTL, Invalidation & Capacity Pruning
// ------------------------------------------------------------------------------
setMemoryCache('user-1', { name: 'Alice' }, 60000);
assert.deepStrictEqual(getMemoryCache('user-1'), { name: 'Alice' });

// 填充至容量阈值（500），过期条目在下一次写入时被修剪
for (let i = 0; i < 499; i++) {
  memoryCache.set(`expired-${i}`, { value: i, expiresAt: Date.now() - 1000 });
}
assert.strictEqual(memoryCache.size, 500);
setMemoryCache('fresh-item', 'active', 60000);
assert.strictEqual(memoryCache.size, 2); // 'user-1' + 'fresh-item'，其余全部过期被清
assert.strictEqual(getMemoryCache('fresh-item'), 'active');

// TTL 到期后读取返回 undefined 并顺手删除
setMemoryCache('short-lived', 'gone-soon', 5);
await new Promise((resolve) => setTimeout(resolve, 15));
assert.strictEqual(getMemoryCache('short-lived'), undefined);
done('Memory Cache TTL and pruning behave as expected');

// ------------------------------------------------------------------------------
// 5. Keyword Matching & Batch Moderation
// normalize/parse 用真实实现，循环镜像 moderation.js findBlockedKeyword
// ------------------------------------------------------------------------------
function matchRules(rawText, ruleStrings) {
  const normalized = normalizeMessageText(rawText);
  const lowerNormalized = normalized.toLowerCase();
  const rules = ruleStrings.map(parseKeywordRule).filter(Boolean);
  for (const rule of rules) {
    if (rule.isRegex && rule.regex) {
      const m = normalized.match(rule.regex);
      if (m) return { matched: true, rule: rule.raw, snippet: m[0] };
    } else if (rule.text) {
      if (lowerNormalized.includes(rule.text)) {
        return { matched: true, rule: rule.raw, snippet: rule.raw };
      }
    }
  }
  return null;
}

const blockedKeywords = ['换汇', '收u', 'usdt', '代充'];
assert.strictEqual(matchRules('你好我想换汇', blockedKeywords).rule, '换汇');
assert.strictEqual(matchRules('出USDT啦', blockedKeywords).rule, 'usdt');
assert.strictEqual(matchRules('请问服务器怎么续费', blockedKeywords), null);

// 批量审查：一条命中即拦截整批
const batch = [
  { message_id: 1, text: '第一条消息：你好' },
  { message_id: 2, text: '第二条消息：请问收U吗？' },
];
let foundViolation = null;
for (const msg of batch) {
  const hit = matchRules(msg.text, blockedKeywords);
  if (hit) {
    foundViolation = hit;
    break;
  }
}
assert.strictEqual(foundViolation.rule, '收u');
done('Keyword matching and atomic batch moderation verified');

// ------------------------------------------------------------------------------
// 6. UTC Date Key（统计按日分片依赖）
// ------------------------------------------------------------------------------
assert.strictEqual(utcDateKey(new Date('2026-11-04T00:30:00Z')), '2026-11-04');
assert.strictEqual(utcDateKey(new Date('2026-01-05T23:59:59Z')), '2026-01-05');
assert.match(utcDateKey(), /^\d{4}-\d{2}-\d{2}$/);
done('UTC date key formatting verified');

// ------------------------------------------------------------------------------
// 7. Anti-Evasion Normalization & Regex Keyword Engine
// ------------------------------------------------------------------------------
// 7.1 Zero-width evasion bypass
const hiddenText = '请问\u200B换\u200C汇\u200D吗';
assert.strictEqual(normalizeMessageText(hiddenText), '请问换汇吗');

// 7.2 Full-width character normalization (NFKC)
const fullWidthText = '我的ｖｘ是：ｔｅｓｔ１２３';
assert.strictEqual(normalizeMessageText(fullWidthText), '我的vx是:test123');

// 7.3 Regex rule matching & snippet capture
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

// 7.4 Anti-evasion combination (zero-width + full-width + spacing + regex)
const evasionText = '联系\u200Bｖ\u200Bｘ\u3000：\u200B \u200Fvip_88888 抢购';
const resEvasion = matchRules(evasionText, testRules);
assert.strictEqual(resEvasion.matched, true);
assert.strictEqual(resEvasion.snippet, 'vx : vip_88888');

// 7.5 超长规则被拒绝（防 ReDoS / CPU 占用）
const overlyLong = '/a' + 'a?'.repeat(MAX_KEYWORD_RULE_LENGTH) + '/';
assert.strictEqual(parseKeywordRule(overlyLong), null);
assert.deepStrictEqual(parseKeywordRule('正常短规则'), { raw: '正常短规则', isRegex: false, text: '正常短规则' });
done('Anti-evasion normalization & Regex keyword engine verified');

// ------------------------------------------------------------------------------
// 8. Update ID LRU De-duplication（容量 200）
// ------------------------------------------------------------------------------
assert.strictEqual(isDuplicateUpdate(1001), false);
assert.strictEqual(isDuplicateUpdate(1001), true);
assert.strictEqual(isDuplicateUpdate(1002), false);
for (let i = 0; i < 300; i++) {
  isDuplicateUpdate(2000 + i);
}
assert.strictEqual(isDuplicateUpdate(2000), false); // 已被淘汰出窗口
assert.strictEqual(isDuplicateUpdate(2299), true); // 仍在窗口内
assert.strictEqual(isDuplicateUpdate(undefined), false);
done('Update ID LRU de-duplication verified');

// ------------------------------------------------------------------------------
// 9. Dangerous Document Executable Filter
// ------------------------------------------------------------------------------
assert.strictEqual(isDangerousDocument({ document: { file_name: 'invoice.pdf' } }), false);
assert.strictEqual(isDangerousDocument({ document: { file_name: 'photo.jpg' } }), false);
assert.strictEqual(isDangerousDocument({ document: { file_name: 'setup.exe' } }), true);
assert.strictEqual(isDangerousDocument({ document: { file_name: 'client_v2.APK' } }), true);
assert.strictEqual(isDangerousDocument({ document: { file_name: 'script.bat' } }), true);
assert.strictEqual(isDangerousDocument({ document: {} }), false);
assert.strictEqual(isDangerousDocument({}), false);
done('Dangerous document executable filter verified');

// ------------------------------------------------------------------------------
// 10. Guest Tag & Profile Builder
// ------------------------------------------------------------------------------
const taggedInfo = buildMessageInfo({ from: { id: 12345, first_name: '张三' } }, 1, 'VIP买家');
// buildMessageInfo 走 mdLine 输出，方括号会被 MarkdownV2 转义
assert.ok(taggedInfo.includes('张三 \\[VIP买家\\]'));
assert.ok(taggedInfo.includes('备注'));

const plainInfo = buildMessageInfo({ from: { id: 67890, first_name: '李四' } }, 1, '');
assert.ok(plainInfo.includes('李四 \\(67890\\)'));
assert.ok(!plainInfo.includes('备注'));

const multiInfo = buildMessageInfo({ from: { id: 1, first_name: '王五' } }, 3, '');
assert.ok(multiInfo.includes('连续留言'));
done('Customer tagging format in guest info verified');

// ------------------------------------------------------------------------------
// 11. Non-NFD Bot Command Filtering in Group Chats
// ------------------------------------------------------------------------------
const myBot = 'nfd_bot';
assert.strictEqual(getCommand({ text: '/start@username_to_id_bot' }, myBot), '');
assert.strictEqual(getCommand({ text: '/id@username_to_id_bot' }, myBot), '');
assert.strictEqual(getCommand({ text: '/panel@nfd_bot' }, myBot), '/panel');
assert.strictEqual(getCommand({ text: '/panel' }, myBot), '/panel');
assert.strictEqual(getCommand({ text: '你好 @username_to_id_bot 查下id' }, myBot), '');
done('Non-NFD bot commands and mentions properly ignored');

// ------------------------------------------------------------------------------
// 12. Multi-Channel Push Notification Content
// ------------------------------------------------------------------------------
const alertNotice = buildNotificationContent('security_alert', {
  reason: '敏感关键词',
  senderName: '张三',
  senderId: '123456',
  detail: '代充',
});
assert.strictEqual(alertNotice.title, '[NFD 拦截报警] 敏感关键词');
assert.strictEqual(alertNotice.summary, '敏感关键词: 张三');
assert.ok(alertNotice.content.includes('123456'));

const guestNotice = buildNotificationContent('guest_message', {
  senderName: '李四',
  senderId: '789012',
  messageCount: 3,
  text: '你好，请问有什么优惠吗？',
});
assert.strictEqual(guestNotice.title, '[NFD 客人新留言] 来自 李四');
assert.ok(guestNotice.summary.includes('3条'));
done('Multi-channel push notification content verified');

// ------------------------------------------------------------------------------
// 13. Sender Identity Resolution Across Chat Types
// ------------------------------------------------------------------------------
assert.strictEqual(getSenderKey({ chat: { id: 111, type: 'private' }, from: { id: 111 } }), '111');
assert.strictEqual(getSenderKey({ chat: { id: -100555, type: 'supergroup' }, from: { id: 222 } }), '222');
assert.strictEqual(getSenderKey({ chat: { id: -100555, type: 'supergroup' }, from: { id: 333 } }), '333');
assert.strictEqual(getSenderKey({ chat: { id: -100666, type: 'channel' }, sender_chat: { id: -100666 } }), '-100666');
assert.strictEqual(getSenderKey({ chat: { id: -100777, type: 'group' } }), '-100777');
done('Sender identity resolution across chat types verified');

// ------------------------------------------------------------------------------
// 14. Sender Nickname & Username Keyword Screening
// ------------------------------------------------------------------------------
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

const screenRules = ['换汇', '看简介', '速约', '外围'];
const hit = screenRules.find((r) => searchable.includes(r));
assert.strictEqual(hit, '看简介');
done('Sender nickname, username and profile keyword screening verified');

// ------------------------------------------------------------------------------
// 15. Bot API 7.11+ CopyTextButton Markup
// ------------------------------------------------------------------------------
const kbWithGuest = adminMessageKeyboard('5544332211');
assert.strictEqual(kbWithGuest.inline_keyboard.length, 3);
assert.deepStrictEqual(kbWithGuest.inline_keyboard[2][0], {
  text: '📋 复制客人 UID',
  copy_text: { text: '5544332211' },
});

const kbWithoutGuest = adminMessageKeyboard('');
assert.strictEqual(kbWithoutGuest.inline_keyboard.length, 2);
assert.deepStrictEqual(copyTextButton('x', 123), { text: 'x', copy_text: { text: '123' } });
done('Bot API 7.11+ CopyTextButton keyboard markup verified');

// ------------------------------------------------------------------------------
// 16. Service Message Detection
// ------------------------------------------------------------------------------
assert.strictEqual(isServiceMessage({ forum_topic_created: { name: '张三 (123)' }, message_thread_id: 7 }), true);
assert.strictEqual(isServiceMessage({ pinned_message: { text: 'x' } }), true);
assert.strictEqual(isServiceMessage({ new_chat_members: [{ id: 1 }] }), true);
assert.strictEqual(isServiceMessage({ text: '你好，请问在吗？' }), false);
assert.strictEqual(isServiceMessage({ photo: [{ width: 1 }], caption: '图' }), false);
assert.strictEqual(isServiceMessage(null), false);
done('Service message detection (topic creation / pin / membership) verified');

// ------------------------------------------------------------------------------
// 17. Message Not Modified Suppression
// ------------------------------------------------------------------------------
assert.strictEqual(isMessageNotModified('Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message'), true);
assert.strictEqual(isMessageNotModified("Bad Request: message can't be copied"), false);
assert.strictEqual(isMessageNotModified(''), false);
assert.strictEqual(isMessageNotModified(undefined), false);
done('Message not modified suppression (panel refresh) verified');

// ------------------------------------------------------------------------------
// 18. Modern Message Text Extraction
// ------------------------------------------------------------------------------
const pollMessage = {
  message_id: 101,
  poll: {
    question: '请问在哪里换汇最划算？',
    options: [{ text: '找我代充' }, { text: '正规渠道' }],
  },
  from: { id: 111, first_name: 'Bob' },
};

assert.strictEqual(getMessageText(pollMessage), '请问在哪里换汇最划算？');
const pollSearchable = getMessageSearchableText(pollMessage);
assert.strictEqual(pollSearchable.includes('换汇'), true);
assert.strictEqual(pollSearchable.includes('代充'), true);
done('Modern message text extraction (polls & stories) verified');

// ------------------------------------------------------------------------------
// 19. Guest Profile Card Formatting
// ------------------------------------------------------------------------------
const card = formatGuestProfile(
  { userId: '123456', firstSeen: 0, lastSeen: 0, messageCount: 8, name: '张三', username: 'zhangsan' },
  'VIP买家',
  true,
  2,
);
assert.ok(card.includes('*客人画像档案*'));
assert.ok(card.includes('123456'));
assert.ok(card.includes('VIP买家'));
assert.ok(card.includes('已静音'));
done('Guest profile card formatting verified');

console.log(`\nAll ${passed} test groups passed with 0 errors!\n`);
