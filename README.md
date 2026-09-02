# NFD

No Fraud / Node Forward Bot

一个基于 Cloudflare Worker 的 Telegram 消息转发 bot，集成反诈骗提醒、用户屏蔽、关键词屏蔽和 MarkdownV2 回复。

## 特点

- 单个 `worker.js` 即可部署，适合 Cloudflare Worker / KV。
- 用户消息自动转发给管理员，管理员回复转发消息即可回传给原用户。
- 管理员回复用户消息可执行 `/block`、`/unblock`、`/checkblock`。
- 支持关键词屏蔽，可通过环境变量、远程 keyword.db 或管理员命令维护；多次违规可自动拉黑。
- 用户留言成功转达后会收到回执，回执和警告带冷却，避免刷屏。
- 管理员收到留言时会带快捷按钮，可直接回复、查看留言人信息、屏蔽、解除屏蔽、检查状态和撤回最近回复。
- 管理员回复成功后的确认消息会带“撤回这条回复”按钮，可撤回 bot 发给用户的上一条回复。
- 默认使用 Telegram `MarkdownV2`，启动文案、提醒文案和管理消息可正常加粗、引用和展示命令。
- 对诈骗 UID 数据库做短期缓存，减少每条消息都拉取远程数据的开销。
- 转发失败时自动回退到 `copyMessage`，并保留回复映射。

## 部署方法

1. 从 [@BotFather](https://t.me/BotFather) 获取 bot token。
2. 从 [uuidgenerator](https://www.uuidgenerator.net/) 获取一个随机 UUID 作为 webhook secret。
3. 从 [@username_to_id_bot](https://t.me/username_to_id_bot) 获取管理员用户 ID。
4. 在 Cloudflare 创建 Worker，并绑定 KV Namespace，变量名为 `nfd`。
5. 配置 Worker 环境变量：
   - `ENV_BOT_TOKEN`：BotFather 提供的 token。
   - `ENV_BOT_SECRET`：webhook secret。
   - `ENV_ADMIN_UID`：管理员 Telegram 用户 ID。
   - `ENV_KEYWORD_NOTICE_TO_USER`：可选，设为 `false` 时关键词拦截不通知用户。
   - `ENV_KEYWORD_NOTICE_TO_ADMIN`：可选，设为 `false` 时关键词拦截不通知管理员（默认 `true`）。
   - `ENV_ENABLE_NOTIFICATION`：可选，设为 `false` 时关闭交易提醒，默认 `true`。
   - `ENV_USER_ACK_COOLDOWN_MS`：可选，留言成功回执冷却时间，默认 `30000`。
   - `ENV_COMMAND_WARNING_COOLDOWN_MS`：可选，用户误触管理命令或被屏蔽提示冷却时间，默认 `60000`。
   - `ENV_KEYWORD_VIOLATION_LIMIT`：可选，关键词违规自动拉黑阈值，默认 `3`。
   - `ENV_KEYWORD_VIOLATION_TTL_SECONDS`：可选，关键词违规计数窗口，默认 `86400`。
   - `ENV_AUTO_BLOCK_KEYWORD_VIOLATORS`：可选，设为 `false` 可关闭关键词多次违规自动拉黑。
   - `ENV_START_MESSAGE_URL`：可选，自定义 MarkdownV2 启动文案 URL。
   - `ENV_NOTIFICATION_URL`：可选，自定义 MarkdownV2 交易提醒 URL。
   - `ENV_FRAUD_DB_URL`：可选，自定义诈骗 UID 数据库 URL。
   - `ENV_KEYWORD_DB_URL`：可选，自定义关键词数据库 URL。
6. 将 [worker.js](./worker.js) 复制到 Worker。
7. 访问 `https://xxx.workers.dev/registerWebhook` 注册 webhook。

## 使用方法

- 普通用户给 bot 发消息时，消息会被转发给管理员。
- 留言成功转达后，普通用户会收到一条“已转达”回执；短时间连续发送不会重复刷屏。
- 普通用户发送管理命令时，不会执行命令，会收到警告提示。
- 普通用户多次触发关键词屏蔽后，会自动进入屏蔽状态。
- 管理员回复被转发的用户消息，内容会发送回原用户。
- 管理员发送 `/help` 可查看命令。
- 管理员回复用户消息发送 `/block`、`/unblock`、`/checkblock` 可管理该用户。
- 管理员发送 `/addkeyword 关键词`、`/delkeyword 关键词`、`/keywords` 可管理关键词屏蔽。
- 管理员发送 `/synckeywords` 可将 `keyword.db` 中的关键词同步到 KV。
- 管理员发送 `/stats` 可查看基础统计。
- 管理员也可以使用留言下方按钮完成常用操作；“撤回”依赖 Telegram `deleteMessage`，受 Telegram 删除时间限制影响。

## 关键词数据

[data/keyword.db](./data/keyword.db) 为关键词屏蔽数据库，格式为每行一个关键词。Bot 启动时会从远程拉取并与环境变量、KV 中的关键词合并；管理员也可通过 `/synckeywords` 手动同步到 KV。

## 诈骗数据

[data/fraud.db](./data/fraud.db) 为诈骗 UID 数据库，格式为每行一个 UID。

你可以通过 PR 或 issue 补充数据。提供额外诈骗信息时，请尽量提供消息出处和可核验依据。

## Thanks

- [telegram-bot-cloudflare](https://github.com/cvzi/telegram-bot-cloudflare)
