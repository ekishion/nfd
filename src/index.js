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
  getStartMsgUrl,
} from './config.js';
import { fetchTextOrDefault, isDuplicateUpdate, getBotUsername } from './cache.js';
import { apiUrl, sendMarkdown, getCommand, formatStartMessage } from './telegram.js';
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
    if (update.message) {
      await onMessage(update.message);
    } else if (update.callback_query) {
      await onCallbackQuery(update.callback_query);
    }
  } catch (err) {
    console.log(JSON.stringify({ error: 'onUpdate-failed', message: err.message, stack: err.stack }));
  }
}

export async function onMessage(message) {
  if (!message?.chat?.id) return;

  const botUsername = await getBotUsername();
  const command = getCommand(message, botUsername);
  const isGroup = Boolean(message.chat.type && message.chat.type !== 'private');

  const adminUid = getAdminUid();
  const forwardChatId = getForwardChatId();
  const isSenderAdmin = Boolean(adminUid && String(message.from?.id) === adminUid);
  const isPrivateAdminChat = Boolean(adminUid && String(message.chat.id) === adminUid);
  const isForwardChat = Boolean(forwardChatId && String(message.chat.id) === forwardChatId);

  // Group / Supergroup / Channel processing
  if (isGroup) {
    // Only process inside authorized forward chat or by admin sender
    if (!isForwardChat && !isSenderAdmin) {
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
      // Management commands restricted to admin sender
      if (ADMIN_COMMANDS.has(command) && !isSenderAdmin) {
        return;
      }
      return handleAdminMessage(message, command);
    }

    // Check if replying to a guest or typing inside a guest forum topic
    const guestChatId = await getMappedGuestId(message);
    if (guestChatId) {
      return handleAdminMessage(message, '');
    }
    // Regular group chatter or mentions - silently ignore
    return;
  }

  // Private chat processing
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
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    }),
  }).then((response) => response.json());
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
