// ==============================================================================
// src/telegram.js - Telegram API Client & High-level Send Helpers
// 纯文本格式化 / 键盘构建等无副作用工具见 ./format.js
// ==============================================================================

import { getToken, PARSE_MODE, sleep } from './config.js';
import { isMessageNotModified } from './format.js';

function apiUrl(methodName, params = null) {
  const token = getToken();
  const query = params ? `?${new URLSearchParams(params).toString()}` : '';
  return `https://api.telegram.org/bot${token}/${methodName}${query}`;
}

async function post(methodName, body) {
  const response = await fetch(apiUrl(methodName), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

export async function requestTelegram(methodName, body = {}) {
  try {
    let data = await post(methodName, body);
    // 批量转达容易撞到 Telegram 频控，短等待（≤5s）后重试一次，避免消息漏转
    const retryAfter = Number(data.parameters?.retry_after || 0);
    if (!data.ok && data.error_code === 429 && retryAfter > 0 && retryAfter <= 5) {
      console.log(JSON.stringify({ methodName, warning: 'telegram-429-retry', retryAfter }));
      await sleep(retryAfter * 1000 + 250);
      data = await post(methodName, body);
    }
    if (!data.ok) {
      console.log(JSON.stringify({ methodName, error: data.description, body }));
    }
    return data;
  } catch (error) {
    console.log(JSON.stringify({ methodName, error: error.message, body }));
    return { ok: false, description: error.message };
  }
}

export function sendMessage(msg = {}) {
  return requestTelegram('sendMessage', msg);
}

export async function editMessageText(msg = {}) {
  const data = await requestTelegram('editMessageText', {
    parse_mode: PARSE_MODE,
    link_preview_options: { is_disabled: true },
    ...msg,
  });
  // 面板刷新/重复点击时新内容与当前完全一致，Telegram 拒绝无变化编辑——消息已在目标状态，按成功处理
  if (!data.ok && isMessageNotModified(data.description)) {
    return { ok: true, result: true };
  }
  return data;
}

export function copyMessage(msg = {}) {
  return requestTelegram('copyMessage', msg);
}

export function forwardMessage(msg = {}) {
  return requestTelegram('forwardMessage', msg);
}

export function deleteMessage(msg = {}) {
  return requestTelegram('deleteMessage', msg);
}

export function answerCallbackQuery(msg = {}) {
  return requestTelegram('answerCallbackQuery', msg);
}

export function createForumTopic(msg = {}) {
  return requestTelegram('createForumTopic', msg);
}

export function leaveChat(chatId) {
  return requestTelegram('leaveChat', { chat_id: chatId });
}

export function getChat(chatId) {
  return requestTelegram('getChat', { chat_id: chatId });
}

export function sendMarkdown(chatId, text, extra = {}) {
  return sendMessage({
    chat_id: chatId,
    text,
    parse_mode: PARSE_MODE,
    link_preview_options: { is_disabled: true },
    ...extra,
  });
}

export function sendPlainText(chatId, text, extra = {}) {
  return sendMessage({
    chat_id: chatId,
    text,
    ...extra,
  });
}
