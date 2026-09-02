# 配置与管理手册

本文档详细说明所有环境变量、动态控制面板参数以及数据文件的维护方式。

---

## 环境变量配置表

| 变量名 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `ENV_BOT_TOKEN` | 必填 | - | Telegram Bot Token，从 @BotFather 获取 |
| `ENV_BOT_SECRET` | 必填 | - | Webhook 请求认证密钥（建议使用 UUID） |
| `ENV_ADMIN_UID` | 必填 | - | 管理员的 Telegram 纯数字用户 ID |
| `ENV_FORWARD_DELAY_SECONDS` | 可选 | `0` | 转发缓冲延迟秒数。汇总该时间段内的连续消息统一审查后一起转发。设为 0 为即时转发 |
| `ENV_REQUIRE_USERNAME` | 可选 | `false` | 设为 `true` 时拦截未设置 Telegram 用户名（`@username`）的客人留言 |
| `ENV_REQUIRE_PHOTO` | 可选 | `false` | 设为 `true` 时拦截未设置个人头像的客人留言（别名 `ENV_REQUIRE_AVATAR`） |
| `ENV_KEYWORD_NOTICE_TO_ADMIN` | 可选 | `true` | 触发关键词拦截时，是否向管理员发送拦截通报 |
| `ENV_KEYWORD_NOTICE_TO_USER` | 可选 | `true` | 触发关键词拦截时，是否向客人回复提示信息 |
| `ENV_AUTO_BLOCK_KEYWORD_VIOLATORS` | 可选 | `true` | 是否在客人多次违规触发关键词后自动加入黑名单 |
| `ENV_KEYWORD_VIOLATION_LIMIT` | 可选 | `3` | 自动拉黑前的关键词违规次数上限 |
| `ENV_KEYWORD_VIOLATION_TTL_SECONDS` | 可选 | `86400` | 关键词违规计数的统计有效时间窗口（秒） |
| `ENV_ENABLE_NOTIFICATION` | 可选 | `true` | 是否向客人发送定期安全交易提醒 |
| `ENV_USER_ACK_COOLDOWN_MS` | 可选 | `30000` | 留言成功转达后向客人发送回执的冷却时间（毫秒） |
| `ENV_COMMAND_WARNING_COOLDOWN_MS` | 可选 | `60000` | 客人误触管理指令或被拦截提示的冷却时间（毫秒） |
| `ENV_START_MESSAGE_URL` | 可选 | - | 自定义 /start 启动文案的远程 URL（MarkdownV2） |
| `ENV_NOTIFICATION_URL` | 可选 | - | 自定义交易安全提醒文案的远程 URL（MarkdownV2） |
| `ENV_FRAUD_DB_URL` | 可选 | - | 自定义诈骗 UID 名单数据库的远程 URL |
| `ENV_KEYWORD_DB_URL` | 可选 | - | 自定义敏感关键词数据库的远程 URL |

---

## 动态控制面板（/panel）

管理员在 Telegram 中直接向 Bot 发送 `/panel`（或 `/config`），即可打开内联控制面板。

在控制面板中点击按钮修改的配置，会自动保存在 KV `runtime-settings` 中并热生效，其优先级高于环境变量初始值。

### 页面 1：拦截审查设置
- **要求用户名**：切换无用户名拦截开关
- **要求头像**：切换无头像拦截开关
- **自动拉黑**：切换敏感词违规自动拉黑开关
- **阈值调节**：在 1次 / 2次 / 3次 / 5次 之间轮播调节拉黑阈值

### 页面 2：转发与通知设置
- **转发延迟**：在 关闭(0s) / 3s / 5s / 10s / 15s 之间轮播调节缓冲时间
- **通知管理**：切换敏感词拦截是否向管理员通报
- **提示客人**：切换敏感词拦截是否向客人发送提醒
- **交易提醒**：切换定期交易安全提醒开关

---

## 数据文件维护

项目中的 `data/` 目录包含预设的数据与文案文件：

1. **`data/fraud.db`**
   - 诈骗 UID 列表，每行一个 Telegram 数字 UID。
   - 收到对应 UID 留言时，Bot 会自动向管理员发出诈骗库命中报警。

2. **`data/keyword.db`**
   - 敏感关键词屏蔽列表，每行一个词。
   - 管理员发送 `/synckeywords` 可将此文件中的关键词同步合并至 KV。

3. **`data/startMessage.md`**
   - 默认的 `/start` 启动欢迎文案，支持 `{username}` 占位符。

4. **`data/notification.txt`**
   - 默认的定期交易安全提醒文案。

---

## 管理员指令总览

| 指令 | 格式 | 说明 |
| :--- | :--- | :--- |
| `/panel` | `/panel` | 打开交互式图形控制面板 |
| `/stats` | `/stats` | 查看今日消息数、回复数与各项拦截统计 |
| `/block` | `/block` 或 `/block UID` | 将指定用户加入黑名单（支持回复消息或直接输入数字 UID） |
| `/unblock` | `/unblock` 或 `/unblock UID` | 将指定用户从黑名单移出 |
| `/checkblock`| `/checkblock` 或 `/checkblock UID` | 查询指定用户的黑名单状态 |
| `/keywords` | `/keywords` | 查看当前生效的关键词小纸条 |
| `/addkeyword` | `/addkeyword 关键词` | 手动新增拦截关键词（即时生效） |
| `/delkeyword` | `/delkeyword 关键词` | 手动删除拦截关键词 |
| `/synckeywords`| `/synckeywords` | 从远程 `keyword.db` 重新同步关键词到 KV |
