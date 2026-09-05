// ==============================================================================
// src/notifiers/index.js - Central Outbound Notification Dispatcher
// Aggregates sub-adapters from ./notifiers/*.js (PushDeer & ServerChan)
// ==============================================================================

import { getNotifyChannelsOnAlertOnly } from '../config.js';
import { buildNotificationContent } from './base.js';
import { pushdeerAdapter } from './pushdeer.js';
import { serverchanAdapter } from './serverchan.js';

// 单文件打包按需裁剪：未打包的适配器不会出现在作用域中，
// 用 typeof 守卫避免「仅配置一个通道」时引用未定义标识符导致崩溃
export const notificationProviders = {};
if (typeof pushdeerAdapter === 'function') {
  notificationProviders.pushdeer = pushdeerAdapter;
}
if (typeof serverchanAdapter === 'function') {
  notificationProviders.serverchan = serverchanAdapter;
}

export { buildNotificationContent };

/**
 * Unified Dispatcher: Dispatches to all enabled adapters concurrently
 * @param {'guest_message' | 'security_alert'} event
 * @param {object} payload
 */
export async function dispatchNotification(event, payload = {}) {
  try {
    const onAlertOnly = getNotifyChannelsOnAlertOnly();
    if (onAlertOnly && event !== 'security_alert') {
      return;
    }

    const enabledAdapters = Object.entries(notificationProviders).filter(([, p]) => p.isEnabled());
    if (!enabledAdapters.length) {
      return;
    }

    const notice = buildNotificationContent(event, payload);

    const tasks = enabledAdapters.map(async ([key, provider]) => {
      try {
        await provider.send(notice);
      } catch (err) {
        console.log(JSON.stringify({ error: 'notify-provider-failed', provider: key, message: err.message }));
      }
    });

    await Promise.allSettled(tasks);
  } catch (err) {
    console.log(JSON.stringify({ error: 'dispatch-notification-failed', message: err.message }));
  }
}
