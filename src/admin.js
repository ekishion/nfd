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
  }, { expirationTtl: 3600 });
}

export async function clearForceReplyPrompt(promptMessageId) {
  return kvPutJson(`force-reply-${promptMessageId}`, null, { expirationTtl: 60 });
}

export async function clearRepliedPrompt(message) {
  const promptId = message.reply_to_message?.message_id;
  if (!promptId) return;
  const record = await kvGetJson(`force-reply-${promptId}`, null);
  if (!record) return;
  const chatId = message.chat?.id;
  if (chatId) {
    await deleteMessage({ chat_id: chatId, message_id: promptId });
  }
  await clearForceReplyPrompt(promptId);
}

function getReplyContext(message) {
  const chatId = message?.chat?.id;
  const threadId = message?.message_thread_id;
  const extra = {
    reply_parameters: { message_id: message?.message_id },
    ...(threadId ? { message_thread_id: threadId } : {}),
  };
  return { chatId, threadId, extra };
}

export async function handleAdminMessage(message, command) {
  const { chatId, threadId, extra } = getReplyContext(message);
  if (!chatId) return;

  if (command === '/help') return sendAdminHelp(chatId, extra);
  if (command === '/panel' || command === '/config') {
    return sendSettingPanel(chatId, 'moderation', extra);
  }
  if (command === '/stats') return sendStats(chatId, extra);
  if (command === '/keywords') return listKeywords(chatId, extra);
  if (command === '/addkeyword') return addKeyword(message);
  if (command === '/delkeyword') return deleteKeyword(message);
  if (command === '/synckeywords') return syncKeywordDb(chatId, extra);

  if (command === '/block') return handleBlock(message);
  if (command === '/unblock') return handleUnBlock(message);
  if (command === '/checkblock') return checkBlock(message);

  if (command === '/quick' || command === '/q') return handleQuickReply(message);
  if (command === '/quicks') return handleListQuickReplies(chatId, extra);
  if (command === '/addquick') return handleAddQuickReply(message);
  if (command === '/delquick') return handleDeleteQuickReply(message);

  if (command === '/away') return handleAwayMode(message);
  if (command === '/back') return handleBackMode(chatId, extra);
  if (command === '/user') return handleUserProfile(message);
  if (command === '/tag') return handleTagGuest(message);

  const guestChatId = await getMappedGuestId(message);
  if (!guestChatId) {
    return sendAdminHelp(chatId, extra, '请先回复一条人偶转来的留言，或发送管理命令。');
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
    return sendMarkdown(chatId, escapeMarkdown(`人偶已经转达给 UID:${guestChatId} 了喵`), {
      ...extra,
      reply_markup: revokeReplyKeyboard(guestChatId, copied.result.message_id),
    });
  }

  await clearRepliedPrompt(message);
  return sendMarkdown(chatId, escapeMarkdown(`转达失败：${copied.description || 'Unknown error'}`), extra);
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
    `warn-admin-cmd-${chatId}`,
    '这个指令是人偶管理人用的喵，请直接发送你想留言的内容即可。',
    getCommandWarningCooldownMs(),
  );
}

export async function onCallbackQuery(callbackQuery) {
  const fromId = String(callbackQuery.from?.id || '');
  const adminUid = getAdminUid();
  const chatId = callbackQuery.message?.chat?.id || adminUid;
  const threadId = callbackQuery.message?.message_thread_id;
  const extra = threadId ? { message_thread_id: threadId } : {};

  if (!adminUid || fromId !== adminUid) {
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
      chatId,
      `请回复这条消息，人偶会转达给 UID:${guestChatId} 喵。`,
      {
        ...extra,
        reply_markup: { force_reply: true, selective: true },
      },
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
    await sendMarkdown(chatId, lines, extra);
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
      return sendMarkdown(chatId, escapeMarkdown(`已将 UID:${guestChatId} 放入静音抽屉喵`), extra);
    }
    if (data === 'unblock') {
      await setUserBlocked(guestChatId, false);
      await answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: `已将 UID:${guestChatId} 从静音抽屉取出。`,
      });
      return sendMarkdown(chatId, escapeMarkdown(`已将 UID:${guestChatId} 从静音抽屉取出喵`));
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
      return sendMarkdown(chatId, escapeMarkdown(`已帮管理人撤回发给 UID:${guestChatId} 的上一条消息喵`), extra);
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
      await deleteMessage({ chat_id: chatId, message_id: adminMessageId });
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
  const { chatId, extra } = getReplyContext(message);
  if (!chatId) return;

  const mappedGuestId = await getMappedGuestId(message);
  const guestChatId = resolveTargetGuestId(message, mappedGuestId);
  if (!guestChatId) return sendAdminHelp(chatId, extra, '用法：回复一条客人的留言发送 /block，或直接发送 `/block 用户ID`。');

  await setUserBlocked(guestChatId, true);
  return sendMarkdown(chatId, escapeMarkdown(`已将 UID:${guestChatId} 放入静音抽屉喵`), extra);
}

export async function handleUnBlock(message) {
  const { chatId, extra } = getReplyContext(message);
  if (!chatId) return;

  const mappedGuestId = await getMappedGuestId(message);
  const guestChatId = resolveTargetGuestId(message, mappedGuestId);
  if (!guestChatId) return sendAdminHelp(chatId, extra, '用法：回复一条客人的留言发送 /unblock，或直接发送 `/unblock 用户ID`。');

  await setUserBlocked(guestChatId, false);
  return sendMarkdown(chatId, escapeMarkdown(`已将 UID:${guestChatId} 从静音抽屉取出喵`), extra);
}

export async function checkBlock(message) {
  const { chatId, extra } = getReplyContext(message);
  if (!chatId) return;

  const mappedGuestId = await getMappedGuestId(message);
  const guestChatId = resolveTargetGuestId(message, mappedGuestId);
  if (!guestChatId) return sendAdminHelp(chatId, extra, '用法：回复一条客人的留言发送 /checkblock，或直接发送 `/checkblock 用户ID`。');

  const blocked = await isUserBlocked(guestChatId);
  return sendMarkdown(chatId, escapeMarkdown(`UID:${guestChatId} ${blocked ? '正在静音抽屉里' : '可以正常留言'}`), extra);
}

export async function handleQuickReply(message) {
  const { chatId, extra } = getReplyContext(message);
  if (!chatId) return;

  const args = getCommandArgs(message).trim();
  if (!args) {
    return sendMarkdown(chatId, '用法：`/quick 标签名`（可简写为 `/q 标签名`）。发送 `/quicks` 可查看已存短语。', extra);
  }

  const mappedGuestId = await getMappedGuestId(message);
  if (!mappedGuestId) {
    return sendMarkdown(chatId, '请先回复客人的留言后再使用快捷短语转达喵。', extra);
  }

  const quickText = await getQuickReply(args);
  if (!quickText) {
    return sendMarkdown(chatId, escapeMarkdown(`未找到标签为「${args}」的快捷短语喵。使用 /addquick ${args} 内容 来添加。`), extra);
  }

  const sent = await sendPlainText(mappedGuestId, quickText);
  if (sent.ok) {
    await incrementStat('admin-replied');
    await kvPutJson(`last-reply-${mappedGuestId}`, {
      chatId: String(mappedGuestId),
      messageId: sent.result.message_id,
      adminMessageId: message.message_id,
      createdAt: Date.now(),
    });
    return sendMarkdown(chatId, escapeMarkdown(`已通过快捷短语「${args}」转达给 UID:${mappedGuestId} 喵`), {
      ...extra,
      reply_markup: revokeReplyKeyboard(mappedGuestId, sent.result.message_id),
    });
  }

  return sendMarkdown(chatId, escapeMarkdown(`快捷回复转达失败：${sent.description || 'Unknown error'}`), extra);
}

export async function handleListQuickReplies(chatId, extra = {}) {
  if (!chatId) return;
  const list = await listQuickReplies();
  if (!list.length) {
    return sendMarkdown(chatId, '目前还没有添加快捷短语喵。使用 `/addquick 标签 文本内容` 添加。', extra);
  }
  const lines = list.map((tag) => `\\- \`${escapeMarkdown(tag)}\``);
  return sendMarkdown(chatId, ['*已保存的快捷短语标签*', ...lines, '', '使用 `/quick 标签` 直接回复客人喵。'].join('\n'), extra);
}

export async function handleAddQuickReply(message) {
  const { chatId, extra } = getReplyContext(message);
  if (!chatId) return;
  const args = getCommandArgs(message).trim();
  const firstSpace = args.search(/\s/);
  if (firstSpace === -1) {
    return sendMarkdown(chatId, '用法：`/addquick 标签 快捷文本内容`', extra);
  }
  const tag = args.slice(0, firstSpace).trim();
  const content = args.slice(firstSpace).trim();
  if (!tag || !content) {
    return sendMarkdown(chatId, '用法：`/addquick 标签 快捷文本内容`', extra);
  }
  await setQuickReply(tag, content);
  return sendMarkdown(chatId, escapeMarkdown(`已添加快捷短语「${tag}」喵！`), extra);
}

export async function handleDeleteQuickReply(message) {
  const { chatId, extra } = getReplyContext(message);
  if (!chatId) return;
  const tag = getCommandArgs(message).trim();
  if (!tag) {
    return sendMarkdown(chatId, '用法：`/delquick 标签`', extra);
  }
  await deleteQuickReply(tag);
  return sendMarkdown(chatId, escapeMarkdown(`已删除快捷短语「${tag}」喵。`), extra);
}

export async function handleAwayMode(message) {
  const { chatId, extra } = getReplyContext(message);
  if (!chatId) return;
  const customMsg = getCommandArgs(message).trim();
  const patch = { away_mode: true };
  if (customMsg) {
    patch.away_message = customMsg;
  }
  await updateRuntimeConfig(patch);
  const note = customMsg ? `已设置离开提示文案：\n「${customMsg}」` : '已开启离开自动应答模式。';
  return sendMarkdown(chatId, escapeMarkdown(`${note}\n发送 /back 可恢复在线状态喵。`), extra);
}

export async function handleBackMode(chatId, extra = {}) {
  if (!chatId) return;
  await updateRuntimeConfig({ away_mode: false });
  return sendMarkdown(chatId, '已关闭离开模式，恢复正常在线状态喵！', extra);
}

export async function handleUserProfile(message) {
  const { chatId, extra } = getReplyContext(message);
  if (!chatId) return;

  const mappedGuestId = await getMappedGuestId(message);
  const targetId = resolveTargetGuestId(message, mappedGuestId);
  if (!targetId) {
    return sendMarkdown(chatId, '用法：回复客人留言发送 `/user`，或直接发送 `/user 用户ID`。', extra);
  }

  const [profile, tag, blocked, violation] = await Promise.all([
    getGuestProfile(targetId),
    getGuestTag(targetId),
    isUserBlocked(targetId),
    kvGetJson(`keyword-violation-${targetId}`, null),
  ]);

  const lines = formatGuestProfile(profile || { userId: targetId }, tag, blocked, violation?.count);
  return sendMarkdown(chatId, lines, extra);
}

export async function handleTagGuest(message) {
  const { chatId, extra } = getReplyContext(message);
  if (!chatId) return;

  const args = getCommandArgs(message).trim();
  const mappedGuestId = await getMappedGuestId(message);

  let targetId = mappedGuestId;
  let tagValue = args;

  const match = args.match(/^(\d+)\s+(.+)$/);
  if (match) {
    targetId = match[1];
    tagValue = match[2].trim();
  }

  if (!targetId) {
    return sendMarkdown(chatId, '用法：回复客人留言发送 `/tag 备注名`，或发送 `/tag 用户ID 备注名`。输入 `/tag clear` 可清除备注。', extra);
  }

  if (tagValue.toLowerCase() === 'clear' || tagValue === '清除') {
    await setGuestTag(targetId, '');
    return sendMarkdown(chatId, escapeMarkdown(`已清除 UID:${targetId} 的备注标签喵。`), extra);
  }

  if (!tagValue) {
    const currentTag = await getGuestTag(targetId);
    return sendMarkdown(chatId, escapeMarkdown(`UID:${targetId} 当前备注：${currentTag || '无'}`), extra);
  }

  await setGuestTag(targetId, tagValue);
  return sendMarkdown(chatId, escapeMarkdown(`已为 UID:${targetId} 设置备注标签「${tagValue}」喵！`), extra);
}

export async function sendAdminHelp(chatId, extra = {}, prefix = '') {
  const lines = [
    prefix ? `*${escapeMarkdown(prefix)}*\n` : '',
    '*人偶管理手册*',
    '• 直接回复转达的留言即可回信给对应客人',
    '• 发送 `/panel` 或 `/config` 可打开交互式控制面板',
    '• 发送 `/stats` 可查看今日统计与各项拦截指标',
    '• 发送 `/user` 或 `/user UID` 可查看客人画像与违规记录',
    '• 发送 `/tag 备注` 或 `/tag UID 备注` 可为客户设置身份标签',
    '• 发送 `/quick 标签`（或 `/q`）可一键调用快捷短语回复',
    '• 发送 `/quicks` / `/addquick` / `/delquick` 管理快捷短语',
    '• 发送 `/away [离线文案]` / `/back` 管理离开自动应答',
    '• 发送 `/block [UID]` 可将客人加入静音抽屉',
    '• 发送 `/unblock [UID]` 可移出静音抽屉',
    '• 发送 `/checkblock [UID]` 可检查是否在静音抽屉',
    '• 发送 `/keywords` 可查看当前拦截规则与正则表达式',
    '• 发送 `/addkeyword <词或/正则/i>` 可添加屏蔽规则',
    '• 发送 `/delkeyword <规则>` 可删除屏蔽规则',
    '• 发送 `/synckeywords` 可从远程数据库同步规则',
  ].filter(Boolean);

  return sendMarkdown(chatId, lines.join('\n'), extra);
}

export async function sendStats(chatId, extra = {}) {
  const now = new Date();
  const dateKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

  const [
    guestMessages,
    adminReplies,
    blockedUsers,
    keywordBlocked,
    autoBlocked,
    noUsernameBlocked,
    noPhotoBlocked,
    executableBlocked,
    commandWarnings,
  ] = await Promise.all([
    getStatCount('guest-message', dateKey),
    getStatCount('admin-replied', dateKey),
    getStatCount('blocked-user-message', dateKey),
    getStatCount('keyword-blocked', dateKey),
    getStatCount('keyword-auto-blocked', dateKey),
    getStatCount('no-username-blocked', dateKey),
    getStatCount('no-photo-blocked', dateKey),
    getStatCount('executable-blocked', dateKey),
    getStatCount('guest-command-warning', dateKey),
  ]);

  const lines = [
    `*人偶今日运行统计* \\(${escapeMarkdown(dateKey)} UTC\\)`,
    mdLine('收到客人留言', guestMessages),
    mdLine('管理人已回信', adminReplies),
    mdLine('静音名单拦截', blockedUsers),
    mdLine('敏感词规则拦截', keywordBlocked),
    mdLine('敏感词自动拉黑', autoBlocked),
    mdLine('无用户名拦截', noUsernameBlocked),
    mdLine('无头像拦截', noPhotoBlocked),
    mdLine('危险文件拦截', executableBlocked),
    mdLine('误触指令提醒', commandWarnings),
  ];

  return sendMarkdown(chatId, lines.join('\n'), extra);
}

export async function listKeywords(chatId, extra = {}) {
  const rules = await getKeywordRules();
  if (!rules.length) {
    return sendMarkdown(chatId, '目前还没有配置敏感词屏蔽规则喵。', extra);
  }
  const lines = rules.map((k) => `\\- \`${escapeMarkdown(k)}\``);
  return sendMarkdown(chatId, ['*当前生效的拦截规则清单*', ...lines].join('\n'), extra);
}

export async function addKeyword(message) {
  const { chatId, extra } = getReplyContext(message);
  if (!chatId) return;

  const rawArg = getCommandArgs(message).trim();
  if (!rawArg) {
    return sendMarkdown(chatId, '用法：`/addkeyword 违规词` 或 `/addkeyword /正则/i`', extra);
  }

  if (rawArg.startsWith('/') && rawArg.lastIndexOf('/') > 0) {
    const match = rawArg.match(/^\/(.+)\/([a-z]*)$/i);
    if (match) {
      try {
        new RegExp(match[1], match[2]);
      } catch (err) {
        return sendMarkdown(chatId, escapeMarkdown(`正则表达式语法错误: ${err.message}`), extra);
      }
    }
  }

  const current = await getKeywordRules();
  if (current.includes(rawArg)) {
    return sendMarkdown(chatId, escapeMarkdown(`规则「${rawArg}」已经在清单里了喵`), extra);
  }

  const updated = [...current, rawArg];
  await cachedKvPutJson('keyword-rules', updated, {}, 3600000);
  return sendMarkdown(chatId, escapeMarkdown(`已成功添加拦截规则「${rawArg}」喵！`), extra);
}

export async function deleteKeyword(message) {
  const { chatId, extra } = getReplyContext(message);
  if (!chatId) return;

  const rawArg = getCommandArgs(message).trim();
  if (!rawArg) {
    return sendMarkdown(chatId, '用法：`/delkeyword 规则名称`', extra);
  }

  const current = await getKeywordRules();
  const index = current.indexOf(rawArg);
  if (index === -1) {
    return sendMarkdown(chatId, escapeMarkdown(`在清单里没有找到规则「${rawArg}」喵`), extra);
  }

  current.splice(index, 1);
  await cachedKvPutJson('keyword-rules', current, {}, 3600000);
  return sendMarkdown(chatId, escapeMarkdown(`已将规则「${rawArg}」从清单中移除喵`), extra);
}

export async function syncKeywordDb(chatId, extra = {}) {
  if (!chatId) return;
  const remote = await fetchKeywordDb();
  if (!remote || !remote.length) {
    return sendMarkdown(chatId, '未能从远程数据库获取到关键词规则喵。', extra);
  }
  const current = await getKeywordRules();
  const merged = Array.from(new Set([...current, ...remote]));
  await cachedKvPutJson('keyword-rules', merged, {}, 3600000);
  return sendMarkdown(chatId, escapeMarkdown(`已完成同步，当前共有 ${merged.length} 条拦截规则生效喵！`), extra);
}
