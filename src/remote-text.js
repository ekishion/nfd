// ==============================================================================
// src/remote-text.js - Remote Customized Text (可选功能模块)
// /start 欢迎语与交易安全提醒支持通过远程 URL 覆盖默认文案；
// ENV_START_MESSAGE_URL / ENV_NOTIFICATION_URL 均未配置时由 build.js 裁剪
// ==============================================================================

import { getMemoryCache, setMemoryCache } from './cache.js';
import { getNotificationUrl, getStartMsgUrl } from './config.js';

export async function fetchTextOrDefault(url, fallback) {
  if (!url) return fallback;
  const cached = getMemoryCache(`text-${url}`);
  if (cached) return cached;
  try {
    const response = await fetch(url);
    if (response.ok) {
      const text = await response.text();
      setMemoryCache(`text-${url}`, text, 10 * 60 * 1000);
      return text;
    }
    return fallback;
  } catch (error) {
    console.log(JSON.stringify({ error: 'fetch-text-failed', url, message: error.message }));
    return fallback;
  }
}

export async function fetchStartMessage(fallback) {
  return fetchTextOrDefault(getStartMsgUrl(), fallback);
}

export async function fetchNotificationText(fallback) {
  return fetchTextOrDefault(getNotificationUrl(), fallback);
}
