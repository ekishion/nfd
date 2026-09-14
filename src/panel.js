// ==============================================================================
// src/panel.js - Enhanced 3-Page Interactive Settings Control Panel
// ==============================================================================

import {
  getRuntimeConfig,
  updateRuntimeConfig,
  invalidateMemoryCache,
  fetchKeywordDb,
  asArray,
  cachedKvGetJson,
  cachedKvPutJson,
  getStatCount,
} from './cache.js';
import { hasExternalNotifier } from './config.js';
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
    ? '⚙️ *控制面板 \\- 拦截审查设置* \\(1/3\\)'
    : isForwarding
      ? '⚙️ *控制面板 \\- 转发与通知设置* \\(2/3\\)'
      : '⚙️ *控制面板 \\- 防护与离开设置* \\(3/3\\)';

  const lines = [title, ''];

  if (isModeration) {
    lines.push(
      `• *要求设置用户名:* ${config.req_username ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *要求设置个人头像:* ${config.req_photo ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *昵称与用户名审查:* ${config.screen_nickname !== false ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *敏感词多次自动拉黑:* ${config.auto_block ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *敏感词拉黑阈值:* \`${config.violation_limit} 次\``,
      '',
      '_点击下方按钮切换状态、调整阈值或同步规则库：_',
    );
  } else if (isForwarding) {
    const delayText = config.delay_seconds > 0 ? `${config.delay_seconds} 秒` : '关闭 (即时转发)';
    lines.push(
      `• *转发聚合延迟:* \`${delayText}\``,
      `• *敏感词通报管理:* ${config.notice_admin ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *敏感词提示客人:* ${config.notice_user ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *定期交易安全提醒:* ${config.enable_notify ? '✅ 已开启' : '❌ 已关闭'}`,
    );
    if (hasExternalNotifier()) {
      lines.push(`• *外部推送仅告警:* ${config.notify_alert_only ? '✅ 仅告警' : '❌ 全部外发'}`);
    }
    lines.push(
      '',
      '_点击下方按钮可直接切换状态或调节延迟：_',
    );
  } else {
    lines.push(
      `• *短时防刷频控:* ${config.flood_protect ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *频控条数阈值:* \`${config.flood_limit || 5} 条 / ${config.flood_window_seconds || 10}秒\``,
      `• *频控静音时长:* \`${config.flood_mute_seconds || 60} 秒\``,
      `• *拦截危险安装包/可执行文件:* ${config.block_executables ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *离开模式 \\(自动应答\\):* ${config.away_mode ? '✅ 已开启' : '❌ 已关闭'}`,
      `• *离开提示文案:* \`${(config.away_message || '外出中').replace(/[`\\]/g, '').slice(0, 25)}\``,
      '',
      '_点击下方按钮可快速调节频控参数或切换离开模式：_',
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
          text: `昵称审查: ${config.screen_nickname !== false ? '✅ 开' : '❌ 关'}`,
          callback_data: 'setting:toggle:screen_nickname',
        },
        {
          text: `自动拉黑: ${config.auto_block ? '✅ 开' : '❌ 关'}`,
          callback_data: 'setting:toggle:auto_block',
        },
      ],
      [
        {
          text: `阈值: ${config.violation_limit}次 🔄`,
          callback_data: 'setting:cycle:violation_limit',
        },
        {
          text: '🔄 同步规则库',
          callback_data: 'setting:action:sync_keywords',
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
          text: `交易提醒: ${config.enable_notify ? '✅ 开' : '❌ 关'}`,
          callback_data: 'setting:toggle:enable_notify',
        },
      ],
      [
        {
          text: `通报管理: ${config.notice_admin ? '✅ 开' : '❌ 关'}`,
          callback_data: 'setting:toggle:notice_admin',
        },
        {
          text: `提示客人: ${config.notice_user ? '✅ 开' : '❌ 关'}`,
          callback_data: 'setting:toggle:notice_user',
        },
      ],
    ];
    if (hasExternalNotifier()) {
      actionRows.push([
        {
          text: `外部推送: ${config.notify_alert_only ? '🚨 仅告警' : '📢 全部外发'} 🔄`,
          callback_data: 'setting:toggle:notify_alert_only',
        },
      ]);
    }
  } else {
    actionRows = [
      [
        {
          text: `防刷频控: ${config.flood_protect ? '✅ 开' : '❌ 关'}`,
          callback_data: 'setting:toggle:flood_protect',
        },
        {
          text: `频控条数: ${config.flood_limit || 5}条 🔄`,
          callback_data: 'setting:cycle:flood_limit',
        },
      ],
      [
        {
          text: `静音时长: ${config.flood_mute_seconds || 60}s 🔄`,
          callback_data: 'setting:cycle:flood_mute_seconds',
        },
        {
          text: `危险文件: ${config.block_executables ? '✅ 拦截' : '❌ 放行'}`,
          callback_data: 'setting:toggle:block_executables',
        },
      ],
      [
        {
          text: `离开自动应答: ${config.away_mode ? '✅ 开' : '❌ 关'}`,
          callback_data: 'setting:toggle:away_mode',
        },
      ],
    ];
  }

  const footerRow = [
    { text: '📊 今日统计', callback_data: 'setting:action:stats' },
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
  const action = parts[1]; // 'page', 'toggle', 'cycle', 'refresh', 'close', 'action'
  const key = parts[2];

  if (action === 'close') {
    if (messageId && chatId) {
      await deleteMessage({ chat_id: chatId, message_id: messageId });
    }
    return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '已关闭控制面板' });
  }

  if (action === 'action') {
    if (key === 'sync_keywords') {
      const remote = await fetchKeywordDb();
      if (!remote || !remote.length) {
        return answerCallbackQuery({
          callback_query_id: callbackQuery.id,
          text: '未能从远程数据库获取到关键词规则喵。',
          show_alert: true,
        });
      }
      const current = asArray(await cachedKvGetJson('keyword-rules', 120000, []));
      const merged = Array.from(new Set([...current, ...remote]));
      await cachedKvPutJson('keyword-rules', merged, {}, 3600000);
      invalidateMemoryCache('merged-keyword-rules');
      return answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: `已完成规则库同步，当前共有 ${merged.length} 条拦截规则生效喵！`,
        show_alert: true,
      });
    }

    if (key === 'stats') {
      const now = new Date();
      const dateKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
      const [guestMessages, adminReplies, keywordBlocked, autoBlocked, blockedUsers] = await Promise.all([
        getStatCount('guest-message', dateKey),
        getStatCount('admin-replied', dateKey),
        getStatCount('keyword-blocked', dateKey),
        getStatCount('keyword-auto-blocked', dateKey),
        getStatCount('blocked-user-message', dateKey),
      ]);
      const summary = `【人偶今日运行统计 (${dateKey} UTC)】\n• 收到留言: ${guestMessages} 条\n• 已回信: ${adminReplies} 条\n• 敏感词拦截: ${keywordBlocked} 次\n• 自动拉黑: ${autoBlocked} 人\n• 静音名单拦截: ${blockedUsers} 次`;
      return answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: summary,
        show_alert: true,
      });
    }
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
    let currentVal = config[key];
    if (currentVal === undefined) {
      if (['screen_nickname', 'auto_block', 'notice_admin', 'notice_user', 'enable_notify', 'flood_protect', 'block_executables'].includes(key)) {
        currentVal = true;
      } else {
        currentVal = false;
      }
    }
    const nextVal = !currentVal;
    await updateRuntimeConfig({ [key]: nextVal });
    if (['delay_seconds', 'notice_admin', 'notice_user', 'enable_notify', 'notify_alert_only'].includes(key)) {
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
    } else if (key === 'flood_limit') {
      const floodLimits = [3, 5, 8, 10];
      const nextVal = floodLimits[(floodLimits.indexOf(config.flood_limit || 5) + 1) % floodLimits.length] || 5;
      await updateRuntimeConfig({ flood_limit: nextVal });
      toast = `频控条数调整为: ${nextVal} 条 / 10s`;
      currentPage = 'defense';
    } else if (key === 'flood_mute_seconds') {
      const muteTimes = [30, 60, 120, 300];
      const nextVal = muteTimes[(muteTimes.indexOf(config.flood_mute_seconds || 60) + 1) % muteTimes.length] || 60;
      await updateRuntimeConfig({ flood_mute_seconds: nextVal });
      toast = `频控静音时长调整为: ${nextVal} 秒`;
      currentPage = 'defense';
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
