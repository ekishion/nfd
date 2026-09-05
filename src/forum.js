// ==============================================================================
// src/forum.js - Auto Forum Topic Creation (可选功能模块)
// ENV_ENABLE_FORUM_TOPICS 开启时为每位新客人在论坛超级群内创建专属话题；
// 未配置时由 build.js 注入空实现、不参与打包（详见 build.js FEATURE_MODULES）
// ==============================================================================

import { getGuestTopicId, setGuestTopicId } from './cache.js';
import { buildUserName, createForumTopic } from './telegram.js';

export async function resolveForumTopicThreadId(config, firstMessage, senderKey, forwardChatId) {
  if (!config.enable_forum_topics || !forwardChatId.startsWith('-')) return null;

  let topicId = await getGuestTopicId(senderKey);
  if (!topicId) {
    const senderName = buildUserName(firstMessage.from || {}) || firstMessage.chat?.title || '匿名来源';
    const topicName = `${senderName} (${senderKey})`.slice(0, 128);
    const createRes = await createForumTopic({
      chat_id: forwardChatId,
      name: topicName,
    });
    if (createRes.ok && createRes.result?.message_thread_id) {
      topicId = createRes.result.message_thread_id;
      await setGuestTopicId(senderKey, topicId);
    }
  }
  return topicId || null;
}
