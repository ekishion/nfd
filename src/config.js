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

export function getToken() {
  return getOptionalEnv('ENV_BOT_TOKEN');
}

export function getSecret() {
  return getOptionalEnv('ENV_BOT_SECRET');
}

export function getAdminUid() {
  return String(getOptionalEnv('ENV_ADMIN_UID', ''));
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

export function getFraudDbUrl() {
  return getOptionalEnv('ENV_FRAUD_DB_URL', 'https://raw.githubusercontent.com/ekishion/nfd/main/data/fraud.db');
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
]);

export const DEFAULT_START_MESSAGE = typeof defaultStartMessage === 'string' && defaultStartMessage
  ? defaultStartMessage.trim()
  : [
      '👋🏻 您好 {username}，这里是人偶，需要留言吗！',
      '',
      '⬇️ __请在下方输入框发送消息__（或发送媒体），我帮你转达喵',
    ].join('\n');

export const DEFAULT_NOTIFICATION = typeof defaultNotification === 'string' && defaultNotification
  ? defaultNotification.trim()
  : [
      '*人偶小提醒*',
      '',
      '1\\. 交易前请确认对方在 NodeSeek 的身份。',
      '2\\. 付款或交付前，尽量确认商品、账号或服务确实存在。',
      '3\\. 大额交易建议走论坛中介，人偶会比较安心。',
      '4\\. 如果感觉不对劲，请及时到论坛或群组反馈喵。',
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
