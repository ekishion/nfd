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

export function createForumTopic(msg = {}) {
  return requestTelegram('createForumTopic', msg);
}

export function leaveChat(chatId) {
  return requestTelegram('leaveChat', { chat_id: chatId });
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

export function getCommand(message, botUsername = '') {
  const text = (message.text || '').trim();
  if (!text.startsWith('/')) return '';
  const firstToken = text.split(/\s+/)[0];
  const atIndex = firstToken.indexOf('@');
  if (atIndex !== -1) {
    const cmd = firstToken.slice(0, atIndex).toLowerCase();
    const targetBot = firstToken.slice(atIndex + 1).toLowerCase();
    if (botUsername && targetBot !== botUsername.toLowerCase()) {
      return '';
    }
    return cmd;
  }
  return firstToken.toLowerCase();
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
    .replaceAll('{id}', String(user.id || ''))
    .replaceAll('{name}', username)
    .replaceAll('{用户名}', username);
}

export function buildMessageInfo(message, count = 1, tag = '') {
  const user = message.from || {};
  const guestLabel = tag ? `${buildUserName(user)} [${tag}]` : `${buildUserName(user)} (${user.id || message.chat.id})`;
  const lines = [
    '*人偶收到新留言*',
    mdLine('客人', guestLabel),
  ];
  if (user.username) {
    lines.push(mdLine('用户名', `@${user.username}`));
  }
  if (tag) {
    lines.push(mdLine('备注', tag));
  }
  if (message.chat?.type && message.chat.type !== 'private') {
    lines.push(mdLine('来源会话', `${message.chat.title || message.chat.id} / ${message.chat.type}`));
  }
  if (count > 1) {
    lines.push(mdLine('连续留言', `${count} 条`));
  }
  return lines.join('\n');
}

export function formatGuestProfile(profile = {}, tag = '', blocked = false, violationCount = 0) {
  const firstSeenStr = profile?.firstSeen ? new Date(profile.firstSeen).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '-';
  const lastSeenStr = profile?.lastSeen ? new Date(profile.lastSeen).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '-';

  return [
    '*客人画像档案*',
    mdLine('用户ID', profile?.userId || profile?.chatId || '-'),
    mdLine('备注标签', tag || '无'),
    mdLine('昵称', profile?.name || profile?.firstName || '-'),
    mdLine('用户名', profile?.username ? `@${profile.username.replace(/^@/, '')}` : '-'),
    mdLine('黑名单状态', blocked ? '已静音' : '正常'),
    mdLine('累计留言数', String(profile?.messageCount || 0)),
    mdLine('敏感词违规', String(violationCount || 0)),
    mdLine('首次留言', firstSeenStr),
    mdLine('最后活跃', lastSeenStr),
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
