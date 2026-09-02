// ==============================================================================
// src/notifiers/index.js - Central Outbound Notification Dispatcher
// Aggregates sub-adapters from ./notifiers/*.js (PushDeer & ServerChan)
// ==============================================================================

import { getNotifyChannelsOnAlertOnly } from '../config.js';
import { buildNotificationContent } from './base.js';
import { pushdeerAdapter } from './pushdeer.js';
import { serverchanAdapter } from './serverchan.js';

export const notificationProviders = {
  pushdeer: pushdeerAdapter,
  serverchan: serverchanAdapter,
};

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
