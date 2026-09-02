// ==============================================================================
// src/pipeline.js - Message Buffering, Delayed Aggregation & Batch Forwarding
// ==============================================================================

import {
  MESSAGE_MAP_TTL,
  NOTIFY_INTERVAL,
  DEFAULT_NOTIFICATION,
  getAdminUid,
  getUserAckCooldownMs,
  getCommandWarningCooldownMs,
  getNotificationUrl,
  asArray,
  sleep,
} from './config.js';
import {
  cachedKvGetJson,
  cachedKvPutJson,
  getMemoryCache,
  setMemoryCache,
  kvGetJson,
  kvPutJson,
  getRuntimeConfig,
  incrementStat,
  sendCooldownPlainText,
  isFraud,
  fetchTextOrDefault,
} from './cache.js';
import {
  sendMarkdown,
  copyMessage,
  forwardMessage,
  mdLine,
  buildMessageInfo,
  buildGuestInfo,
  adminMessageKeyboard,
} from './telegram.js';
import {
  isUserBlocked,
  setUserBlocked,
  checkUserHasPhoto,
  findBlockedKeyword,
  recordKeywordViolation,
  notifyKeywordBlocked,
} from './moderation.js';

export async function rememberGuestInfo(message) {
  const chatId = String(message.chat.id);
  const key = `guest-info-${chatId}`;
  const previous = await cachedKvGetJson(key, 300000, null);
  const next = {
    ...buildGuestInfo(message),
    firstSeenAt: previous?.firstSeenAt || Date.now(),
  };
  await cachedKvPutJson(key, next, {}, 300000);
  return next;
}

export async function rememberMessageMap(adminMessageId, guestChatId) {
  setMemoryCache(`msg-map-${adminMessageId}`, String(guestChatId), 3600000);
  return kvPutJson(`msg-map-${adminMessageId}`, String(guestChatId), {
    expirationTtl: MESSAGE_MAP_TTL,
  });
}

export async function getMappedGuestId(adminMessage) {
  const replyMessageId = adminMessage?.reply_to_message?.message_id;
  if (!replyMessageId) return null;
  const cached = getMemoryCache(`msg-map-${replyMessageId}`);
  if (cached) return cached;
  return kvGetJson(`msg-map-${replyMessageId}`, null);
}

export async function handleGuestMessage(message) {
  const chatId = String(message.chat.id);
  const config = await getRuntimeConfig();
  const warningCooldown = getCommandWarningCooldownMs();

  // Parallelize non-dependent analytics and info recording with user check
  const [isBlocked] = await Promise.all([
    isUserBlocked(chatId),
    incrementStat('guest-message'),
    rememberGuestInfo(message),
  ]);

  if (isBlocked) {
    await incrementStat('blocked-user-message');
    return sendCooldownPlainText(chatId, `blocked-notice-${chatId}`, '这里暂时不能继续留言了喵。', warningCooldown);
  }

  if (config.req_username && !message.from?.username) {
    await incrementStat('no-username-blocked');
    return sendCooldownPlainText(
      chatId,
      `no-username-${chatId}`,
      '请先在 Telegram 设置用户名（Username / @xxx）后再留言喵。',
      warningCooldown,
    );
  }

  if (config.req_photo) {
    const userId = message.from?.id || message.chat.id;
    const hasPhoto = await checkUserHasPhoto(userId);
    if (!hasPhoto) {
      await incrementStat('no-photo-blocked');
      return sendCooldownPlainText(
        chatId,
        `no-photo-${chatId}`,
        '请先在 Telegram 设置个人头像后再留言喵。',
        warningCooldown,
      );
    }
  }

  if (config.delay_seconds > 0) {
    return handleDelayedGuestMessage(message, config);
  }

  return processGuestMessageBatch([message], config);
}

export async function handleDelayedGuestMessage(message, config) {
  const chatId = String(message.chat.id);
  const batchKey = `pending-msgs-${chatId}`;
  const tokenKey = `pending-token-${chatId}`;

  const current = asArray(await kvGetJson(batchKey, []));
  if (!current.some((m) => m.message_id === message.message_id)) {
    current.push(message);
  }

  const token = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await kvPutJson(batchKey, current, { expirationTtl: 300 });
  await kvPutJson(tokenKey, token, { expirationTtl: 300 });

  if (current.length >= 10) {
    await kvPutJson(batchKey, null, { expirationTtl: 60 });
    await kvPutJson(tokenKey, null, { expirationTtl: 60 });
    return processGuestMessageBatch(current, config);
  }

  await sleep(config.delay_seconds * 1000);

  const activeToken = await kvGetJson(tokenKey, null);
  if (activeToken !== token) {
    return;
  }

  const finalBatch = asArray(await kvGetJson(batchKey, []));
  await kvPutJson(batchKey, null, { expirationTtl: 60 });
  await kvPutJson(tokenKey, null, { expirationTtl: 60 });

  if (!finalBatch.length) return;
  return processGuestMessageBatch(finalBatch, config);
}

export async function processGuestMessageBatch(messages, config = null) {
  if (!messages || !messages.length) return;
  if (!config) config = await getRuntimeConfig();

  const firstMessage = messages[0];
  const chatId = String(firstMessage.chat.id);
  const adminUid = getAdminUid();

  const isBlocked = await isUserBlocked(chatId);
  if (isBlocked) {
    await incrementStat('blocked-user-message');
    return;
  }

  let blockedKeyword = '';
  let violatingMessage = null;
  for (const msg of messages) {
    const kw = await findBlockedKeyword(msg);
    if (kw) {
      blockedKeyword = kw;
      violatingMessage = msg;
      break;
    }
  }

  if (blockedKeyword) {
    const targetMsg = violatingMessage || firstMessage;
    const violation = await recordKeywordViolation(targetMsg, blockedKeyword);
    if (config.auto_block && violation.count >= config.violation_limit) {
      await setUserBlocked(chatId, true);
      await incrementStat('keyword-auto-blocked');
    }
    await notifyKeywordBlocked(targetMsg, blockedKeyword, violation, config);
    if (config.notice_user) {
      const text = violation.count >= config.violation_limit
        ? '多次发送不能转达的内容，这里暂时不能继续留言了喵。'
        : '这条留言含有暂时不能转达的词，人偶先收起来了喵。';
      return sendCooldownPlainText(chatId, `keyword-notice-${chatId}`, text, getCommandWarningCooldownMs());
    }
    return;
  }

  if (!adminUid) {
    console.log(JSON.stringify({ error: 'no-admin-uid-configured', chatId }));
    return;
  }

  const infoReq = await sendMarkdown(adminUid, buildMessageInfo(firstMessage, messages.length));
  if (infoReq.ok) {
    await rememberMessageMap(infoReq.result.message_id, chatId);
  }

  let deliveredAny = false;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const isLast = i === messages.length - 1;
    const extra = isLast ? { reply_markup: adminMessageKeyboard() } : {};

    const copyReq = await copyMessage({
      chat_id: adminUid,
      from_chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...extra,
    });

    if (copyReq.ok) {
      deliveredAny = true;
      await rememberMessageMap(copyReq.result.message_id, chatId);
      continue;
    }

    const forwardReq = await forwardMessage({
      chat_id: adminUid,
      from_chat_id: msg.chat.id,
      message_id: msg.message_id,
    });

    if (forwardReq.ok) {
      deliveredAny = true;
      await rememberMessageMap(forwardReq.result.message_id, chatId);
      continue;
    }

    await sendMarkdown(
      adminUid,
      [
        '*人偶转达失败*',
        mdLine('用户ID', chatId),
        mdLine('错误', forwardReq.description || copyReq.description || 'Unknown error'),
      ].join('\n'),
    );
  }

  if (deliveredAny) {
    await handleGuestDelivered(messages[messages.length - 1], config);
  }
}

export async function handleGuestDelivered(message, config = null) {
  const chatId = String(message.chat.id);
  await sendCooldownPlainText(
    chatId,
    `deliver-ack-${chatId}`,
    '留言已经交给管理人啦，人偶会乖乖等回信喵。',
    getUserAckCooldownMs(),
  );
  await handleNotify(message, config);
}

export async function handleNotify(message, config = null) {
  if (!config) config = await getRuntimeConfig();
  const chatId = String(message.chat.id);
  const adminUid = getAdminUid();
  if (!adminUid) return;

  if (await isFraud(chatId)) {
    return sendMarkdown(adminUid, `*诈骗库命中*\n${mdLine('UID', chatId)}`);
  }

  if (!config.enable_notify) return;

  const lastMsgTime = await kvGetJson(`lastmsg-${chatId}`, 0);
  if (!lastMsgTime || Date.now() - Number(lastMsgTime) > NOTIFY_INTERVAL) {
    await nfd.put(`lastmsg-${chatId}`, String(Date.now()));
    const notification = await fetchTextOrDefault(getNotificationUrl(), DEFAULT_NOTIFICATION);
    return sendMarkdown(adminUid, notification);
  }
}
