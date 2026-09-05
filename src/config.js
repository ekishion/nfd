// ==============================================================================
// src/config.js - Configuration, Constants & Dynamic Environment Accessors
// ==============================================================================

import defaultStartMessage from '../data/startMessage.md';
import defaultNotification from '../data/notification.txt';

export const WEBHOOK = '/endpoint';
export const PARSE_MODE = 'MarkdownV2';
export const NOTIFY_INTERVAL = 3600 * 1000;
export const FRAUD_CACHE_TTL = 30 * 60 * 1000;
export const MESSAGE_MAP_TTL = 30 * 24 * 3600;
// Workers waitUntil 墙钟上限约 30 秒，内联延迟需留出余量，超出部分由 scheduled 兜底
export const MAX_INLINE_DELAY_SECONDS = 25;

export function getToken() {
  return getOptionalEnv('ENV_BOT_TOKEN');
}

export function getSecret() {
  return getOptionalEnv('ENV_BOT_SECRET');
}

export function getAdminUid() {
  return String(getOptionalEnv('ENV_ADMIN_UID', ''));
}

export function getForwardChatId() {
  return String(getOptionalEnv('ENV_FORWARD_CHAT_ID', getAdminUid()));
}

export function getForwardThreadId() {
  const tid = getOptionalEnv('ENV_FORWARD_THREAD_ID');
  return tid && /^\d+$/.test(tid) ? Number(tid) : null;
}

export function getAlertChatId() {
  return String(getOptionalEnv('ENV_ALERT_CHAT_ID', getForwardChatId()));
}

export function getAlertThreadId() {
  const tid = getOptionalEnv('ENV_ALERT_THREAD_ID');
  return tid && /^\d+$/.test(tid) ? Number(tid) : null;
}

export function getListenChatIds() {
  return String(getOptionalEnv('ENV_LISTEN_CHAT_IDS', ''))
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function getBotCommands() {
  const raw = String(getOptionalEnv('ENV_BOT_COMMANDS', '')).trim();
  if (!raw) return null;

  let parsed = null;
  // 1) JSON 数组格式：[{"command":"panel","description":"控制面板"}]
  try {
    const json = JSON.parse(raw);
    if (Array.isArray(json)) {
      parsed = normalizeBotCommands(json.map((item) => ({ command: item?.command, description: item?.description })));
    }
  } catch {
    parsed = null;
  }

  // 2) 简写格式：panel:控制面板,stats:统计数据
  if (!parsed) {
    parsed = normalizeBotCommands(
      raw.split(',').map((pair) => {
        const idx = pair.indexOf(':');
        if (idx <= 0) return null;
        return { command: pair.slice(0, idx).trim(), description: pair.slice(idx + 1).trim() };
      }),
    );
  }

  if (parsed) return parsed;
  console.log(JSON.stringify({ warning: 'ENV_BOT_COMMANDS 无法解析为有效指令清单，命令菜单未注册' }));
  return null;
}

// Telegram 指令名仅允许小写字母、数字与下划线（1-32 位）
function normalizeBotCommands(pairs) {
  const commands = asArray(pairs)
    .map((item) => ({
      command: String(item?.command || '').trim().replace(/^\//, '').toLowerCase(),
      description: String(item?.description || '').trim(),
    }))
    .filter((item) => /^[a-z0-9_]{1,32}$/.test(item.command) && item.description);
  return commands.length ? commands : null;
}

export function getEnableForumTopics() {
  return getOptionalEnv('ENV_ENABLE_FORUM_TOPICS', 'false') === 'true';
}

export function getUserAckCooldownMs() {
  return Number(getOptionalEnv('ENV_USER_ACK_COOLDOWN_MS', '30000'));
}

export function getCommandWarningCooldownMs() {
  return Number(getOptionalEnv('ENV_COMMAND_WARNING_COOLDOWN_MS', '60000'));
}

export function getKeywordViolationTtl() {
  return Number(getOptionalEnv('ENV_KEYWORD_VIOLATION_TTL_SECONDS', String(24 * 3600)));
}

// 可选功能的「默认开启」模式开关：显式设为 false/0/off/no 视为关闭（与 build.js FEATURE_OFF_VALUES 保持一致）
const FEATURE_OFF_VALUES = ['false', '0', 'off', 'no'];

export function isFeatureOff(name, fallback = 'true') {
  return FEATURE_OFF_VALUES.includes(String(getOptionalEnv(name, fallback)).trim().toLowerCase());
}

export function getEnableFraudCheck() {
  return !isFeatureOff('ENV_ENABLE_FRAUD_CHECK');
}

export function getKeywordDbUrl() {
  return getOptionalEnv('ENV_KEYWORD_DB_URL', 'https://raw.githubusercontent.com/ekishion/nfd/main/data/keyword.db');
}

export function getNotificationUrl() {
  return getOptionalEnv('ENV_NOTIFICATION_URL');
}

export function getStartMsgUrl() {
  return getOptionalEnv('ENV_START_MESSAGE_URL');
}

export function getPushdeerKey() {
  return getOptionalEnv('ENV_PUSHDEER_KEY');
}

export function getPushdeerUrl() {
  return getOptionalEnv('ENV_PUSHDEER_URL');
}

export function getServerchanKey() {
  return getOptionalEnv('ENV_SERVERCHAN_KEY');
}

export function getNotifyChannelsOnAlertOnly() {
  return getOptionalEnv('ENV_NOTIFY_CHANNELS_ON_ALERT_ONLY', 'false') === 'true';
}

export const ADMIN_COMMANDS = new Set([
  '/help',
  '/panel',
  '/config',
  '/stats',
  '/keywords',
  '/addkeyword',
  '/delkeyword',
  '/synckeywords',
  '/block',
  '/unblock',
  '/checkblock',
  '/quick',
  '/q',
  '/quicks',
  '/addquick',
  '/delquick',
  '/away',
  '/back',
  '/user',
  '/tag',
]);

export const ADMIN_GREETING = '*管理人好喵*，这里是人偶！\n\n发送 `/panel` 可打开交互式控制面板，发送 `/help` 可查看管理手册。';

export const DEFAULT_START_MESSAGE = typeof defaultStartMessage === 'string' && defaultStartMessage
  ? defaultStartMessage.trim()
  : [
      '您好 {username}，这里是人偶。',
      '',
      '请在下方直接发送文字、图片或文件，我会帮您转达给管理人。',
    ].join('\n');

export const DEFAULT_NOTIFICATION = typeof defaultNotification === 'string' && defaultNotification
  ? defaultNotification.trim()
  : [
      '*交易安全提醒*',
      '',
      '1\\. 交易前请核实对方在论坛的身份与信用记录。',
      '2\\. 付款或交付前，请确认商品、账号或服务真实可用。',
      '3\\. 涉及较大金额建议使用中介担保。',
      '4\\. 如遇可疑情况，请及时在群内或论坛反馈。',
    ].join('\n');

export function getDefaultEnvConfig() {
  return {
    req_username: getOptionalEnv('ENV_REQUIRE_USERNAME', 'false') === 'true',
    req_photo: getOptionalEnv('ENV_REQUIRE_PHOTO', getOptionalEnv('ENV_REQUIRE_AVATAR', 'false')) === 'true',
    auto_block: getOptionalEnv('ENV_AUTO_BLOCK_KEYWORD_VIOLATORS', 'true') !== 'false',
    violation_limit: Number(getOptionalEnv('ENV_KEYWORD_VIOLATION_LIMIT', '3')),
    delay_seconds: Math.max(0, Number(getOptionalEnv('ENV_FORWARD_DELAY_SECONDS', getOptionalEnv('ENV_FORWARD_DELAY', '0')))),
    notice_admin: getOptionalEnv('ENV_KEYWORD_NOTICE_TO_ADMIN', 'true') !== 'false',
    notice_user: getOptionalEnv('ENV_KEYWORD_NOTICE_TO_USER', 'true') !== 'false',
    enable_notify: getOptionalEnv('ENV_ENABLE_NOTIFICATION', 'true') !== 'false',
    flood_protect: getOptionalEnv('ENV_ENABLE_FLOOD_PROTECTION', 'true') !== 'false',
    flood_limit: Number(getOptionalEnv('ENV_FLOOD_LIMIT', '5')),
    flood_window_seconds: Number(getOptionalEnv('ENV_FLOOD_WINDOW_SECONDS', '10')),
    flood_mute_seconds: Number(getOptionalEnv('ENV_FLOOD_MUTE_SECONDS', '60')),
    block_executables: getOptionalEnv('ENV_BLOCK_EXECUTABLES', 'true') !== 'false',
    away_mode: getOptionalEnv('ENV_AWAY_MODE', 'false') === 'true',
    away_message: getOptionalEnv('ENV_AWAY_MESSAGE', '人偶现在外出中，稍后会尽快回复您的留言喵。'),
    forward_chat_id: getForwardChatId(),
    forward_thread_id: getForwardThreadId(),
    alert_chat_id: getAlertChatId(),
    alert_thread_id: getAlertThreadId(),
    enable_forum_topics: getEnableForumTopics(),
  };
}

export function getOptionalEnv(name, fallback = '') {
  return Object.prototype.hasOwnProperty.call(globalThis, name) ? String(globalThis[name] ?? '') : fallback;
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
