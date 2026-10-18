// ==============================================================================
// src/commands.js - Bot Command Menu Registration (setMyCommands)
// 可选功能模块：菜单内容由 ENV_BOT_COMMANDS 提供，未配置时由 build.js 注入空实现、不参与打包
// ==============================================================================

import { getBotCommands } from './config.js';
import { requestTelegram } from './telegram.js';

export async function registerBotCommands() {
  const commands = getBotCommands();
  if (commands && commands.length > 0) {
    await requestTelegram('setMyCommands', { commands }).catch((err) => {
      console.log(JSON.stringify({ error: 'set-my-commands-failed', message: err.message }));
    });
  } else {
    await requestTelegram('deleteMyCommands').catch((err) => {
      console.log(JSON.stringify({ error: 'delete-my-commands-failed', message: err.message }));
    });
  }
}
