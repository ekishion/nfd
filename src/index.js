// ==============================================================================
// src/index.js - Cloudflare Worker Entry & Webhook Router
// Supports Cloudflare Git Auto-Deploy (Module Worker) & Legacy Service Worker
// ==============================================================================

import {
  WEBHOOK,
  ADMIN_COMMANDS,
  ADMIN_GREETING,
  DEFAULT_START_MESSAGE,
  getSecret,
  getAdminUid,
  getForwardChatId,
  getAlertChatId,
  getListenChatIds,
} from './config.js';
import { isDuplicateUpdate, getBotUsername } from './cache.js';
import { fetchStartMessage } from './remote-text.js';
import { apiUrl, sendMarkdown, getCommand, formatStartMessage, leaveChat } from './telegram.js';
import { handleGuestMessage, getMappedGuestId, flushStalePendingBatches } from './pipeline.js';
import { handleAdminMessage, handleGuestAdminCommand, onCallbackQuery } from './admin.js';
import { registerBotCommands } from './commands.js';

let secretWarningLogged = false;
function warnMissingSecret() {
  if (secretWarningLogged) return;
  secretWarningLogged = true;
  console.log(JSON.stringify({ warning: 'ENV_BOT_SECRET 未配置，webhook 处于无鉴权状态，任何人都可以伪造更新请求' }));
}

async function leaveUnauthorizedChat(chat) {
  console.log(JSON.stringify({ event: 'auto-leave-unauthorized-chat', chatId: chat.id, chatType: chat.type || '' }));
  try {
    await leaveChat(chat.id);
  } catch (err) {
    console.log(JSON.stringify({ error: 'auto-leave-failed', chatId: chat.id, message: err.message }));
  }
}

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
  if (!secret) {
    warnMissingSecret();
  } else if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
    return new Response('Unauthorized', { status: 403 });
  }

  let update;
  try {
    update = await request.json();
  } catch (err) {
    // 仍返回 200，避免 Telegram 对异常载荷反复重试
    console.log(JSON.stringify({ error: 'webhook-invalid-json', message: err.message }));
    return new Response('Ok');
  }

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
    } else if (update.channel_post) {
      await onMessage(update.channel_post);
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

  const chatId = String(chat.id);
  const forwardChatId = getForwardChatId();
  const alertChatId = getAlertChatId();
  const isAuthorized = (forwardChatId && chatId === forwardChatId) ||
                       (alertChatId && chatId === alertChatId) ||
                       getListenChatIds().includes(chatId);

  // 被拉入未授权的陌生群组或频道时，自动退出
  if (!isAuthorized) {
    const status = myChatMember.new_chat_member?.status;
    if (status === 'member' || status === 'administrator') {
      await leaveUnauthorizedChat(chat);
    }
  }
}

export async function onMessage(message) {
  if (!message?.chat?.id) return;

  const chatId = String(message.chat.id);
  const isGroup = Boolean(message.chat.type && message.chat.type !== 'private');
  // 频道帖不参与命令解析，只保留回复转达留言的管理流（reply → 消息映射）
  const isChannel = message.chat.type === 'channel';

  const botUsername = await getBotUsername();
  const command = isChannel ? '' : getCommand(message, botUsername);

  const adminUid = getAdminUid();
  const forwardChatId = getForwardChatId();
  const alertChatId = getAlertChatId();
  const isSenderAdmin = Boolean(adminUid && String(message.from?.id) === adminUid);
  const isPrivateAdminChat = Boolean(adminUid && chatId === adminUid);
  const isForwardChat = Boolean(forwardChatId && chatId === forwardChatId);
  const isAlertChat = Boolean(alertChatId && chatId === alertChatId);
  const isListenChat = getListenChatIds().includes(chatId);

  // 群聊 / 超级群 / 频道消息处理
  if (isGroup) {
    const isAuthorizedGroup = isForwardChat || isAlertChat || isListenChat;

    // 收到未授权陌生群聊消息时，自动退出
    if (!isAuthorizedGroup) {
      await leaveUnauthorizedChat(message.chat);
      return;
    }

    // 监听群 / 频道：成员发言当作客人留言转达（优先级低于管理台会话，避免同一会话双身份冲突）
    if (isListenChat && !isForwardChat && !isAlertChat) {
      // 忽略指令（防成员误触管理命令）与管理员本人的发言
      if (command || isSenderAdmin) return;
      return handleGuestMessage(message);
    }

    if (command === '/start') {
      if (isSenderAdmin) {
        return sendMarkdown(
          message.chat.id,
          ADMIN_GREETING,
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
      return sendMarkdown(message.chat.id, ADMIN_GREETING);
    }
    const startMsg = await fetchStartMessage(DEFAULT_START_MESSAGE);
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
  if (!secret) warnMissingSecret();
  const r = await fetch(apiUrl('setWebhook'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message', 'channel_post', 'callback_query', 'my_chat_member'],
      drop_pending_updates: true,
    }),
  }).then((response) => response.json());

  // 命令菜单由 ENV_BOT_COMMANDS 驱动，未配置时该功能不生效（可选模块，见 build.js FEATURE_MODULES）
  await registerBotCommands();

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
  // 定时兜底：补发因 Worker 生命周期中断而遗留的延迟批次（需在 wrangler 配置 triggers.crons）
  async scheduled(event, env, ctx) {
    if (env) Object.assign(globalThis, env);
    const task = flushStalePendingBatches().catch((err) => {
      console.log(JSON.stringify({ error: 'flush-pending-batches-failed', message: err.message }));
    });
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(task);
    } else {
      await task;
    }
  },
};
