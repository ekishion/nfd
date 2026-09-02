const TOKEN = globalThis.ENV_BOT_TOKEN; // Get it from @BotFather
const WEBHOOK = '/endpoint';
const SECRET = globalThis.ENV_BOT_SECRET; // A-Z, a-z, 0-9, _ and -
const ADMIN_UID = String(globalThis.ENV_ADMIN_UID); // Your user id

const PARSE_MODE = 'MarkdownV2';
const NOTIFY_INTERVAL = 3600 * 1000;
const FRAUD_CACHE_TTL = 30 * 60 * 1000;
const MESSAGE_MAP_TTL = 30 * 24 * 3600;
const USER_ACK_COOLDOWN_MS = Number(getOptionalEnv('ENV_USER_ACK_COOLDOWN_MS', '30000'));
const COMMAND_WARNING_COOLDOWN_MS = Number(getOptionalEnv('ENV_COMMAND_WARNING_COOLDOWN_MS', '60000'));
const KEYWORD_VIOLATION_LIMIT = Number(getOptionalEnv('ENV_KEYWORD_VIOLATION_LIMIT', '3'));
const KEYWORD_VIOLATION_TTL = Number(getOptionalEnv('ENV_KEYWORD_VIOLATION_TTL_SECONDS', String(24 * 3600)));
const ENABLE_NOTIFICATION = getOptionalEnv('ENV_ENABLE_NOTIFICATION', 'true') !== 'false';
const KEYWORD_NOTICE_TO_USER = getOptionalEnv('ENV_KEYWORD_NOTICE_TO_USER', 'true') !== 'false';
const KEYWORD_NOTICE_TO_ADMIN = getOptionalEnv('ENV_KEYWORD_NOTICE_TO_ADMIN', 'true') !== 'false';
const REQUIRE_USERNAME = getOptionalEnv('ENV_REQUIRE_USERNAME', 'false') === 'true';
const AUTO_BLOCK_KEYWORD_VIOLATORS = getOptionalEnv('ENV_AUTO_BLOCK_KEYWORD_VIOLATORS', 'true') !== 'false';

const fraudDb = getOptionalEnv('ENV_FRAUD_DB_URL', 'https://raw.githubusercontent.com/ekishion/nfd/main/data/fraud.db');
const keywordDb = getOptionalEnv('ENV_KEYWORD_DB_URL', 'https://raw.githubusercontent.com/ekishion/nfd/main/data/keyword.db');
const notificationUrl = getOptionalEnv('ENV_NOTIFICATION_URL');
const startMsgUrl = getOptionalEnv('ENV_START_MESSAGE_URL');

const ADMIN_COMMANDS = new Set([
  '/help',
  '/stats',
  '/keywords',
  '/addkeyword',
  '/delkeyword',
  '/synckeywords',
  '/block',
  '/unblock',
  '/checkblock',
]);

const DEFAULT_START_MESSAGE = [
  '👋🏻 您好 {username}，这里是人偶，需要留言吗！',
  '',
  '⬇️ __请在下方输入框发送消息__（或发送媒体），我帮你转达喵',
].join('\n');

const DEFAULT_NOTIFICATION = [
  '*人偶小提醒*',
  '',
  '1\\. 交易前请确认对方在 NodeSeek 的身份。',
  '2\\. 付款或交付前，尽量确认商品、账号或服务确实存在。',
  '3\\. 大额交易建议走论坛中介，人偶会比较安心。',
  '4\\. 如果感觉不对劲，请及时到论坛或群组反馈喵。',
].join('\n');

const remoteDbCache = new Map();

function getOptionalEnv(name, fallback = '') {
  return Object.prototype.hasOwnProperty.call(globalThis, name) ? String(globalThis[name] ?? '') : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function fetchRemoteDb(url, ttl = FRAUD_CACHE_TTL) {
  const cached = remoteDbCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.lines;
  const text = await fetch(url).then((r) => r.text());
  const lines = text.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
  remoteDbCache.set(url, { expiresAt: Date.now() + ttl, lines });
  return lines;
}

function apiUrl(methodName, params = null) {
  const query = params ? `?${new URLSearchParams(params).toString()}` : '';
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`;
}

async function requestTelegram(methodName, body = {}) {
  const response = await fetch(apiUrl(methodName), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!data.ok) {
    console.log(JSON.stringify({ methodName, error: data.description, body }));
  }
  return data;
}

function sendMessage(msg = {}) {
  return requestTelegram('sendMessage', msg);
}

function copyMessage(msg = {}) {
  return requestTelegram('copyMessage', msg);
}

function forwardMessage(msg = {}) {
  return requestTelegram('forwardMessage', msg);
}

function deleteMessage(msg = {}) {
  return requestTelegram('deleteMessage', msg);
}

function answerCallbackQuery(msg = {}) {
  return requestTelegram('answerCallbackQuery', msg);
}

function escapeMarkdown(value = '') {
  return String(value).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function sendMarkdown(chatId, text, extra = {}) {
  return sendMessage({
    chat_id: chatId,
    text,
    parse_mode: PARSE_MODE,
    link_preview_options: { is_disabled: true },
    ...extra,
  });
}

function sendPlainText(chatId, text, extra = {}) {
  return sendMessage({
    chat_id: chatId,
    text,
    ...extra,
  });
}

function mdLine(label, value) {
  return `*${escapeMarkdown(label)}:* ${escapeMarkdown(value || '-')}`;
}

function getMessageText(message) {
  return message.text || message.caption || '';
}

function getCommand(message) {
  const text = (message.text || '').trim();
  return text.startsWith('/') ? text.split(/\s+/)[0].split('@')[0].toLowerCase() : '';
}

function getCommandArgs(message) {
  const text = (message.text || '').trim();
  const firstSpace = text.search(/\s/);
  return firstSpace === -1 ? '' : text.slice(firstSpace).trim();
}

function buildUserName(user = {}) {
  const nickname = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  if (nickname) return nickname;
  if (user.username) return `@${user.username}`;
  return String(user.id || '');
}

function formatStartMessage(template, user) {
  const username = escapeMarkdown(buildUserName(user));
  return template
    .replaceAll('{username}', username)
    .replaceAll('{用户名}', username);
}

function buildMessageInfo(message) {
  const user = message.from || {};
  const lines = [
    '*人偶收到新留言*',
    mdLine('客人', `${buildUserName(user)} (${user.id || message.chat.id})`),
  ];
  if (user.username) {
    lines.push(mdLine('用户名', `@${user.username}`));
  }
  if (message.chat?.type && message.chat.type !== 'private') {
    lines.push(mdLine('来源会话', `${message.chat.title || message.chat.id} / ${message.chat.type}`));
  }
  return lines.join('\n');
}

function buildGuestInfo(message) {
  const user = message.from || {};
  return {
    chatId: String(message.chat.id),
    userId: String(user.id || message.chat.id),
    name: buildUserName(user),
    username: user.username ? `@${user.username}` : '',
    languageCode: user.language_code || '',
    chatType: message.chat?.type || '',
    chatTitle: message.chat?.title || '',
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
  };
}

function formatGuestInfo(info = {}) {
  return [
    '*留言人信息*',
    mdLine('昵称', info.name || '-'),
    mdLine('用户名', info.username || '-'),
    mdLine('用户ID', info.userId || info.chatId || '-'),
    mdLine('会话ID', info.chatId || '-'),
    mdLine('语言', info.languageCode || '-'),
    mdLine('会话类型', info.chatType || '-'),
    mdLine('会话标题', info.chatTitle || '-'),
    mdLine('最后留言', info.lastSeenAt ? new Date(info.lastSeenAt).toISOString() : '-'),
  ].join('\n');
}

function adminMessageKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '回复', callback_data: 'reply' },
        { text: '信息', callback_data: 'info' },
        { text: '撤回最近回复', callback_data: 'revoke:last' },
      ],
      [
        { text: '屏蔽', callback_data: 'block' },
        { text: '解除屏蔽', callback_data: 'unblock' },
        { text: '检查', callback_data: 'checkblock' },
      ],
    ],
  };
}

function revokeReplyKeyboard(guestChatId, messageId) {
  return {
    inline_keyboard: [[
      { text: '撤回这条回复', callback_data: `revoke:${guestChatId}:${messageId}` },
    ]],
  };
}

async function kvGetJson(key, fallback = null) {
  const value = await nfd.get(key, { type: 'json' });
  return value === null || value === undefined ? fallback : value;
}

async function kvPutJson(key, value, options = {}) {
  return nfd.put(key, JSON.stringify(value), options);
}

async function incrementStat(name) {
  const key = `stat-${name}`;
  const current = Number((await nfd.get(key)) || 0);
  await nfd.put(key, String(current + 1));
}

async function sendCooldownPlainText(chatId, key, text, cooldownMs) {
  const lastSentAt = Number((await nfd.get(key)) || 0);
  if (lastSentAt && Date.now() - lastSentAt < cooldownMs) return null;
  await nfd.put(key, String(Date.now()));
  return sendPlainText(chatId, text);
}

async function getKeywordRules() {
  const fromKv = await kvGetJson('blocked-keywords', []);
  const fromDb = await fetchKeywordDb();
  return Array.from(new Set([...fromDb, ...asArray(fromKv)]));
}

async function findBlockedKeyword(message) {
  const content = getMessageText(message).toLowerCase();
  if (!content) return '';

  const rules = await getKeywordRules();
  return rules.find((keyword) => content.includes(keyword.toLowerCase())) || '';
}

async function recordKeywordViolation(message, keyword) {
  const chatId = String(message.chat.id);
  const key = `keyword-violation-${chatId}`;
  const current = await kvGetJson(key, { count: 0, expiresAt: 0 });
  const now = Date.now();
  const count = current.expiresAt > now ? Number(current.count || 0) + 1 : 1;
  const record = {
    count,
    lastKeyword: keyword,
    updatedAt: now,
    expiresAt: now + KEYWORD_VIOLATION_TTL * 1000,
  };
  await kvPutJson(key, record, { expirationTtl: KEYWORD_VIOLATION_TTL });
  return record;
}

async function notifyKeywordBlocked(message, keyword, violation) {
  await incrementStat('keyword-blocked');
  if (!KEYWORD_NOTICE_TO_ADMIN) return null;
  const lines = [
    '*人偶拦下了一条留言*',
    mdLine('关键词', keyword),
    mdLine('累计次数', violation.count),
    mdLine('用户ID', message.chat.id),
    mdLine('客人', buildUserName(message.from || {})),
  ];
  if (AUTO_BLOCK_KEYWORD_VIOLATORS && violation.count >= KEYWORD_VIOLATION_LIMIT) {
    lines.push(mdLine('处理', '已自动拉入黑名单'));
  }
  return sendMarkdown(ADMIN_UID, lines.join('\n'));
}

async function getMappedGuestId(adminMessage) {
  const replyMessageId = adminMessage?.reply_to_message?.message_id;
  if (!replyMessageId) return null;
  return kvGetJson(`msg-map-${replyMessageId}`, null);
}

async function rememberMessageMap(adminMessageId, guestChatId) {
  return kvPutJson(`msg-map-${adminMessageId}`, String(guestChatId), {
    expirationTtl: MESSAGE_MAP_TTL,
  });
}

async function rememberForceReplyPrompt(promptMessageId, guestChatId) {
  return kvPutJson(`force-reply-${promptMessageId}`, {
    guestChatId: String(guestChatId),
    createdAt: Date.now(),
  }, { expirationTtl: MESSAGE_MAP_TTL });
}

async function clearForceReplyPrompt(promptMessageId) {
  return kvPutJson(`force-reply-${promptMessageId}`, null, { expirationTtl: 60 });
}

async function rememberGuestInfo(message) {
  const chatId = String(message.chat.id);
  const previous = await kvGetJson(`guest-info-${chatId}`, null);
  const next = {
    ...buildGuestInfo(message),
    firstSeenAt: previous?.firstSeenAt || Date.now(),
  };
  await kvPutJson(`guest-info-${chatId}`, next);
  return next;
}

async function fetchTextOrDefault(url, fallback) {
  if (!url) return fallback;
  try {
    const response = await fetch(url);
    return response.ok ? response.text() : fallback;
  } catch (error) {
    console.log(JSON.stringify({ error: 'fetch-text-failed', url, message: error.message }));
    return fallback;
  }
}

addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event));
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(url));
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook());
  } else {
    event.respondWith(new Response('No handler for this request'));
  }
});

async function handleWebhook(event) {
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 });
  }

  const update = await event.request.json();
  event.waitUntil(onUpdate(update));
  return new Response('Ok');
}

async function onUpdate(update) {
  if (update.message) {
    await onMessage(update.message);
  } else if (update.callback_query) {
    await onCallbackQuery(update.callback_query);
  }
}

async function onMessage(message) {
  if (!message?.chat?.id) return;

  const command = getCommand(message);
  if (command === '/start') {
    const startMsg = await fetchTextOrDefault(startMsgUrl, DEFAULT_START_MESSAGE);
    return sendMarkdown(message.chat.id, formatStartMessage(startMsg, message.from || {}));
  }

  if (String(message.chat.id) === ADMIN_UID) {
    return handleAdminMessage(message, command);
  }

  if (ADMIN_COMMANDS.has(command)) {
    return handleGuestAdminCommand(message, command);
  }

  return handleGuestMessage(message);
}

async function clearRepliedPrompt(message) {
  const promptId = message.reply_to_message?.message_id;
  if (!promptId) return;
  const record = await kvGetJson(`force-reply-${promptId}`, null);
  if (!record) return;
  await deleteMessage({ chat_id: ADMIN_UID, message_id: promptId });
  await clearForceReplyPrompt(promptId);
}

async function handleAdminMessage(message, command) {
  if (command === '/help') return sendAdminHelp();
  if (command === '/stats') return sendStats();
  if (command === '/keywords') return listKeywords();
  if (command === '/addkeyword') return addKeyword(message);
  if (command === '/delkeyword') return deleteKeyword(message);
  if (command === '/synckeywords') return syncKeywordDb();

  if (command === '/block') return handleBlock(message);
  if (command === '/unblock') return handleUnBlock(message);
  if (command === '/checkblock') return checkBlock(message);

  const guestChatId = await getMappedGuestId(message);
  if (!guestChatId) {
    return sendAdminHelp('请先回复一条人偶转来的留言，再发送回复或管理命令。');
  }

  const copied = await copyMessage({
    chat_id: guestChatId,
    from_chat_id: message.chat.id,
    message_id: message.message_id,
  });

  if (copied.ok) {
    await incrementStat('admin-replied');
    await kvPutJson(`last-reply-${guestChatId}`, {
      chatId: String(guestChatId),
      messageId: copied.result.message_id,
      adminMessageId: message.message_id,
      createdAt: Date.now(),
    });
    await clearRepliedPrompt(message);
    return sendMarkdown(ADMIN_UID, escapeMarkdown(`人偶已经转达给 UID:${guestChatId} 了喵`), {
      reply_parameters: { message_id: message.message_id },
      reply_markup: revokeReplyKeyboard(guestChatId, copied.result.message_id),
    });
  }

  await clearRepliedPrompt(message);
  return sendMarkdown(ADMIN_UID, escapeMarkdown(`转达失败：${copied.description || 'Unknown error'}`));
}

async function handleGuestAdminCommand(message, command) {
  const chatId = String(message.chat.id);
  await incrementStat('guest-command-warning');
  await sendMarkdown(
    ADMIN_UID,
    [
      '*客人误触管理指令*',
      mdLine('指令', command),
      mdLine('用户ID', chatId),
      mdLine('客人', buildUserName(message.from || {})),
    ].join('\n'),
  );
  return sendCooldownPlainText(
    chatId,
    `warn-command-${chatId}`,
    '这是管理人专用的小按钮喵。请直接发送想留言的内容，人偶会帮你转达。',
    COMMAND_WARNING_COOLDOWN_MS,
  );
}

async function onCallbackQuery(callbackQuery) {
  if (String(callbackQuery.from?.id) !== ADMIN_UID) {
    return answerCallbackQuery({
      callback_query_id: callbackQuery.id,
      text: '这是管理人专用按钮喵。',
      show_alert: false,
    });
  }

  const data = callbackQuery.data || '';
  const adminMessageId = callbackQuery.message?.message_id;
  const guestChatId = adminMessageId ? await kvGetJson(`msg-map-${adminMessageId}`, null) : null;

  if (data === 'reply') {
    if (!guestChatId) return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '找不到这位客人了喵。' });
    const prompt = await sendMarkdown(ADMIN_UID, escapeMarkdown(`请回复这条消息，人偶会转达给 UID:${guestChatId} 喵。`), {
      reply_parameters: { message_id: adminMessageId },
      reply_markup: {
        force_reply: true,
        input_field_placeholder: '输入要转达给客人的内容',
        selective: true,
      },
    });
    if (prompt.ok) {
      await rememberMessageMap(prompt.result.message_id, guestChatId);
      await rememberForceReplyPrompt(prompt.result.message_id, guestChatId);
    }
    return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '请回复人偶的新提示消息。' });
  }

  if (data === 'info') {
    if (!guestChatId) return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '找不到留言人信息了喵。' });
    const info = await kvGetJson(`guest-info-${guestChatId}`, null);
    await sendMarkdown(ADMIN_UID, info ? formatGuestInfo(info) : escapeMarkdown(`没有找到 UID:${guestChatId} 的详细信息。`), {
      reply_parameters: { message_id: adminMessageId },
    });
    return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '已展开留言人信息。' });
  }

  if (data === 'block' || data === 'unblock' || data === 'checkblock') {
    if (!guestChatId) return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '找不到这位客人了喵。' });
    const text = await applyBlockAction(data, guestChatId);
    await sendMarkdown(ADMIN_UID, escapeMarkdown(text), {
      reply_parameters: { message_id: adminMessageId },
    });
    return answerCallbackQuery({ callback_query_id: callbackQuery.id, text });
  }

  if (data === 'revoke:last') {
    if (!guestChatId) return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '找不到这位客人了喵。' });
    const lastReply = await kvGetJson(`last-reply-${guestChatId}`, null);
    if (!lastReply?.messageId) {
      return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '还没有可撤回的回复喵。' });
    }
    return revokeReply(callbackQuery, lastReply.chatId || guestChatId, lastReply.messageId);
  }

  if (data.startsWith('revoke:')) {
    const [, chatId, messageId] = data.split(':');
    return revokeReply(callbackQuery, chatId, messageId);
  }

  return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '人偶还不认识这个按钮喵。' });
}

async function applyBlockAction(action, guestChatId) {
  if (action === 'block') {
    if (String(guestChatId) === ADMIN_UID) return '人偶不能屏蔽主人自己喵。';
    await kvPutJson(`isblocked-${guestChatId}`, true);
    return `UID:${guestChatId} 已放入静音抽屉`;
  }
  if (action === 'unblock') {
    await kvPutJson(`isblocked-${guestChatId}`, false);
    return `UID:${guestChatId} 已从静音抽屉取出`;
  }
  const blocked = await kvGetJson(`isblocked-${guestChatId}`, false);
  return `UID:${guestChatId} ${blocked ? '正在静音抽屉里' : '可以正常留言'}`;
}

async function revokeReply(callbackQuery, chatId, messageId) {
  if (!chatId || !messageId) {
    return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '撤回目标不完整喵。' });
  }
  const result = await deleteMessage({
    chat_id: chatId,
    message_id: Number(messageId),
  });
  if (!result.ok) {
    return answerCallbackQuery({
      callback_query_id: callbackQuery.id,
      text: `撤回失败：${result.description || 'Unknown error'}`,
      show_alert: true,
    });
  }
  await sendMarkdown(ADMIN_UID, escapeMarkdown(`已撤回发给 UID:${chatId} 的回复。`));
  return answerCallbackQuery({ callback_query_id: callbackQuery.id, text: '已撤回。' });
}

async function handleGuestMessage(message) {
  const chatId = String(message.chat.id);
  await incrementStat('guest-message');
  await rememberGuestInfo(message);

  const isBlocked = await kvGetJson(`isblocked-${chatId}`, false);
  if (isBlocked) {
    await incrementStat('blocked-user-message');
    return sendCooldownPlainText(chatId, `blocked-notice-${chatId}`, '这里暂时不能继续留言了喵。', COMMAND_WARNING_COOLDOWN_MS);
  }

  if (REQUIRE_USERNAME && !message.from?.username) {
    await incrementStat('no-username-blocked');
    return sendCooldownPlainText(
      chatId,
      `no-username-${chatId}`,
      '请先在 Telegram 设置用户名（Username / @xxx）后再留言喵。',
      COMMAND_WARNING_COOLDOWN_MS,
    );
  }

  const blockedKeyword = await findBlockedKeyword(message);
  if (blockedKeyword) {
    const violation = await recordKeywordViolation(message, blockedKeyword);
    if (AUTO_BLOCK_KEYWORD_VIOLATORS && violation.count >= KEYWORD_VIOLATION_LIMIT) {
      await kvPutJson(`isblocked-${chatId}`, true);
      await incrementStat('keyword-auto-blocked');
    }
    await notifyKeywordBlocked(message, blockedKeyword, violation);
    if (KEYWORD_NOTICE_TO_USER) {
      const text = violation.count >= KEYWORD_VIOLATION_LIMIT
        ? '多次发送不能转达的内容，这里暂时不能继续留言了喵。'
        : '这条留言含有暂时不能转达的词，人偶先收起来了喵。';
      return sendCooldownPlainText(chatId, `keyword-notice-${chatId}`, text, COMMAND_WARNING_COOLDOWN_MS);
    }
    return;
  }

  const infoReq = await sendMarkdown(ADMIN_UID, buildMessageInfo(message));
  if (infoReq.ok) {
    await rememberMessageMap(infoReq.result.message_id, chatId);
  }

  const copyReq = await copyMessage({
    chat_id: ADMIN_UID,
    from_chat_id: message.chat.id,
    message_id: message.message_id,
    reply_markup: adminMessageKeyboard(),
  });

  if (copyReq.ok) {
    await rememberMessageMap(copyReq.result.message_id, chatId);
    await handleGuestDelivered(message);
    return;
  }

  const forwardReq = await forwardMessage({
    chat_id: ADMIN_UID,
    from_chat_id: message.chat.id,
    message_id: message.message_id,
  });

  if (forwardReq.ok) {
    await rememberMessageMap(forwardReq.result.message_id, chatId);
    await handleGuestDelivered(message);
    return;
  }

  await sendMarkdown(
    ADMIN_UID,
    [
      '*人偶转达失败*',
      mdLine('用户ID', chatId),
      mdLine('错误', forwardReq.description || copyReq.description || 'Unknown error'),
    ].join('\n'),
  );
}

async function handleGuestDelivered(message) {
  const chatId = String(message.chat.id);
  await sendCooldownPlainText(
    chatId,
    `deliver-ack-${chatId}`,
    '留言已经交给管理人啦，人偶会乖乖等回信喵。',
    USER_ACK_COOLDOWN_MS,
  );
  await handleNotify(message);
}

async function handleNotify(message) {
  const chatId = String(message.chat.id);
  if (await isFraud(chatId)) {
    return sendMarkdown(ADMIN_UID, `*诈骗库命中*\n${mdLine('UID', chatId)}`);
  }

  if (!ENABLE_NOTIFICATION) return;

  const lastMsgTime = await kvGetJson(`lastmsg-${chatId}`, 0);
  if (!lastMsgTime || Date.now() - Number(lastMsgTime) > NOTIFY_INTERVAL) {
    await nfd.put(`lastmsg-${chatId}`, String(Date.now()));
    const notification = await fetchTextOrDefault(notificationUrl, DEFAULT_NOTIFICATION);
    return sendMarkdown(ADMIN_UID, notification);
  }
}

async function handleBlock(message) {
  const guestChatId = await getMappedGuestId(message);
  if (!guestChatId) return sendAdminHelp('请回复一条客人的留言后再使用 /block。');
  if (String(guestChatId) === ADMIN_UID) {
    return sendPlainText(ADMIN_UID, '人偶不能屏蔽主人自己喵。');
  }

  await kvPutJson(`isblocked-${guestChatId}`, true);
  return sendMarkdown(ADMIN_UID, escapeMarkdown(`UID:${guestChatId} 已放入静音抽屉`));
}

async function handleUnBlock(message) {
  const guestChatId = await getMappedGuestId(message);
  if (!guestChatId) return sendAdminHelp('请回复一条客人的留言后再使用 /unblock。');

  await kvPutJson(`isblocked-${guestChatId}`, false);
  return sendMarkdown(ADMIN_UID, escapeMarkdown(`UID:${guestChatId} 已从静音抽屉取出`));
}

async function checkBlock(message) {
  const guestChatId = await getMappedGuestId(message);
  if (!guestChatId) return sendAdminHelp('请回复一条客人的留言后再使用 /checkblock。');

  const blocked = await kvGetJson(`isblocked-${guestChatId}`, false);
  return sendMarkdown(ADMIN_UID, escapeMarkdown(`UID:${guestChatId} ${blocked ? '正在静音抽屉里' : '可以正常留言'}`));
}

async function sendAdminHelp(prefix = '') {
  const lines = [
    prefix && escapeMarkdown(prefix),
    '*人偶管理手册*',
    '`/block` 回复客人留言，把 TA 放入静音抽屉',
    '`/unblock` 回复客人留言，把 TA 从静音抽屉取出',
    '`/checkblock` 回复客人留言，查看留言状态',
    '`/addkeyword 关键词` 添加不能转达的词',
    '`/delkeyword 关键词` 删除不能转达的词',
    '`/keywords` 查看关键词小纸条',
    '`/synckeywords` 从 keyword\\.db 同步关键词到小纸条',
    '`/stats` 查看人偶今日工作记录',
    '',
    '直接回复人偶转来的留言，就会把内容转达给原来的客人喵。',
  ].filter(Boolean);
  return sendMarkdown(ADMIN_UID, lines.join('\n'));
}

async function listKeywords() {
  const keywords = await getKeywordRules();
  if (!keywords.length) {
    return sendMarkdown(ADMIN_UID, '关键词小纸条还是空的喵。');
  }
  return sendMarkdown(
    ADMIN_UID,
    ['*关键词小纸条*', ...keywords.map((keyword) => `\\- ${escapeMarkdown(keyword)}`)].join('\n'),
  );
}

async function addKeyword(message) {
  const keyword = getCommandArgs(message);
  if (!keyword) return sendMarkdown(ADMIN_UID, '用法：`/addkeyword 关键词`');

  const current = await kvGetJson('blocked-keywords', []);
  const next = Array.from(new Set([...asArray(current), keyword]));
  await kvPutJson('blocked-keywords', next);
  return sendMarkdown(ADMIN_UID, escapeMarkdown(`已把「${keyword}」写进关键词小纸条`));
}

async function deleteKeyword(message) {
  const keyword = getCommandArgs(message);
  if (!keyword) return sendMarkdown(ADMIN_UID, '用法：`/delkeyword 关键词`');

  const current = await kvGetJson('blocked-keywords', []);
  const next = asArray(current).filter((item) => item !== keyword);
  await kvPutJson('blocked-keywords', next);
  return sendMarkdown(ADMIN_UID, escapeMarkdown(`已从关键词小纸条擦掉「${keyword}」`));
}

async function syncKeywordDb() {
  const fromDb = await fetchKeywordDb();
  if (!fromDb.length) {
    return sendMarkdown(ADMIN_UID, 'keyword\\.db 里没有关键词喵。');
  }
  const current = asArray(await kvGetJson('blocked-keywords', []));
  const merged = Array.from(new Set([...current, ...fromDb]));
  await kvPutJson('blocked-keywords', merged);
  const added = merged.length - current.length;
  return sendMarkdown(
    ADMIN_UID,
    escapeMarkdown(`已从 keyword.db 同步 ${fromDb.length} 个关键词，新增 ${added} 个，小纸条现共 ${merged.length} 个`),
  );
}

async function sendStats() {
  const names = [
    'guest-message',
    'admin-replied',
    'keyword-blocked',
    'keyword-auto-blocked',
    'no-username-blocked',
    'guest-command-warning',
    'blocked-user-message',
  ];
  const values = await Promise.all(names.map((name) => nfd.get(`stat-${name}`)));
  const lines = names.map((name, index) => mdLine(name, values[index] || '0'));
  return sendMarkdown(ADMIN_UID, ['*人偶工作记录*', ...lines].join('\n'));
}

async function registerWebhook(requestUrl) {
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${WEBHOOK}`;
  const r = await fetch(apiUrl('setWebhook'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: SECRET,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    }),
  }).then((response) => response.json());
  return new Response(r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}

async function unRegisterWebhook() {
  const r = await fetch(apiUrl('deleteWebhook'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ drop_pending_updates: true }),
  }).then((response) => response.json());
  return new Response(r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}

async function isFraud(id) {
  const lines = await fetchRemoteDb(fraudDb);
  return lines.includes(String(id));
}

async function fetchKeywordDb() {
  return fetchRemoteDb(keywordDb);
}
