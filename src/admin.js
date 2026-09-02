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
  getGuestTag,
  setGuestTag,
  getGuestProfile,
  getQuickReply,
  setQuickReply,
  deleteQuickReply,
  listQuickReplies,
  updateRuntimeConfig,
  getRuntimeConfig,
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
  formatGuestProfile,
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

  if (command === '/quick' || command === '/q') return handleQuickReply(message);
  if (command === '/quicks') return handleListQuickReplies();
  if (command === '/addquick') return handleAddQuickReply(message);
  if (command === '/delquick') return handleDeleteQuickReply(message);

  if (command === '/away') return handleAwayMode(message);
  if (command === '/back') return handleBackMode();
  if (command === '/user') return handleUserProfile(message);
  if (command === '/tag') return handleTagGuest(message);

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

  if (data.startsWith('setting:')) {
    return handleSettingCallback(callbackQuery);
  }

  if (data === 'reply') {
    const guestChatId = await getMappedGuestId(callbackQuery.message);
    if (!guestChatId) {
      return answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: '找不到对应的客人喵，请直接回复原留言。',
        show_alert: true,
      });
    }
    const prompt = await sendMarkdown(
      adminUid,
      `请回复这条消息，人偶会转达给 UID:${guestChatId} 喵。`,
      { reply_markup: { force_reply: true, selective: true } },
    );
    if (prompt.ok) {
      await rememberForceReplyPrompt(prompt.result.message_id, guestChatId);
    }
    return answerCallbackQuery({
      callback_query_id: callbackQuery.id,
      text: '已生成回复输入框，请回复那条提示消息喵。',
    });
  }

  if (data === 'info') {
    const guestChatId = await getMappedGuestId(callbackQuery.message);
    if (!guestChatId) {
      return answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: '找不到这条留言对应的客人喵。',
        show_alert: true,
      });
    }
    const [profile, tag, blocked, violation] = await Promise.all([
      getGuestProfile(guestChatId),
      getGuestTag(guestChatId),
      isUserBlocked(guestChatId),
      kvGetJson(`keyword-violation-${guestChatId}`, null),
    ]);
    const lines = formatGuestProfile(profile || { userId: guestChatId }, tag, blocked, violation?.count);
    await sendMarkdown(adminUid, lines);
    return answerCallbackQuery({ callback_query_id: callbackQuery.id });
  }

  if (data === 'block' || data === 'unblock' || data === 'checkblock') {
    const guestChatId = await getMappedGuestId(callbackQuery.message);
    if (!guestChatId) {
      return answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: '找不到对应的客人喵。',
        show_alert: true,
      });
    }
    if (data === 'block') {
      await setUserBlocked(guestChatId, true);
      await answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: `已将 UID:${guestChatId} 放入静音抽屉。`,
      });
      return sendMarkdown(adminUid, escapeMarkdown(`已将 UID:${guestChatId} 放入静音抽屉喵`));
    }
    if (data === 'unblock') {
      await setUserBlocked(guestChatId, false);
      await answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: `已将 UID:${guestChatId} 从静音抽屉取出。`,
      });
      return sendMarkdown(adminUid, escapeMarkdown(`已将 UID:${guestChatId} 从静音抽屉取出喵`));
    }
    if (data === 'checkblock') {
      const blocked = await isUserBlocked(guestChatId);
      return answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: `UID:${guestChatId} 当前状态：${blocked ? '已静音' : '正常'}`,
        show_alert: true,
      });
    }
  }

  if (data === 'revoke:last') {
    const guestChatId = await getMappedGuestId(callbackQuery.message);
    if (!guestChatId) {
      return answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: '找不到对应的客人喵。',
        show_alert: true,
      });
    }
    const lastReply = await kvGetJson(`last-reply-${guestChatId}`, null);
    if (!lastReply || !lastReply.messageId) {
      return answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: '没有找到可撤回的回复喵。',
        show_alert: true,
      });
    }
    const result = await deleteMessage({
      chat_id: guestChatId,
      message_id: lastReply.messageId,
    });
    if (result.ok) {
      await kvPutJson(`last-reply-${guestChatId}`, null, { expirationTtl: 60 });
      await answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: '已成功撤回转达的消息。',
      });
      return sendMarkdown(adminUid, escapeMarkdown(`已帮管理人撤回发给 UID:${guestChatId} 的上一条消息喵`));
    }
    return answerCallbackQuery({
      callback_query_id: callbackQuery.id,
      text: `撤回失败：${result.description || 'Unknown error'}`,
      show_alert: true,
    });
  }

  if (data.startsWith('revoke:')) {
    const [, targetChatId, targetMsgId] = data.split(':');
    const result = await deleteMessage({
      chat_id: targetChatId,
      message_id: targetMsgId,
    });
    if (result.ok) {
      await deleteMessage({ chat_id: adminUid, message_id: adminMessageId });
      return answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: '已成功撤回此条消息。',
      });
    }
    return answerCallbackQuery({
      callback_query_id: callbackQuery.id,
      text: `撤回失败：${result.description || 'Unknown error'}`,
      show_alert: true,
    });
  }

  return answerCallbackQuery({ callback_query_id: callbackQuery.id });
}

function resolveTargetGuestId(message, mappedGuestId) {
  const args = getCommandArgs(message);
  if (args && /^\d+$/.test(args)) {
    return args;
  }
  return mappedGuestId;
}

export async function handleBlock(message) {
  const adminUid = getAdminUid();
  if (!adminUid) return;

  const mappedGuestId = await getMappedGuestId(message);
  const guestChatId = resolveTargetGuestId(message, mappedGuestId);
  if (!guestChatId) return sendAdminHelp('用法：回复一条客人的留言发送 /block，或直接发送 `/block 用户ID`。');

  await setUserBlocked(guestChatId, true);
  return sendMarkdown(adminUid, escapeMarkdown(`已将 UID:${guestChatId} 放入静音抽屉喵`));
}

export async function handleUnBlock(message) {
  const adminUid = getAdminUid();
  if (!adminUid) return;

  const mappedGuestId = await getMappedGuestId(message);
  const guestChatId = resolveTargetGuestId(message, mappedGuestId);
  if (!guestChatId) return sendAdminHelp('用法：回复一条客人的留言发送 /unblock，或直接发送 `/unblock 用户ID`。');

  await setUserBlocked(guestChatId, false);
  return sendMarkdown(adminUid, escapeMarkdown(`已将 UID:${guestChatId} 从静音抽屉取出喵`));
}

export async function checkBlock(message) {
  const adminUid = getAdminUid();
  if (!adminUid) return;

  const mappedGuestId = await getMappedGuestId(message);
  const guestChatId = resolveTargetGuestId(message, mappedGuestId);
  if (!guestChatId) return sendAdminHelp('用法：回复一条客人的留言发送 /checkblock，或直接发送 `/checkblock 用户ID`。');

  const blocked = await isUserBlocked(guestChatId);
  return sendMarkdown(adminUid, escapeMarkdown(`UID:${guestChatId} ${blocked ? '正在静音抽屉里' : '可以正常留言'}`));
}

export async function handleQuickReply(message) {
  const adminUid = getAdminUid();
  if (!adminUid) return;

  const args = getCommandArgs(message).trim();
  if (!args) {
    return sendMarkdown(adminUid, '用法：回复一条客人留言并发送 `/quick 标签`（或 `/q 标签`）');
  }

  const parts = args.split(/\s+/);
  let tag = parts[0];
  let targetUid = await getMappedGuestId(message);

  if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
    targetUid = parts[0];
    tag = parts[1];
  }

  if (!targetUid) {
    return sendMarkdown(adminUid, '请回复一条客人的留言发送快捷短语，或输入 `/quick 用户ID 标签`。');
  }

  const content = await getQuickReply(tag);
  if (!content) {
    return sendMarkdown(adminUid, escapeMarkdown(`未找到标签为「${tag}」的快捷短语喵。发送 /quicks 查看所有列表。`));
  }

  const sent = await sendPlainText(targetUid, content);
  if (sent.ok) {
    await incrementStat('admin-replied');
    return sendMarkdown(adminUid, escapeMarkdown(`已使用快捷短语「${tag}」转达给 UID:${targetUid} 喵`));
  }
  return sendMarkdown(adminUid, escapeMarkdown(`快捷回复转达失败：${sent.description || 'Unknown error'}`));
}

export async function handleListQuickReplies() {
  const adminUid = getAdminUid();
  if (!adminUid) return;
  const list = await listQuickReplies();
  if (!list.length) {
    return sendMarkdown(adminUid, '目前还没有添加快捷短语喵。使用 `/addquick 标签 文本内容` 添加。');
  }
  const lines = list.map((tag) => `\\- \`${escapeMarkdown(tag)}\``);
  return sendMarkdown(adminUid, ['*已保存的快捷短语标签*', ...lines, '', '使用 `/quick 标签` 直接回复客人喵。'].join('\n'));
}

export async function handleAddQuickReply(message) {
  const adminUid = getAdminUid();
  if (!adminUid) return;
  const args = getCommandArgs(message).trim();
  const firstSpace = args.search(/\s/);
  if (firstSpace === -1) {
    return sendMarkdown(adminUid, '用法：`/addquick 标签 快捷文本内容`');
  }
  const tag = args.slice(0, firstSpace).trim();
  const content = args.slice(firstSpace).trim();
  if (!tag || !content) {
    return sendMarkdown(adminUid, '用法：`/addquick 标签 快捷文本内容`');
  }
  await setQuickReply(tag, content);
  return sendMarkdown(adminUid, escapeMarkdown(`已添加快捷短语「${tag}」喵！`));
}

export async function handleDeleteQuickReply(message) {
  const adminUid = getAdminUid();
  if (!adminUid) return;
  const tag = getCommandArgs(message).trim();
  if (!tag) {
    return sendMarkdown(adminUid, '用法：`/delquick 标签`');
  }
  await deleteQuickReply(tag);
  return sendMarkdown(adminUid, escapeMarkdown(`已删除快捷短语「${tag}」喵。`));
}

export async function handleAwayMode(message) {
  const adminUid = getAdminUid();
  if (!adminUid) return;
  const customMsg = getCommandArgs(message).trim();
  const patch = { away_mode: true };
  if (customMsg) {
    patch.away_message = customMsg;
  }
  await updateRuntimeConfig(patch);
  const note = customMsg ? `已设置离开提示文案：\n「${customMsg}」` : '已开启离开自动应答模式。';
  return sendMarkdown(adminUid, escapeMarkdown(`${note}\n发送 /back 可恢复在线状态喵。`));
}

export async function handleBackMode() {
  const adminUid = getAdminUid();
  if (!adminUid) return;
  await updateRuntimeConfig({ away_mode: false });
  return sendMarkdown(adminUid, '已关闭离开模式，恢复正常在线状态喵！');
}

export async function handleUserProfile(message) {
  const adminUid = getAdminUid();
  if (!adminUid) return;

  const mappedGuestId = await getMappedGuestId(message);
  const targetId = resolveTargetGuestId(message, mappedGuestId);
  if (!targetId) {
    return sendMarkdown(adminUid, '用法：回复客人留言发送 `/user`，或直接发送 `/user 用户ID`。');
  }

  const [profile, tag, blocked, violation] = await Promise.all([
    getGuestProfile(targetId),
    getGuestTag(targetId),
    isUserBlocked(targetId),
    kvGetJson(`keyword-violation-${targetId}`, null),
  ]);

  const lines = formatGuestProfile(profile || { userId: targetId }, tag, blocked, violation?.count);
  return sendMarkdown(adminUid, lines);
}

export async function handleTagGuest(message) {
  const adminUid = getAdminUid();
  if (!adminUid) return;

  const args = getCommandArgs(message).trim();
  const mappedGuestId = await getMappedGuestId(message);

  let targetId = mappedGuestId;
  let tagText = args;

  const parts = args.split(/\s+/);
  if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
    targetId = parts[0];
    tagText = parts.slice(1).join(' ');
  }

  if (!targetId) {
    return sendMarkdown(adminUid, '用法：回复一条客人留言发送 `/tag 备注名`，或发送 `/tag 用户ID 备注名`。输入 `/tag clear` 可清除。');
  }

  if (tagText.toLowerCase() === 'clear') {
    await setGuestTag(targetId, '');
    return sendMarkdown(adminUid, escapeMarkdown(`已清除 UID:${targetId} 的备注标签喵。`));
  }

  if (!tagText) {
    const currentTag = await getGuestTag(targetId);
    return sendMarkdown(adminUid, escapeMarkdown(`UID:${targetId} 当前备注：${currentTag || '无'}`));
  }

  await setGuestTag(targetId, tagText);
  return sendMarkdown(adminUid, escapeMarkdown(`已为 UID:${targetId} 设置备注标签「${tagText}」喵！`));
}

export async function sendAdminHelp(prefix = '') {
  const adminUid = getAdminUid();
  if (!adminUid) return;
  const lines = [
    prefix && escapeMarkdown(prefix),
    '*人偶管理手册*',
    '`/panel` 打开交互式控制面板',
    '`/stats` 查看工作数据统计',
    '`/user [UID]` 查看客人档案与画像',
    '`/tag [UID] [备注]` 为客人添加备注标签',
    '`/quick [标签]` 快捷短语回复客人',
    '`/quicks` 查看全部快捷短语',
    '`/addquick [标签] [内容]` 添加快捷短语',
    '`/delquick [标签]` 删除快捷短语',
    '`/away [说明]` 开启离开自动应答',
    '`/back` 恢复在线状态',
    '`/block [UID]` 静音客人',
    '`/unblock [UID]` 解除静音',
    '`/checkblock [UID]` 查看静音状态',
    '`/keywords` 查看关键词与正则列表',
    '`/addkeyword 规则` 添加关键词或正则',
    '`/delkeyword 规则` 删除关键词或正则',
    '`/synckeywords` 从远程同步关键词',
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
    'flood-blocked',
    'executable-blocked',
    'guest-command-warning',
    'blocked-user-message',
  ];
  const values = await Promise.all(names.map((name) => getStatCount(name)));
  const lines = names.map((name, index) => mdLine(name, String(values[index] ?? 0)));
  return sendMarkdown(adminUid, ['*人偶工作记录*', ...lines].join('\n'));
}
