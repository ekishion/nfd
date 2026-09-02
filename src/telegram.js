// ==============================================================================
// src/telegram.js - Telegram API Client, Message Formatting & Keyboard Builders
// ==============================================================================

import { getToken, PARSE_MODE } from './config.js';

export function apiUrl(methodName, params = null) {
  const token = getToken();
  const query = params ? `?${new URLSearchParams(params).toString()}` : '';
  return `https://api.telegram.org/bot${token}/${methodName}${query}`;
}

export async function requestTelegram(methodName, body = {}) {
  try {
    const response = await fetch(apiUrl(methodName), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
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

export function editMessageText(msg = {}) {
  return requestTelegram('editMessageText', {
    parse_mode: PARSE_MODE,
    link_preview_options: { is_disabled: true },
    ...msg,
  });
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

export function escapeMarkdown(value = '') {
  return String(value).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
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

export function mdLine(label, value) {
  return `*${escapeMarkdown(label)}:* ${escapeMarkdown(value || '-')}`;
}

export function getMessageText(message) {
  return message.text || message.caption || '';
}

export function getCommand(message) {
  const text = (message.text || '').trim();
  return text.startsWith('/') ? text.split(/\s+/)[0].split('@')[0].toLowerCase() : '';
}

export function getCommandArgs(message) {
  const text = (message.text || '').trim();
  const firstSpace = text.search(/\s/);
  return firstSpace === -1 ? '' : text.slice(firstSpace).trim();
}

export function buildUserName(user = {}) {
  const nickname = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  if (nickname) return nickname;
  if (user.username) return `@${user.username}`;
  return String(user.id || '');
}

export function formatStartMessage(template, user) {
  const username = escapeMarkdown(buildUserName(user));
  return template
    .replaceAll('{username}', username)
    .replaceAll('{用户名}', username);
}

export function buildMessageInfo(message, count = 1) {
  const user = message.from || {};
  const lines = [
    '*人偶收到新留言*',
    mdLine('客人', `${buildUserName(user)} (${user.id || message.chat.id})`),
  ];
  if (user.username) {
    lines.push(mdLine('用户名', `@${user.username}`));
  }
  if (message.chat?.type && message.chat.type !== 'private') {
    lines.push(mdLine('来源会话', `${message.chat.title || message.chat.id} / ${message.chat.type}`));
  }
  if (count > 1) {
    lines.push(mdLine('连续留言', `${count} 条`));
  }
  return lines.join('\n');
}

export function buildGuestInfo(message) {
  const user = message.from || {};
  return {
    chatId: String(message.chat.id),
    userId: String(user.id || message.chat.id),
    name: buildUserName(user),
    username: user.username ? `@${user.username}` : '',
    languageCode: user.language_code || '',
    chatType: message.chat?.type || '',
    chatTitle: message.chat?.title || '',
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
  };
}

export function formatGuestInfo(info = {}) {
  return [
    '*留言人信息*',
    mdLine('昵称', info.name || '-'),
    mdLine('用户名', info.username || '-'),
    mdLine('用户ID', info.userId || info.chatId || '-'),
    mdLine('会话ID', info.chatId || '-'),
    mdLine('语言', info.languageCode || '-'),
    mdLine('会话类型', info.chatType || '-'),
    mdLine('会话标题', info.chatTitle || '-'),
    mdLine('最后留言', info.lastSeenAt ? new Date(info.lastSeenAt).toISOString() : '-'),
  ].join('\n');
}

export function adminMessageKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '回复', callback_data: 'reply' },
        { text: '信息', callback_data: 'info' },
        { text: '撤回最近回复', callback_data: 'revoke:last' },
      ],
      [
        { text: '屏蔽', callback_data: 'block' },
        { text: '解除屏蔽', callback_data: 'unblock' },
        { text: '检查', callback_data: 'checkblock' },
      ],
    ],
  };
}

export function revokeReplyKeyboard(guestChatId, messageId) {
  return {
    inline_keyboard: [[
      { text: '撤回这条回复', callback_data: `revoke:${guestChatId}:${messageId}` },
    ]],
  };
}
