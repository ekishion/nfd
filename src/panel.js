// ==============================================================================
// src/panel.js - Emoji-Free Multi-Page Interactive Settings Control Panel
// ==============================================================================

import {
  getRuntimeConfig,
  updateRuntimeConfig,
  invalidateMemoryCache,
  syncRemoteKeywordRules,
  getStatCount,
} from './cache.js';
import { hasExternalNotifier } from './config.js';
import {
  sendMarkdown,
  editMessageText,
  deleteMessage,
  answerCallbackQuery,
} from './telegram.js';

function onOffMd(val) {
  return val ? '\\[ON\\]' : '\\[OFF\\]';
}

function btnLabel(name, val) {
  return `${name}: ${val ? 'ON' : 'OFF'}`;
}

const PAGE_ALIASES = {
  moderation: 'access',
  defense: 'security',
};

const PAGE_NAMES = {
  main: '主菜单',
  access: '访客门槛设置',
  content: '内容审查设置',
  forwarding: '转发通知设置',
  security: '频控安全设置',
  tools: '状态与维护工具',
};

const KEY_PAGES = {
  req_username: 'access',
  req_photo: 'access',
  req_bio: 'access',
  block_bio_links: 'access',
  screen_bio: 'content',
  screen_nickname: 'content',
  auto_block: 'content',
  violation_limit: 'content',
  notice_admin: 'content',
  notice_user: 'content',
  delay_seconds: 'forwarding',
  enable_notify: 'forwarding',
  notify_alert_only: 'forwarding',
  flood_protect: 'security',
  flood_limit: 'security',
  flood_mute_seconds: 'security',
  block_executables: 'security',
  away_mode: 'security',
};

function getPageForKey(key) {
  return KEY_PAGES[key] || 'main';
}

export function buildSettingPanel(config, rawPage = 'main') {
  const page = PAGE_ALIASES[rawPage] || rawPage;
  const lines = [`*控制面板 \\- ${PAGE_NAMES[page] || '主菜单'}*`, ''];
  let actionRows = [];

  if (page === 'access') {
    lines.push(
      `• *要求设置用户名:* ${onOffMd(config.req_username)}`,
      `• *要求设置个人头像:* ${onOffMd(config.req_photo)}`,
      `• *要求设置个人简介:* ${onOffMd(config.req_bio)}`,
      `• *拦截简介引流外链:* ${onOffMd(config.block_bio_links)}`,
      '',
      '_点击下方按钮可直接切换状态：_',
    );
    actionRows = [
      [
        { text: btnLabel('用户名必填', config.req_username), callback_data: 'setting:toggle:req_username' },
        { text: btnLabel('头像必填', config.req_photo), callback_data: 'setting:toggle:req_photo' },
      ],
      [
        { text: btnLabel('简介必填', config.req_bio), callback_data: 'setting:toggle:req_bio' },
        { text: btnLabel('简介外链', config.block_bio_links), callback_data: 'setting:toggle:block_bio_links' },
      ],
    ];
  } else if (page === 'content') {
    lines.push(
      `• *个人简介审查:* ${onOffMd(config.screen_bio !== false)}`,
      `• *昵称与用户名审查:* ${onOffMd(config.screen_nickname !== false)}`,
      `• *敏感词多次自动拉黑:* ${onOffMd(config.auto_block)}`,
      `• *敏感词拉黑阈值:* \`${config.violation_limit} 次\``,
      `• *敏感词通报管理:* ${onOffMd(config.notice_admin)}`,
      `• *敏感词提示客人:* ${onOffMd(config.notice_user)}`,
      '',
      '_点击下方按钮可切换状态或调节阈值：_',
    );
    actionRows = [
      [
        { text: btnLabel('简介审查', config.screen_bio !== false), callback_data: 'setting:toggle:screen_bio' },
        { text: btnLabel('昵称审查', config.screen_nickname !== false), callback_data: 'setting:toggle:screen_nickname' },
      ],
      [
        { text: btnLabel('自动拉黑', config.auto_block), callback_data: 'setting:toggle:auto_block' },
        { text: `阈值: ${config.violation_limit}次`, callback_data: 'setting:cycle:violation_limit' },
      ],
      [
        { text: btnLabel('通报管理', config.notice_admin), callback_data: 'setting:toggle:notice_admin' },
        { text: btnLabel('提示客人', config.notice_user), callback_data: 'setting:toggle:notice_user' },
      ],
    ];
  } else if (page === 'forwarding') {
    const delayText = config.delay_seconds > 0 ? `${config.delay_seconds} 秒` : '即时转发 \\[OFF\\]';
    lines.push(
      `• *转发聚合延迟:* \`${delayText}\``,
      `• *定期交易安全提醒:* ${onOffMd(config.enable_notify)}`,
    );
    if (hasExternalNotifier()) {
      lines.push(`• *外部推送仅告警:* ${onOffMd(config.notify_alert_only)}`);
    }
    lines.push(
      '',
      '_点击下方按钮可调节延迟或切换通知开关：_',
    );
    const delayLabel = config.delay_seconds > 0 ? `${config.delay_seconds}s` : '即时';
    actionRows = [
      [
        { text: `转发延迟: ${delayLabel}`, callback_data: 'setting:cycle:delay_seconds' },
        { text: btnLabel('交易提醒', config.enable_notify), callback_data: 'setting:toggle:enable_notify' },
      ],
    ];
    if (hasExternalNotifier()) {
      actionRows.push([
        { text: btnLabel('仅告警外送', config.notify_alert_only), callback_data: 'setting:toggle:notify_alert_only' },
      ]);
    }
  } else if (page === 'security') {
    lines.push(
      `• *短时防刷频控:* ${onOffMd(config.flood_protect)}`,
      `• *频控条数阈值:* \`${config.flood_limit || 5} 条 / ${config.flood_window_seconds || 10}秒\``,
      `• *频控静音时长:* \`${config.flood_mute_seconds || 60} 秒\``,
      `• *拦截危险安装包/可执行文件:* ${onOffMd(config.block_executables)}`,
      `• *离开模式 \\(自动应答\\):* ${onOffMd(config.away_mode)}`,
      `• *离开提示文案:* \`${(config.away_message || '外出中').replace(/[`\\]/g, '').slice(0, 25)}\``,
      '',
      '_点击下方按钮可调节频控参数或切换开关：_',
    );
    actionRows = [
      [
        { text: btnLabel('防刷频控', config.flood_protect), callback_data: 'setting:toggle:flood_protect' },
        { text: `频控条数: ${config.flood_limit || 5}条`, callback_data: 'setting:cycle:flood_limit' },
      ],
      [
        { text: `静音时长: ${config.flood_mute_seconds || 60}s`, callback_data: 'setting:cycle:flood_mute_seconds' },
        { text: btnLabel('危险文件', config.block_executables), callback_data: 'setting:toggle:block_executables' },
      ],
      [
        { text: btnLabel('离开模式', config.away_mode), callback_data: 'setting:toggle:away_mode' },
      ],
    ];
  } else if (page === 'tools') {
    lines.push(
      '• *规则库同步:* 支持从远程源同步最新拦截规则',
      '• *今日运行统计:* 实时统计系统各项指标',
      '',
      '_点击下方按钮可同步规则库或查看运行统计：_',
    );
    actionRows = [
      [
        { text: '同步规则库', callback_data: 'setting:action:sync_keywords' },
        { text: '今日运行统计', callback_data: 'setting:action:stats' },
      ],
    ];
  } else {
    // Default page: 'main'
    lines.push(
      '请选择要配置的二级功能模块：',
      '1\\. *访客门槛设置* \\- 用户名、头像、简介必填与外链拦截',
      '2\\. *内容审查设置* \\- 敏感词库、简介审查、昵称审查与拉黑阈值',
      '3\\. *转发通知设置* \\- 聚合延迟、交易安全提醒与通报策略',
      '4\\. *频控安全设置* \\- 防刷频控、静音时长、危险文件与离开模式',
      '5\\. *状态与维护工具* \\- 规则库同步与今日系统运行统计',
    );
    actionRows = [
      [
        { text: '1. 访客门槛设置', callback_data: 'setting:page:access' },
        { text: '2. 内容审查设置', callback_data: 'setting:page:content' },
      ],
      [
        { text: '3. 转发通知设置', callback_data: 'setting:page:forwarding' },
        { text: '4. 频控安全设置', callback_data: 'setting:page:security' },
      ],
      [
        { text: '5. 状态与维护工具', callback_data: 'setting:page:tools' },
      ],
    ];
  }

  const footerRow = page === 'main'
    ? [
        { text: '刷新面板', callback_data: 'setting:refresh:main' },
        { text: '关闭面板', callback_data: 'setting:close' },
      ]
    : [
        { text: '< 返回主菜单', callback_data: 'setting:page:main' },
        { text: '刷新', callback_data: `setting:refresh:${page}` },
        { text: '关闭', callback_data: 'setting:close' },
      ];

  const text = lines.join('\n');
  const keyboard = {
    inline_keyboard: [...actionRows, footerRow],
  };

  return { text, keyboard };
}

export async function sendSettingPanel(chatId, page = 'main', extra = {}) {
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
      const count = await syncRemoteKeywordRules();
      return answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: count !== null
          ? `已完成规则库同步，当前共有 ${count} 条拦截规则生效！`
          : '未能从远程数据库获取到关键词规则。',
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
      const summary = `[今日运行统计 (${dateKey} UTC)]\n- 收到留言: ${guestMessages} 条\n- 已回信: ${adminReplies} 条\n- 敏感词拦截: ${keywordBlocked} 次\n- 自动拉黑: ${autoBlocked} 人\n- 静音名单拦截: ${blockedUsers} 次`;
      return answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: summary,
        show_alert: true,
      });
    }
  }

  let currentPage = 'main';
  let toast = '已更新设置';

  if (action === 'page') {
    currentPage = PAGE_ALIASES[key] || key || 'main';
    toast = `已切换至 ${PAGE_NAMES[currentPage] || currentPage}`;
  } else if (action === 'refresh') {
    currentPage = PAGE_ALIASES[key] || key || 'main';
    invalidateMemoryCache('runtime-config');
    toast = '已刷新当前配置';
  } else if (action === 'toggle') {
    const config = await getRuntimeConfig();
    let currentVal = config[key];
    if (currentVal === undefined) {
      if (['screen_nickname', 'screen_bio', 'auto_block', 'notice_admin', 'notice_user', 'enable_notify', 'flood_protect', 'block_executables'].includes(key)) {
        currentVal = true;
      } else {
        currentVal = false;
      }
    }
    const nextVal = !currentVal;
    await updateRuntimeConfig({ [key]: nextVal });
    currentPage = getPageForKey(key);
    toast = `已${nextVal ? '开启 [ON]' : '关闭 [OFF]'}`;
  } else if (action === 'cycle') {
    const config = await getRuntimeConfig();
    currentPage = getPageForKey(key);
    if (key === 'violation_limit') {
      const limits = [1, 2, 3, 5];
      const nextVal = limits[(limits.indexOf(config.violation_limit) + 1) % limits.length] || 3;
      await updateRuntimeConfig({ violation_limit: nextVal });
      toast = `拉黑阈值调整为: ${nextVal} 次`;
    } else if (key === 'delay_seconds') {
      const delays = [0, 3, 5, 10, 15];
      const nextVal = delays[(delays.indexOf(config.delay_seconds) + 1) % delays.length] ?? 0;
      await updateRuntimeConfig({ delay_seconds: nextVal });
      toast = nextVal > 0 ? `转发延迟调整为: ${nextVal} 秒` : '转发延迟已关闭 (即时转发)';
    } else if (key === 'flood_limit') {
      const floodLimits = [3, 5, 8, 10];
      const nextVal = floodLimits[(floodLimits.indexOf(config.flood_limit || 5) + 1) % floodLimits.length] || 5;
      await updateRuntimeConfig({ flood_limit: nextVal });
      toast = `频控条数调整为: ${nextVal} 条 / 10s`;
    } else if (key === 'flood_mute_seconds') {
      const muteTimes = [30, 60, 120, 300];
      const nextVal = muteTimes[(muteTimes.indexOf(config.flood_mute_seconds || 60) + 1) % muteTimes.length] || 60;
      await updateRuntimeConfig({ flood_mute_seconds: nextVal });
      toast = `频控静音时长调整为: ${nextVal} 秒`;
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
