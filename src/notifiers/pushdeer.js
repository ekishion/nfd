// ==============================================================================
// src/notifiers/pushdeer.js - PushDeer Native & Self-Hosted Push Adapter
// ==============================================================================

import { getPushdeerKey, getPushdeerUrl } from '../config.js';

export const pushdeerAdapter = {
  name: 'PushDeer',
  isEnabled: () => Boolean(getPushdeerKey()),
  send: async (notice) => {
    const pushkey = getPushdeerKey();
    if (!pushkey) return null;

    let endpoint = getPushdeerUrl() || 'https://api2.pushdeer.com/message/push';
    if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      endpoint = `https://${endpoint}`;
    }
    if (!endpoint.endsWith('/message/push')) {
      endpoint = `${endpoint.replace(/\/+$/, '')}/message/push`;
    }

    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pushkey,
        text: notice.title,
        desp: notice.markdown,
        type: 'markdown',
      }),
    });
  },
};
