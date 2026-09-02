// ==============================================================================
// src/panel.js - Interactive Inline Keyboard Control Panel (/panel)
// ==============================================================================

import { getAdminUid } from './config.js';
import { getRuntimeConfig, updateRuntimeConfig, invalidateMemoryCache } from './cache.js';
import { sendMarkdown, editMessageText, deleteMessage, answerCallbackQuery, mdLine } from './telegram.js';

export function buildSettingPanel(config, page = 'moderation') {
  if (page === 'forwarding') {
    const text = [
      '*⚙️ 人偶控制面板（2/2 转发与通知）*',
      '',
      mdLine('⏱️ 转发缓冲延迟', config.delay_seconds > 0 ? `${config.delay_seconds} 秒` : '关闭 (即时转发)'),
      mdLine('📢 拦截通知管理', config.notice_admin ? '开启' : '关闭'),
      mdLine('💬 拦截提示客人', config.notice_user ? '开启' : '关闭'),
      mdLine('💡 安全交易提醒', config.enable_notify ? '开启' : '关闭'),
      '',
      '💡 _点击下方按钮实时调节延迟或切换开关喵_',
    ].join('\n');

    const keyboard = {
      inline_keyboard: [
        [
          { text: `⏱️ 延迟: ${config.delay_seconds > 0 ? config.delay_seconds + 's' : '关闭'} ▾`, callback_data: 'setting:cycle:delay_seconds' },
          { text: `💡 交易提醒: ${config.enable_notify ? '✅' : '❌'}`, callback_data: 'setting:toggle:enable_notify' },
        ],
        [
          { text: `📢 通知管理: ${config.notice_admin ? '✅' : '❌'}`, callback_data: 'setting:toggle:notice_admin' },
          { text: `💬 提示客人: ${config.notice_user ? '✅' : '❌'}`, callback_data: 'setting:toggle:notice_user' },
        ],
        [
          { text: '⬅️ 🛡️ 审查设置', callback_data: 'setting:page:moderation' },
          { text: '⏱️ 转发与通知 (当前)', callback_data: 'setting:page:forwarding' },
        ],
        [
          { text: '🔄 刷新状态', callback_data: 'setting:refresh:forwarding' },
          { text: '❌ 关闭面板', callback_data: 'setting:close' },
        ],
      ],
    };
    return { text, keyboard };
  }

  // Default Page: moderation
  const text = [
    '*⚙️ 人偶控制面板（1/2 拦截审查）*',
    '',
    mdLine('👤 要求用户名', config.req_username ? '开启' : '关闭'),
    mdLine('🖼️ 要求个人头像', config.req_photo ? '开启' : '关闭'),
    mdLine('🚫 违规自动拉黑', config.auto_block ? '开启' : '关闭'),
    mdLine('🔢 自动拉黑阈值', `${config.violation_limit} 次`),
    '',
    '💡 _点击下方按钮实时切换开关或调节阈值喵_',
  ].join('\n');

  const keyboard = {
    inline_keyboard: [
      [
        { text: `👤 用户名: ${config.req_username ? '✅' : '❌'}`, callback_data: 'setting:toggle:req_username' },
        { text: `🖼️ 头像: ${config.req_photo ? '✅' : '❌'}`, callback_data: 'setting:toggle:req_photo' },
      ],
      [
        { text: `🚫 自动拉黑: ${config.auto_block ? '✅' : '❌'}`, callback_data: 'setting:toggle:auto_block' },
        { text: `🔢 阈值: ${config.violation_limit}次 ▾`, callback_data: 'setting:cycle:violation_limit' },
      ],
      [
        { text: '🛡️ 审查设置 (当前)', callback_data: 'setting:page:moderation' },
        { text: '⏱️ 转发与通知 ➡️', callback_data: 'setting:page:forwarding' },
      ],
      [
        { text: '🔄 刷新状态', callback_data: 'setting:refresh:moderation' },
        { text: '❌ 关闭面板', callback_data: 'setting:close' },
      ],
    ],
  };
  return { text, keyboard };
}

export async function sendSettingPanel(chatId, page = 'moderation') {
  const config = await getRuntimeConfig();
  const { text, keyboard } = buildSettingPanel(config, page);
  return sendMarkdown(chatId, text, { reply_markup: keyboard });
}

export async function handleSettingCallback(callbackQuery, data, messageId) {
  const adminUid = getAdminUid();
  const parts = data.split(':');
  const action = parts[1]; // 'page', 'toggle', 'cycle', 'refresh', 'close'
  const key = parts[2];

  if (action === 'close') {
    if (messageId && adminUid) {
      await deleteMessage({ chat_id: adminUid, message_id: messageId });
    }
    return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '已关闭控制面板' });
  }

  let currentPage = 'moderation';
  let toast = '已更新设置';

  if (action === 'page') {
    currentPage = key || 'moderation';
    toast = currentPage === 'forwarding' ? '已切换至 转发与通知' : '已切换至 拦截审查';
  } else if (action === 'refresh') {
    currentPage = key || 'moderation';
    invalidateMemoryCache('runtime-config');
    toast = '已刷新当前配置';
  } else if (action === 'toggle') {
    const config = await getRuntimeConfig();
    const nextVal = !config[key];
    await updateRuntimeConfig({ [key]: nextVal });
    currentPage = ['delay_seconds', 'notice_admin', 'notice_user', 'enable_notify'].includes(key) ? 'forwarding' : 'moderation';
    toast = `已${nextVal ? '开启' : '关闭'}`;
  } else if (action === 'cycle') {
    const config = await getRuntimeConfig();
    if (key === 'violation_limit') {
      const limits = [1, 2, 3, 5];
      const nextVal = limits[(limits.indexOf(config.violation_limit) + 1) % limits.length] || 3;
      await updateRuntimeConfig({ violation_limit: nextVal });
      toast = `拉黑阈值调整为: ${nextVal} 次`;
      currentPage = 'moderation';
    } else if (key === 'delay_seconds') {
      const delays = [0, 3, 5, 10, 15];
      const nextVal = delays[(delays.indexOf(config.delay_seconds) + 1) % delays.length] ?? 0;
      await updateRuntimeConfig({ delay_seconds: nextVal });
      toast = nextVal > 0 ? `转发延迟调整为: ${nextVal} 秒` : '转发延迟已关闭 (即时转发)';
      currentPage = 'forwarding';
    }
  }

  const updatedConfig = await getRuntimeConfig();
  const { text, keyboard } = buildSettingPanel(updatedConfig, currentPage);

  if (messageId && adminUid) {
    await editMessageText({
      chat_id: adminUid,
      message_id: messageId,
      text,
      reply_markup: keyboard,
    });
  }

  return answerCallbackQuery({
    callback_query_id: callbackQuery.id,
    text: toast,
    show_alert: false,
  });
}
