// ==============================================================================
// src/pipeline.js - Message Buffering, Delayed Aggregation & Batch Forwarding
// ==============================================================================

import {
  MESSAGE_MAP_TTL,
  NOTIFY_INTERVAL,
  MAX_INLINE_DELAY_SECONDS,
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
  kvGetText,
  kvPutText,
  kvList,
  getRuntimeConfig,
  incrementStat,
  sendCooldownPlainText,
  isFraud,
  fetchTextOrDefault,
  getGuestTag,
  trackGuestProfile,
  getGuestTopicId,
  setGuestTopicId,
  getGuestIdByTopic,
} from './cache.js';
import {
  sendMarkdown,
  copyMessage,
  forwardMessage,
  mdLine,
  buildMessageInfo,
  buildUserName,
  getSenderKey,
  adminMessageKeyboard,
  createForumTopic,
} from './telegram.js';
import {
  isUserBlocked,
  setUserBlocked,
  checkUserHasPhoto,
  findBlockedKeyword,
  recordKeywordViolation,
  notifyKeywordBlocked,
  checkFloodLimit,
  isDangerousDocument,
} from './moderation.js';
import { dispatchNotification } from './notifiers/index.js';

export async function rememberMessageMap(adminMessageId, guestChatId) {
  setMemoryCache(`msg-map-${adminMessageId}`, String(guestChatId), 3600000);
  return kvPutJson(`msg-map-${adminMessageId}`, String(guestChatId), {
    expirationTtl: MESSAGE_MAP_TTL,
  });
}

export async function getMappedGuestId(adminMessage) {
  // 1. Check if message is sent inside a Forum Topic
  const threadId = adminMessage?.message_thread_id;
  if (threadId) {
    const topicGuestId = await getGuestIdByTopic(threadId);
    if (topicGuestId) return topicGuestId;
  }

  // 2. Check reply message ID mapping
  const replyMessageId = adminMessage?.reply_to_message?.message_id;
  if (!replyMessageId) return null;
  const cached = getMemoryCache(`msg-map-${replyMessageId}`);
  if (cached) return cached;
  return kvGetJson(`msg-map-${replyMessageId}`, null);
}

export async function handleGuestMessage(message) {
  // 群聊/频道来源按实际发送者区分身份；回执与警告仍发回来源会话（成员可能禁止陌生私信）
  const senderKey = getSenderKey(message);
  const sourceChatId = String(message.chat.id);
  const config = await getRuntimeConfig();
  const warningCooldown = getCommandWarningCooldownMs();

  // Parallelize analytics, profile update and user check
  const [isBlocked] = await Promise.all([
    isUserBlocked(senderKey),
    incrementStat('guest-message').catch(() => {}),
    trackGuestProfile(message, senderKey).catch(() => {}),
  ]);

  if (isBlocked) {
    await incrementStat('blocked-user-message').catch(() => {});
    return sendCooldownPlainText(sourceChatId, `blocked-notice-${senderKey}`, '这里暂时不能继续留言了喵。', warningCooldown);
  }

  // Anti-Flood / Rate Limiting
  const floodCheck = await checkFloodLimit(senderKey, config);
  if (floodCheck.blocked) {
    await dispatchNotification('security_alert', {
      reason: '防刷屏频控静音',
      senderId: senderKey,
      senderName: buildUserName(message.from || {}),
      detail: `触发防刷屏频控限制，已静音 ${floodCheck.remainingSeconds || 60} 秒`,
    });
    return sendCooldownPlainText(
      sourceChatId,
      `flood-notice-${senderKey}`,
      `发送消息太频繁啦，请休息 ${floodCheck.remainingSeconds || 60} 秒后再试喵。`,
      warningCooldown,
    );
  }

  // Dangerous document filter
  if (config.block_executables && isDangerousDocument(message)) {
    await incrementStat('executable-blocked').catch(() => {});
    await dispatchNotification('security_alert', {
      reason: '危险可执行文件拦截',
      senderId: senderKey,
      senderName: buildUserName(message.from || {}),
      detail: `文件: ${message.document?.file_name || '未知文件名'} (${message.document?.mime_type || '未知类型'})`,
    });
    return sendCooldownPlainText(
      sourceChatId,
      `exec-block-${senderKey}`,
      '抱歉，为了系统安全，不能转达可执行程序或安装包文件喵。',
      warningCooldown,
    );
  }

  if (config.req_username && !message.from?.username) {
    await incrementStat('no-username-blocked').catch(() => {});
    return sendCooldownPlainText(
      sourceChatId,
      `no-username-${senderKey}`,
      '请先在 Telegram 设置用户名（Username / @xxx）后再留言喵。',
      warningCooldown,
    );
  }

  if (config.req_photo) {
    const hasPhoto = await checkUserHasPhoto(senderKey);
    if (!hasPhoto) {
      await incrementStat('no-photo-blocked').catch(() => {});
      return sendCooldownPlainText(
        sourceChatId,
        `no-photo-${senderKey}`,
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
  // 批次按发送者拆分，避免监听群里不同成员的消息混入同一批
  const senderKey = getSenderKey(message);
  const batchKey = `pending-msgs-${senderKey}`;
  const tokenKey = `pending-token-${senderKey}`;

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

  // Worker waitUntil 墙钟有限，内联最多等 MAX_INLINE_DELAY_SECONDS；若 isolate 提前被回收，
  // 遗留批次由 scheduled 触发 flushStalePendingBatches 兜底补发
  await sleep(Math.min(config.delay_seconds, MAX_INLINE_DELAY_SECONDS) * 1000);

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
  const senderKey = getSenderKey(firstMessage);
  const sourceChatId = String(firstMessage.chat.id);
  const forwardChatId = config.forward_chat_id || getAdminUid();

  const isBlocked = await isUserBlocked(senderKey);
  if (isBlocked) {
    await incrementStat('blocked-user-message').catch(() => {});
    return;
  }

  let blockedResult = null;
  let violatingMessage = null;
  for (const msg of messages) {
    const match = await findBlockedKeyword(msg);
    if (match && match.matched) {
      blockedResult = match;
      violatingMessage = msg;
      break;
    }
  }

  if (blockedResult) {
    const targetMsg = violatingMessage || firstMessage;
    const violation = await recordKeywordViolation(targetMsg, blockedResult.rule);
    if (config.auto_block && violation.count >= config.violation_limit) {
      await setUserBlocked(senderKey, true);
      await incrementStat('keyword-auto-blocked').catch(() => {});
    }
    await notifyKeywordBlocked(targetMsg, blockedResult, violation, config);
    if (config.notice_user) {
      const text = violation.count >= config.violation_limit
        ? '多次发送不能转达的内容，这里暂时不能继续留言了喵。'
        : '这条留言含有暂时不能转达的词，人偶先收起来了喵。';
      return sendCooldownPlainText(sourceChatId, `keyword-notice-${senderKey}`, text, getCommandWarningCooldownMs());
    }
    return;
  }

  if (!forwardChatId) {
    console.log(JSON.stringify({ error: 'no-forward-chat-id-configured', senderKey }));
    return;
  }

  let targetThreadId = config.forward_thread_id || null;

  // Auto-create Forum Topic if enabled for supergroup
  if (config.enable_forum_topics && forwardChatId.startsWith('-')) {
    let topicId = await getGuestTopicId(senderKey);
    if (!topicId) {
      const senderName = buildUserName(firstMessage.from || {}) || firstMessage.chat?.title || '匿名来源';
      const topicName = `${senderName} (${senderKey})`.slice(0, 128);
      const createRes = await createForumTopic({
        chat_id: forwardChatId,
        name: topicName,
      });
      if (createRes.ok && createRes.result?.message_thread_id) {
        topicId = createRes.result.message_thread_id;
        await setGuestTopicId(senderKey, topicId);
      }
    }
    if (topicId) {
      targetThreadId = topicId;
    }
  }

  const threadParam = targetThreadId ? { message_thread_id: targetThreadId } : {};
  const guestTag = await getGuestTag(senderKey);
  const infoReq = await sendMarkdown(
    forwardChatId,
    buildMessageInfo(firstMessage, messages.length, guestTag),
    threadParam,
  );
  if (infoReq.ok) {
    await rememberMessageMap(infoReq.result.message_id, senderKey);
  }

  let deliveredAny = false;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const isLast = i === messages.length - 1;
    const extra = {
      ...threadParam,
      ...(isLast ? { reply_markup: adminMessageKeyboard() } : {}),
    };

    const copyReq = await copyMessage({
      chat_id: forwardChatId,
      from_chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...extra,
    });

    if (copyReq.ok) {
      deliveredAny = true;
      await rememberMessageMap(copyReq.result.message_id, senderKey);
      continue;
    }

    const forwardReq = await forwardMessage({
      chat_id: forwardChatId,
      from_chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...threadParam,
    });

    if (forwardReq.ok) {
      deliveredAny = true;
      await rememberMessageMap(forwardReq.result.message_id, senderKey);
      continue;
    }

    await sendMarkdown(
      forwardChatId,
      [
        '*人偶转达失败*',
        mdLine('用户ID', senderKey),
        mdLine('错误', forwardReq.description || copyReq.description || 'Unknown error'),
      ].join('\n'),
      threadParam,
    );
  }

  if (deliveredAny) {
    const guestName = (buildUserName(firstMessage.from || {}) || firstMessage.chat?.title || '匿名来源')
      + (guestTag ? ` [${guestTag}]` : '');
    const fullText = messages.map((m) => m.text || m.caption || '').filter(Boolean).join('\n');
    await dispatchNotification('guest_message', {
      senderId: senderKey,
      senderName: guestName,
      messageCount: messages.length,
      text: fullText,
    });
    await handleGuestDelivered(firstMessage, config);
  }
}

export async function handleGuestDelivered(message, config = null) {
  if (!config) config = await getRuntimeConfig();
  const senderKey = getSenderKey(message);
  const sourceChatId = String(message.chat.id);

  if (config.away_mode) {
    const awayMsg = config.away_message || '人偶现在外出中，稍后会尽快回复您的留言喵。';
    await sendCooldownPlainText(sourceChatId, `away-notice-${senderKey}`, awayMsg, 1800000); // 30 minutes cooldown
  }

  await sendCooldownPlainText(
    sourceChatId,
    `deliver-ack-${senderKey}`,
    '留言已经交给管理人啦，人偶会乖乖等回信喵。',
    getUserAckCooldownMs(),
  );
  await handleNotify(message, config);
}

export async function handleNotify(message, config = null) {
  if (!config) config = await getRuntimeConfig();
  const senderKey = getSenderKey(message);
  const sourceChatId = String(message.chat.id);
  const alertChatId = config.alert_chat_id || getAdminUid();
  if (!alertChatId) return;

  const extra = config.alert_thread_id ? { message_thread_id: config.alert_thread_id } : {};

  if (await isFraud(senderKey)) {
    await dispatchNotification('security_alert', {
      reason: '诈骗名单命中',
      senderId: senderKey,
      senderName: buildUserName(message.from || {}),
      detail: '命中本地/远程 fraud.db 诈骗黑名单',
    });
    return sendMarkdown(alertChatId, `*诈骗库命中*\n${mdLine('UID', senderKey)}`, extra);
  }

  if (!config.enable_notify) return;

  const lastMsgTime = Number(await kvGetText(`lastmsg-${senderKey}`, '0'));
  if (!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL) {
    await kvPutText(`lastmsg-${senderKey}`, String(Date.now()));
    const notification = await fetchTextOrDefault(getNotificationUrl(), DEFAULT_NOTIFICATION);
    return sendMarkdown(alertChatId, notification, extra);
  }
}

// 兜底清理：内联延迟等待被 Worker 生命周期中断时，遗留的待处理批次由 scheduled 触发补发
export async function flushStalePendingBatches(config = null) {
  if (!config) config = await getRuntimeConfig();
  const staleAfterMs = (Math.max(config.delay_seconds || 0, MAX_INLINE_DELAY_SECONDS) + 10) * 1000;
  const keys = await kvList('pending-msgs-');

  for (const key of keys) {
    const senderKey = String(key.name || '').replace(/^pending-msgs-/, '');
    if (!senderKey) continue;
    const batch = asArray(await kvGetJson(key.name, []));
    if (!batch.length) continue;

    const oldestMs = Math.min(...batch.map((m) => (m.date ? Number(m.date) * 1000 : Date.now())));
    if (Date.now() - oldestMs < staleAfterMs) continue;

    const tokenKey = `pending-token-${senderKey}`;
    const token = await kvGetJson(tokenKey, null);
    if (!token) continue; // 已被内联流程接管或处理完成

    // 先抢占 token 再清批次，避免与仍在等待的内联流程双发
    await kvPutJson(tokenKey, null, { expirationTtl: 60 });
    await kvPutJson(key.name, null, { expirationTtl: 60 });
    await processGuestMessageBatch(batch, config);
  }
}
