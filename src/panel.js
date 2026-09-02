// ==============================================================================
// src/panel.js - 3-Page Interactive Settings Control Panel
// ==============================================================================

import {
  getRuntimeConfig,
  updateRuntimeConfig,
  invalidateMemoryCache,
} from './cache.js';
import {
  sendMarkdown,
  editMessageText,
  deleteMessage,
  answerCallbackQuery,
} from './telegram.js';

export function buildSettingPanel(config, page = 'moderation') {
  const isModeration = page === 'moderation';
  const isForwarding = page === 'forwarding';
  const isDefense = page === 'defense';

  const title = isModeration
    ? '⚙️ *控制面板 \\- 拦截审查设置* (1/3)'
    : isForwarding
      ? '⚙️ *控制面板 \\- 转发与通知设置* (2/3)'
      : '⚙️ *控制面板 \\- 防护与离开设置* (3/3)';

  const lines = [title, ''];

  if (isModeration) {
    lines.push(
      `• *要求设置用户名:* ${config.req_username ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *要求设置个人头像:* ${config.req_photo ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *敏感词多次自动拉黑:* ${config.auto_block ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *敏感词拉黑阈值:* \`${config.violation_limit} 次\``,
      '',
      '_点击下方按钮可直接切换状态或调整阈值：_',
    );
  } else if (isForwarding) {
    const delayText = config.delay_seconds > 0 ? `${config.delay_seconds} 秒` : '关闭 (即时转发)';
    lines.push(
      `• *转发聚合延迟:* \`${delayText}\``,
      `• *敏感词拦截通知管理:* ${config.notice_admin ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *敏感词拦截提示客人:* ${config.notice_user ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *定期交易安全提醒:* ${config.enable_notify ? '✅ 已开启' : '❌ 已关闭'}`,
      '',
      '_点击下方按钮可直接切换状态或调节延迟：_',
    );
  } else {
    lines.push(
      `• *短时防刷屏频控:* ${config.flood_protect ? '✅ 已开启 (10s/5条)' : '❌ 已关闭'}`,
      `• *拦截危险安装包/可执行文件:* ${config.block_executables ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *离开模式 (自动应答):* ${config.away_mode ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *离开提示文案:* \`${(config.away_message || '外出中').slice(0, 30)}\``,
      '',
      '_点击下方按钮可快速切换防护或离开模式：_',
    );
  }

  const text = lines.join('\n');

  const navRow = [
    { text: isModeration ? '🔘 1.拦截审查' : '1.拦截审查', callback_data: 'setting:page:moderation' },
    { text: isForwarding ? '🔘 2.转发通知' : '2.转发通知', callback_data: 'setting:page:forwarding' },
    { text: isDefense ? '🔘 3.防护离开' : '3.防护离开', callback_data: 'setting:page:defense' },
  ];

  let actionRows = [];
  if (isModeration) {
    actionRows = [
      [
        {
          text: `用户名拦截: ${config.req_username ? '✅ 开' : '❌ 关'}`,
          callback_data: 'setting:toggle:req_username',
        },
        {
          text: `头像拦截: ${config.req_photo ? '✅ 开' : '❌ 关'}`,
          callback_data: 'setting:toggle:req_photo',
        },
      ],
      [
        {
          text: `自动拉黑: ${config.auto_block ? '✅ 开' : '❌ 关'}`,
          callback_data: 'setting:toggle:auto_block',
        },
        {
          text: `阈值: ${config.violation_limit}次 🔄`,
          callback_data: 'setting:cycle:violation_limit',
        },
      ],
    ];
  } else if (isForwarding) {
    const delayLabel = config.delay_seconds > 0 ? `${config.delay_seconds}s` : '即时';
    actionRows = [
      [
        {
          text: `转发延迟: ${delayLabel} 🔄`,
          callback_data: 'setting:cycle:delay_seconds',
        },
        {
          text: `通报管理: ${config.notice_admin ? '✅ 开' : '❌ 关'}`,
          callback_data: 'setting:toggle:notice_admin',
        },
      ],
      [
        {
          text: `提示客人: ${config.notice_user ? '✅ 开' : '❌ 关'}`,
          callback_data: 'setting:toggle:notice_user',
        },
        {
          text: `交易提醒: ${config.enable_notify ? '✅ 开' : '❌ 关'}`,
          callback_data: 'setting:toggle:enable_notify',
        },
      ],
    ];
  } else {
    actionRows = [
      [
        {
          text: `防刷频控: ${config.flood_protect ? '✅ 开' : '❌ 关'}`,
          callback_data: 'setting:toggle:flood_protect',
        },
        {
          text: `拦截危险文件: ${config.block_executables ? '✅ 开' : '❌ 关'}`,
          callback_data: 'setting:toggle:block_executables',
        },
      ],
      [
        {
          text: `离开模式: ${config.away_mode ? '✅ 开' : '❌ 关'}`,
          callback_data: 'setting:toggle:away_mode',
        },
      ],
    ];
  }

  const footerRow = [
    { text: '🔄 刷新', callback_data: `setting:refresh:${page}` },
    { text: '❌ 关闭', callback_data: 'setting:close' },
  ];

  const keyboard = {
    inline_keyboard: [navRow, ...actionRows, footerRow],
  };

  return { text, keyboard };
}

export async function sendSettingPanel(chatId, page = 'moderation', extra = {}) {
  const config = await getRuntimeConfig();
  const { text, keyboard } = buildSettingPanel(config, page);
  return sendMarkdown(chatId, text, { reply_markup: keyboard, ...extra });
}

export async function handleSettingCallback(callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  const data = callbackQuery.data || '';
  const messageId = callbackQuery.message?.message_id;
  const parts = data.split(':');
  const action = parts[1]; // 'page', 'toggle', 'cycle', 'refresh', 'close'
  const key = parts[2];

  if (action === 'close') {
    if (messageId && chatId) {
      await deleteMessage({ chat_id: chatId, message_id: messageId });
    }
    return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '已关闭控制面板' });
  }

  let currentPage = 'moderation';
  let toast = '已更新设置';

  if (action === 'page') {
    currentPage = key || 'moderation';
    toast = `已切换至 ${currentPage === 'forwarding' ? '转发与通知' : currentPage === 'defense' ? '防护与离开' : '拦截审查'}`;
  } else if (action === 'refresh') {
    currentPage = key || 'moderation';
    invalidateMemoryCache('runtime-config');
    toast = '已刷新当前配置';
  } else if (action === 'toggle') {
    const config = await getRuntimeConfig();
    const nextVal = !config[key];
    await updateRuntimeConfig({ [key]: nextVal });
    if (['delay_seconds', 'notice_admin', 'notice_user', 'enable_notify'].includes(key)) {
      currentPage = 'forwarding';
    } else if (['flood_protect', 'block_executables', 'away_mode'].includes(key)) {
      currentPage = 'defense';
    } else {
      currentPage = 'moderation';
    }
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

  if (messageId && chatId) {
    await editMessageText({
      chat_id: chatId,
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
