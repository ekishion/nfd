// ==============================================================================
// src/commands.js - Bot Command Menu Registration (setMyCommands)
// 可选功能模块：菜单内容由 ENV_BOT_COMMANDS 提供，未配置时由 build.js 注入空实现、不参与打包
// ==============================================================================

import { getBotCommands } from './config.js';
import { apiUrl } from './telegram.js';

export async function registerBotCommands() {
  const commands = getBotCommands();
  if (!commands || !commands.length) return;

  await fetch(apiUrl('setMyCommands'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commands }),
  }).catch((err) => {
    console.log(JSON.stringify({ error: 'set-my-commands-failed', message: err.message }));
  });
}
