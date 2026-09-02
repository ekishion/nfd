// ==============================================================================
// src/admin.js - Admin Commands, Callback Query Router & Guest Management
// ==============================================================================

import { MESSAGE_MAP_TTL, getAdminUid, getCommandWarningCooldownMs, asArray } from './config.js';
import {
  kvGetJson,
  kvPutJson,
  cachedKvGetJson,
  cachedKvPutJson,
  invalidateMemoryCache,
  incrementStat,
  getStatCount,
  sendCooldownPlainText,
  fetchKeywordDb,
} from './cache.js';
import {
  sendMarkdown,
  sendPlainText,
  copyMessage,
  deleteMessage,
  answerCallbackQuery,
  escapeMarkdown,
  mdLine,
  getCommandArgs,
  buildUserName,
  formatGuestInfo,
  revokeReplyKeyboard,
} from './telegram.js';
import { isUserBlocked, setUserBlocked, getKeywordRules } from './moderation.js';
import { getMappedGuestId, rememberMessageMap } from './pipeline.js';
import { sendSettingPanel, handleSettingCallback } from './panel.js';

export async function rememberForceReplyPrompt(promptMessageId, guestChatId) {
  return kvPutJson(`force-reply-${promptMessageId}`, {
    guestChatId: String(guestChatId),
    createdAt: Date.now(),
  }, { expirationTtl: MESSAGE_MAP_TTL });
}

export async function clearForceReplyPrompt(promptMessageId) {
  return kvPutJson(`force-reply-${promptMessageId}`, null, { expirationTtl: 60 });
}

export async function clearRepliedPrompt(message) {
  const promptId = message.reply_to_message?.message_id;
  if (!promptId) return;
  const record = await kvGetJson(`force-reply-${promptId}`, null);
  if (!record) return;
  const adminUid = getAdminUid();
  if (adminUid) {
    await deleteMessage({ chat_id: adminUid, message_id: promptId });
  }
  await clearForceReplyPrompt(promptId);
}

export async function handleAdminMessage(message, command) {
  const adminUid = getAdminUid();
  if (!adminUid) return;

  if (command === '/help') return sendAdminHelp();
  if (command === '/panel' || command === '/config') {
    return sendSettingPanel(adminUid, 'moderation');
  }
  if (command === '/stats') return sendStats();
  if (command === '/keywords') return listKeywords();
  if (command === '/addkeyword') return addKeyword(message);
  if (command === '/delkeyword') return deleteKeyword(message);
  if (command === '/synckeywords') return syncKeywordDb();

  if (command === '/block') return handleBlock(message);
  if (command === '/unblock') return handleUnBlock(message);
  if (command === '/checkblock') return checkBlock(message);

  const guestChatId = await getMappedGuestId(message);
  if (!guestChatId) {
    return sendAdminHelp('请先回复一条人偶转来的留言，或发送管理命令。');
  }

  const copied = await copyMessage({
    chat_id: guestChatId,
    from_chat_id: message.chat.id,
    message_id: message.message_id,
  });

  if (copied.ok) {
    await incrementStat('admin-replied');
    await kvPutJson(`last-reply-${guestChatId}`, {
      chatId: String(guestChatId),
      messageId: copied.result.message_id,
      adminMessageId: message.message_id,
      createdAt: Date.now(),
    });
    await clearRepliedPrompt(message);
    return sendMarkdown(adminUid, escapeMarkdown(`人偶已经转达给 UID:${guestChatId} 了喵`), {
      reply_parameters: { message_id: message.message_id },
      reply_markup: revokeReplyKeyboard(guestChatId, copied.result.message_id),
    });
  }

  await clearRepliedPrompt(message);
  return sendMarkdown(adminUid, escapeMarkdown(`转达失败：${copied.description || 'Unknown error'}`));
}

export async function handleGuestAdminCommand(message, command) {
  const chatId = String(message.chat.id);
  const adminUid = getAdminUid();
  await incrementStat('guest-command-warning');
  if (adminUid) {
    await sendMarkdown(
      adminUid,
      [
        '*客人误触管理指令*',
        mdLine('指令', command),
        mdLine('用户ID', chatId),
        mdLine('客人', buildUserName(message.from || {})),
      ].join('\n'),
    );
  }
  return sendCooldownPlainText(
    chatId,
    `warn-command-${chatId}`,
    '这是管理人专用的小按钮喵。请直接发送想留言的内容，人偶会帮你转达。',
    getCommandWarningCooldownMs(),
  );
}

export async function onCallbackQuery(callbackQuery) {
  const adminUid = getAdminUid();
  if (String(callbackQuery.from?.id) !== adminUid) {
    return answerCallbackQuery({
      callback_query_id: callbackQuery.id,
      text: '这是管理人专用按钮喵。',
      show_alert: false,
    });
  }

  const data = callbackQuery.data || '';
  const adminMessageId = callbackQuery.message?.message_id;

  // 1. Interactive Settings Panel Callbacks
  if (data.startsWith('setting:')) {
    return handleSettingCallback(callbackQuery, data, adminMessageId);
  }

  // 2. Message Forwarding & Guest Management Callbacks
  const guestChatId = adminMessageId ? await getMappedGuestId(callbackQuery.message) : null;

  if (data === 'reply') {
    if (!guestChatId) return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '找不到这位客人了喵。' });
    const prompt = await sendMarkdown(adminUid, escapeMarkdown(`请回复这条消息，人偶会转达给 UID:${guestChatId} 喵。`), {
      reply_parameters: { message_id: adminMessageId },
      reply_markup: {
        force_reply: true,
        input_field_placeholder: '输入要转达给客人的内容',
        selective: true,
      },
    });
    if (prompt.ok) {
      await rememberMessageMap(prompt.result.message_id, guestChatId);
      await rememberForceReplyPrompt(prompt.result.message_id, guestChatId);
    }
    return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '请回复人偶的新提示消息。' });
  }

  if (data === 'info') {
    if (!guestChatId) return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '找不到留言人信息了喵。' });
    const info = await cachedKvGetJson(`guest-info-${guestChatId}`, 300000, null);
    await sendMarkdown(adminUid, info ? formatGuestInfo(info) : escapeMarkdown(`没有找到 UID:${guestChatId} 的详细信息。`), {
      reply_parameters: { message_id: adminMessageId },
    });
    return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '已展开留言人信息。' });
  }

  if (data === 'block' || data === 'unblock' || data === 'checkblock') {
    if (!guestChatId) return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '找不到这位客人了喵。' });
    const text = await applyBlockAction(data, guestChatId);
    await sendMarkdown(adminUid, escapeMarkdown(text), {
      reply_parameters: { message_id: adminMessageId },
    });
    return answerCallbackQuery({ callback_query_id: callbackQuery.id, text });
  }

  if (data === 'revoke:last') {
    if (!guestChatId) return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '找不到这位客人了喵。' });
    const lastReply = await kvGetJson(`last-reply-${guestChatId}`, null);
    if (!lastReply?.messageId) {
      return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '还没有可撤回的回复喵。' });
    }
    return revokeReply(callbackQuery, lastReply.chatId || guestChatId, lastReply.messageId);
  }

  if (data.startsWith('revoke:')) {
    const [, chatId, messageId] = data.split(':');
    return revokeReply(callbackQuery, chatId, messageId);
  }

  return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '人偶还不认识这个按钮喵。' });
}

export async function applyBlockAction(action, guestChatId) {
  const adminUid = getAdminUid();
  if (action === 'block') {
    if (String(guestChatId) === adminUid) return '人偶不能屏蔽主人自己喵。';
    await setUserBlocked(guestChatId, true);
    return `UID:${guestChatId} 已放入静音抽屉`;
  }
  if (action === 'unblock') {
    await setUserBlocked(guestChatId, false);
    return `UID:${guestChatId} 已从静音抽屉取出`;
  }
  const blocked = await isUserBlocked(guestChatId);
  return `UID:${guestChatId} ${blocked ? '正在静音抽屉里' : '可以正常留言'}`;
}

export async function revokeReply(callbackQuery, chatId, messageId) {
  const adminUid = getAdminUid();
  if (!chatId || !messageId) {
    return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '撤回目标不完整喵。' });
  }
  const result = await deleteMessage({
    chat_id: chatId,
    message_id: Number(messageId),
  });
  if (!result.ok) {
    return answerCallbackQuery({
      callback_query_id: callbackQuery.id,
      text: `撤回失败：${result.description || 'Unknown error'}`,
      show_alert: true,
    });
  }
  if (adminUid) {
    await sendMarkdown(adminUid, escapeMarkdown(`已撤回发给 UID:${chatId} 的回复。`));
  }
  return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '已撤回。' });
}

export async function resolveTargetGuestId(message) {
  const args = getCommandArgs(message);
  if (args && /^\d+$/.test(args)) {
    return args;
  }
  return getMappedGuestId(message);
}

export async function handleBlock(message) {
  const adminUid = getAdminUid();
  const guestChatId = await resolveTargetGuestId(message);
  if (!guestChatId) return sendAdminHelp('用法：回复一条客人的留言发送 /block，或直接发送 `/block 用户ID`。');
  if (String(guestChatId) === adminUid) {
    return sendPlainText(adminUid, '人偶不能屏蔽主人自己喵。');
  }

  await setUserBlocked(guestChatId, true);
  return sendMarkdown(adminUid, escapeMarkdown(`UID:${guestChatId} 已放入静音抽屉`));
}

export async function handleUnBlock(message) {
  const adminUid = getAdminUid();
  const guestChatId = await resolveTargetGuestId(message);
  if (!guestChatId) return sendAdminHelp('用法：回复一条客人的留言发送 /unblock，或直接发送 `/unblock 用户ID`。');

  await setUserBlocked(guestChatId, false);
  return sendMarkdown(adminUid, escapeMarkdown(`UID:${guestChatId} 已从静音抽屉取出`));
}

export async function checkBlock(message) {
  const adminUid = getAdminUid();
  const guestChatId = await resolveTargetGuestId(message);
  if (!guestChatId) return sendAdminHelp('用法：回复一条客人的留言发送 /checkblock，或直接发送 `/checkblock 用户ID`。');

  const blocked = await isUserBlocked(guestChatId);
  return sendMarkdown(adminUid, escapeMarkdown(`UID:${guestChatId} ${blocked ? '正在静音抽屉里' : '可以正常留言'}`));
}

export async function sendAdminHelp(prefix = '') {
  const adminUid = getAdminUid();
  if (!adminUid) return;
  const lines = [
    prefix && escapeMarkdown(prefix),
    '*人偶管理手册*',
    '`/panel` 打开控制面板',
    '`/stats` 查看人偶今日工作记录',
    '`/block [UID]` 把客人放入静音抽屉（支持回复或直接带UID）',
    '`/unblock [UID]` 把客人从静音抽屉取出（支持回复或直接带UID）',
    '`/checkblock [UID]` 查看客人留言状态（支持回复或直接带UID）',
    '`/addkeyword 关键词` 添加不能转达的词',
    '`/delkeyword 关键词` 删除不能转达的词',
    '`/keywords` 查看关键词小纸条',
    '`/synckeywords` 从 keyword\\.db 同步关键词到小纸条',
    '',
    '直接回复人偶转来的留言，就会把内容转达给原来的客人喵。',
  ].filter(Boolean);
  return sendMarkdown(adminUid, lines.join('\n'));
}

export async function listKeywords() {
  const adminUid = getAdminUid();
  if (!adminUid) return;
  const rules = await getKeywordRules();
  if (!rules.length) {
    return sendMarkdown(adminUid, '关键词小纸条还是空的喵。');
  }
  const lines = rules.map((rule) => {
    if (rule.isRegex) {
      return `\\- \\[正则\\] \`${escapeMarkdown(rule.raw)}\``;
    }
    return `\\- ${escapeMarkdown(rule.raw)}`;
  });
  return sendMarkdown(adminUid, ['*关键词小纸条*', ...lines].join('\n'));
}

export async function addKeyword(message) {
  const adminUid = getAdminUid();
  if (!adminUid) return;
  const keyword = getCommandArgs(message);
  if (!keyword) return sendMarkdown(adminUid, '用法：`/addkeyword 关键词` 或 `/addkeyword /正则/i`');

  if (keyword.startsWith('/') && keyword.lastIndexOf('/') > 0) {
    const match = keyword.match(/^\/(.+)\/([a-z]*)$/i);
    if (match) {
      try {
        new RegExp(match[1], match[2] || 'i');
      } catch (err) {
        return sendMarkdown(adminUid, escapeMarkdown(`正则表达式语法错误：${err.message}`));
      }
    }
  }

  const current = await kvGetJson('blocked-keywords', []);
  const next = Array.from(new Set([...asArray(current), keyword]));
  await cachedKvPutJson('blocked-keywords', next);
  invalidateMemoryCache('merged-keyword-rules');
  return sendMarkdown(adminUid, escapeMarkdown(`已把「${keyword}」写进关键词小纸条`));
}

export async function deleteKeyword(message) {
  const adminUid = getAdminUid();
  if (!adminUid) return;
  const keyword = getCommandArgs(message);
  if (!keyword) return sendMarkdown(adminUid, '用法：`/delkeyword 关键词`');

  const current = await kvGetJson('blocked-keywords', []);
  const next = asArray(current).filter((item) => item !== keyword);
  await cachedKvPutJson('blocked-keywords', next);
  invalidateMemoryCache('merged-keyword-rules');
  return sendMarkdown(adminUid, escapeMarkdown(`已从关键词小纸条擦掉「${keyword}」`));
}

export async function syncKeywordDb() {
  const adminUid = getAdminUid();
  if (!adminUid) return;
  const fromDb = await fetchKeywordDb();
  if (!fromDb.length) {
    return sendMarkdown(adminUid, 'keyword\\.db 里没有关键词喵。');
  }
  const current = asArray(await kvGetJson('blocked-keywords', []));
  const merged = Array.from(new Set([...current, ...fromDb]));
  await cachedKvPutJson('blocked-keywords', merged);
  invalidateMemoryCache('merged-keyword-rules');
  const added = merged.length - current.length;
  return sendMarkdown(
    adminUid,
    escapeMarkdown(`已从 keyword.db 同步 ${fromDb.length} 个关键词，新增 ${added} 个，小纸条现共 ${merged.length} 个`),
  );
}

export async function sendStats() {
  const adminUid = getAdminUid();
  if (!adminUid) return;
  const names = [
    'guest-message',
    'admin-replied',
    'keyword-blocked',
    'keyword-auto-blocked',
    'no-username-blocked',
    'no-photo-blocked',
    'guest-command-warning',
    'blocked-user-message',
  ];
  const values = await Promise.all(names.map((name) => getStatCount(name)));
  const lines = names.map((name, index) => mdLine(name, String(values[index] ?? 0)));
  return sendMarkdown(adminUid, ['*人偶工作记录*', ...lines].join('\n'));
}
