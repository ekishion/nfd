// ==============================================================================
// src/index.js - Cloudflare Worker Entry & Webhook Router
// Supports Cloudflare Git Auto-Deploy (Module Worker) & Legacy Service Worker
// ==============================================================================

import {
  WEBHOOK,
  ADMIN_COMMANDS,
  DEFAULT_START_MESSAGE,
  getSecret,
  getAdminUid,
  getForwardChatId,
  getAlertChatId,
  getStartMsgUrl,
} from './config.js';
import { fetchTextOrDefault, isDuplicateUpdate, getBotUsername } from './cache.js';
import { apiUrl, sendMarkdown, getCommand, formatStartMessage, leaveChat } from './telegram.js';
import { handleGuestMessage, getMappedGuestId } from './pipeline.js';
import { handleAdminMessage, handleGuestAdminCommand, onCallbackQuery } from './admin.js';

export async function handleFetch(request, env = null, ctx = null) {
  if (env) {
    Object.assign(globalThis, env);
  }

  const url = new URL(request.url);
  const secret = getSecret();

  if (url.pathname === WEBHOOK) {
    return handleWebhook(request, ctx);
  } else if (url.pathname === '/registerWebhook') {
    const providedSecret = url.searchParams.get('secret') || request.headers.get('X-Telegram-Bot-Api-Secret-Token') || request.headers.get('x-secret');
    if (!secret || providedSecret !== secret) {
      return new Response('Unauthorized: Secret required and mismatch', { status: 403 });
    }
    return registerWebhook(url);
  } else if (url.pathname === '/unRegisterWebhook') {
    const providedSecret = url.searchParams.get('secret') || request.headers.get('X-Telegram-Bot-Api-Secret-Token') || request.headers.get('x-secret');
    if (!secret || providedSecret !== secret) {
      return new Response('Unauthorized: Secret required and mismatch', { status: 403 });
    }
    return unRegisterWebhook();
  } else {
    return new Response('No handler for this request');
  }
}

export async function handleWebhook(request, ctx = null) {
  const secret = getSecret();
  if (secret && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
    return new Response('Unauthorized', { status: 403 });
  }

  const update = await request.json();
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(onUpdate(update));
  } else {
    onUpdate(update);
  }
  return new Response('Ok');
}

export async function onUpdate(update) {
  try {
    if (update.update_id && isDuplicateUpdate(update.update_id)) {
      return;
    }
    if (update.my_chat_member) {
      await onMyChatMember(update.my_chat_member);
    } else if (update.message) {
      await onMessage(update.message);
    } else if (update.callback_query) {
      await onCallbackQuery(update.callback_query);
    }
  } catch (err) {
    console.log(JSON.stringify({ error: 'onUpdate-failed', message: err.message, stack: err.stack }));
  }
}

export async function onMyChatMember(myChatMember) {
  const chat = myChatMember?.chat;
  if (!chat?.id) return;
  const isGroup = Boolean(chat.type && chat.type !== 'private');
  if (!isGroup) return;

  const forwardChatId = getForwardChatId();
  const alertChatId = getAlertChatId();
  const isAuthorized = (forwardChatId && String(chat.id) === forwardChatId) ||
                       (alertChatId && String(chat.id) === alertChatId);

  // 被拉入未授权的陌生群组或频道时，自动退出
  if (!isAuthorized) {
    const status = myChatMember.new_chat_member?.status;
    if (status === 'member' || status === 'administrator') {
      await leaveChat(chat.id).catch(() => {});
    }
  }
}

export async function onMessage(message) {
  if (!message?.chat?.id) return;

  const botUsername = await getBotUsername();
  const command = getCommand(message, botUsername);
  const isGroup = Boolean(message.chat.type && message.chat.type !== 'private');

  const adminUid = getAdminUid();
  const forwardChatId = getForwardChatId();
  const alertChatId = getAlertChatId();
  const isSenderAdmin = Boolean(adminUid && String(message.from?.id) === adminUid);
  const isPrivateAdminChat = Boolean(adminUid && String(message.chat.id) === adminUid);
  const isForwardChat = Boolean(forwardChatId && String(message.chat.id) === forwardChatId);
  const isAlertChat = Boolean(alertChatId && String(message.chat.id) === alertChatId);

  // 群聊 / 超级群 / 频道消息处理
  if (isGroup) {
    const isAuthorizedGroup = isForwardChat || isAlertChat;

    // 收到未授权陌生群聊消息时，自动退群
    if (!isAuthorizedGroup) {
      await leaveChat(message.chat.id).catch(() => {});
      return;
    }

    if (command === '/start') {
      if (isSenderAdmin) {
        return sendMarkdown(
          message.chat.id,
          '*管理人好喵*，这里是人偶！\n\n发送 `/panel` 可打开交互式控制面板，发送 `/help` 可查看管理手册。',
          message.message_thread_id ? { message_thread_id: message.message_thread_id } : {},
        );
      }
      return;
    }

    if (command) {
      // 管理指令仅允许管理员触发
      if (ADMIN_COMMANDS.has(command) && !isSenderAdmin) {
        return;
      }
      return handleAdminMessage(message, command);
    }

    // 判断是否在回复某位客人或在专属话题内发言
    const guestChatId = await getMappedGuestId(message);
    if (guestChatId) {
      return handleAdminMessage(message, '');
    }
    return;
  }

  // 私聊消息处理
  if (command === '/start') {
    if (isPrivateAdminChat || isSenderAdmin) {
      return sendMarkdown(
        message.chat.id,
        '*管理人好喵*，这里是人偶！\n\n发送 `/panel` 可打开交互式控制面板，发送 `/help` 可查看管理手册。',
      );
    }
    const startMsg = await fetchTextOrDefault(getStartMsgUrl(), DEFAULT_START_MESSAGE);
    return sendMarkdown(message.chat.id, formatStartMessage(startMsg, message.from || {}));
  }

  if (isPrivateAdminChat || isSenderAdmin) {
    return handleAdminMessage(message, command);
  }

  if (ADMIN_COMMANDS.has(command)) {
    return handleGuestAdminCommand(message, command);
  }

  return handleGuestMessage(message);
}

export async function registerWebhook(requestUrl) {
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${WEBHOOK}`;
  const secret = getSecret();
  const r = await fetch(apiUrl('setWebhook'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      drop_pending_updates: true,
    }),
  }).then((response) => response.json());

  const commands = [
    { command: 'panel', description: '控制面板' },
    { command: 'stats', description: '统计数据' },
    { command: 'user', description: '客人画像' },
    { command: 'tag', description: '客人备注' },
    { command: 'quick', description: '快捷回复' },
    { command: 'quicks', description: '短语列表' },
    { command: 'away', description: '离开模式' },
    { command: 'back', description: '恢复在线' },
    { command: 'block', description: '拉黑用户' },
    { command: 'unblock', description: '解除拉黑' },
    { command: 'keywords', description: '关键词列表' },
  ];
  await fetch(apiUrl('setMyCommands'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commands }),
  }).catch(() => {});

  return new Response(r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}

export async function unRegisterWebhook() {
  const r = await fetch(apiUrl('setWebhook'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: '' }),
  }).then((response) => response.json());
  return new Response(r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}

export default {
  async fetch(request, env, ctx) {
    return handleFetch(request, env, ctx);
  },
};
