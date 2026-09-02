// ==============================================================================
// src/notifiers/serverchan.js - ServerChan WeChat Notification Adapter
// ==============================================================================

import { getServerchanKey } from '../config.js';

export const serverchanAdapter = {
  name: 'ServerChan',
  isEnabled: () => Boolean(getServerchanKey()),
  send: async (notice) => {
    const key = getServerchanKey();
    if (!key) return null;
    return fetch(`https://sctapi.ftqq.com/${key}.send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: notice.title,
        desp: notice.markdown,
      }),
    });
  },
};
