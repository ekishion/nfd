# 配置与管理手册

本文档说明环境变量、私密群聊与论坛话题路由配置、动态控制面板参数、关键词与正则审查规则、快捷回复、离开模式以及数据文件的维护方式。

---

## 环境变量配置表

| 变量名 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `ENV_BOT_TOKEN` | 必填 | - | Telegram Bot Token，从 @BotFather 获取 |
| `ENV_BOT_SECRET` | 必填 | - | Webhook 请求认证密钥（建议使用 UUID） |
| `ENV_ADMIN_UID` | 必填 | - | 管理员的 Telegram 纯数字用户 ID |
| `ENV_FORWARD_CHAT_ID` | 可选 | `ENV_ADMIN_UID` | 正常客人留言接收的目标会话 ID（可以是管理员私聊或 `-100` 开头的私密超级群 ID） |
| `ENV_FORWARD_THREAD_ID` | 可选 | - | 正常客人留言投递的固定话题 ID（`message_thread_id`） |
| `ENV_ALERT_CHAT_ID` | 可选 | `ENV_FORWARD_CHAT_ID` | 拦截告警通知接收的目标会话 ID（可独立配置为专用报警群或频道） |
| `ENV_ALERT_THREAD_ID` | 可选 | - | 拦截告警通知投递的目标话题 ID（例如群内的拦截通知专属话题） |
| `ENV_ENABLE_FORUM_TOPICS` | 可选 | `false` | 设为 `true` 时，在论坛超级群内自动为每位新客人创建专属独立话题 |
| `ENV_FORWARD_DELAY_SECONDS` | 可选 | `0` | 转发缓冲延迟秒数。汇总该时间段内的连续消息统一审查后一起转发。设为 0 为即时转发 |
| `ENV_REQUIRE_USERNAME` | 可选 | `false` | 设为 `true` 时拦截未设置 Telegram 用户名（`@username`）的客人留言 |
| `ENV_REQUIRE_PHOTO` | 可选 | `false` | 设为 `true` 时拦截未设置个人头像的客人留言（别名 `ENV_REQUIRE_AVATAR`） |
| `ENV_KEYWORD_NOTICE_TO_ADMIN` | 可选 | `true` | 触发关键词拦截时，是否向管理员/报警群发送拦截通报 |
| `ENV_KEYWORD_NOTICE_TO_USER` | 可选 | `true` | 触发关键词拦截时，是否向客人回复提示信息 |
| `ENV_AUTO_BLOCK_KEYWORD_VIOLATORS` | 可选 | `true` | 是否在客人多次违规触发关键词后自动加入黑名单 |
| `ENV_KEYWORD_VIOLATION_LIMIT` | 可选 | `3` | 自动拉黑前的关键词违规次数上限 |
| `ENV_KEYWORD_VIOLATION_TTL_SECONDS` | 可选 | `86400` | 关键词违规计数的统计有效时间窗口（秒） |
| `ENV_ENABLE_FLOOD_PROTECTION` | 可选 | `true` | 是否开启防刷屏频控（10 秒内超过 5 条自动静音 60 秒） |
| `ENV_BLOCK_EXECUTABLES` | 可选 | `true` | 是否拦截 `.exe`、`.apk`、`.bat` 等危险可执行附件 |
| `ENV_AWAY_MODE` | 可选 | `false` | 是否开启离开模式（向留言客人自动回复离线说明） |
| `ENV_ENABLE_NOTIFICATION` | 可选 | `true` | 是否向客人发送定期安全交易提醒 |
| `ENV_USER_ACK_COOLDOWN_MS` | 可选 | `30000` | 留言成功转达后向客人发送回执的冷却时间（毫秒） |
| `ENV_COMMAND_WARNING_COOLDOWN_MS` | 可选 | `60000` | 客人误触管理指令或被拦截提示的冷却时间（毫秒） |
| `ENV_START_MESSAGE_URL` | 可选 | - | 自定义 /start 启动文案的远程 URL（MarkdownV2） |
| `ENV_NOTIFICATION_URL` | 可选 | - | 自定义交易安全提醒文案的远程 URL（MarkdownV2） |
| `ENV_FRAUD_DB_URL` | 可选 | - | 自定义诈骗 UID 名单数据库的远程 URL |
| `ENV_KEYWORD_DB_URL` | 可选 | - | 自定义敏感关键词数据库的远程 URL |

---

## 私密群聊与论坛话题（Forum Topics）配置指引

### 场景一：将所有留言转发到一个私密群组
1. 在 Telegram 中新建一个私密群组，并将 Bot 拉入群内，**将 Bot 提升为管理员**（赋予发消息和删除消息权限）。
2. 获取群组 ID（格式为 `-100xxxxxxxxxx`）：
   - 可将任意消息转发给 `@userinfobot` 或 `@username_to_id_bot` 查看 Chat ID。
3. 在 Cloudflare Worker 环境变量中配置：
   - `ENV_FORWARD_CHAT_ID` = `-100xxxxxxxxxx`
4. 部署后，客人的留言将直接推送到该群中，群内成员回复消息即可与客人沟通。

### 场景二：对话群与拦截报警独立分流（告警分离）
如果希望群聊或私聊不被敏感词拦截或防刷日志刷屏：
1. 额外新建一个拦截日志频道或群组（获取其 ID，例如 `-100999999999`）。
2. 在环境变量中配置：
   - `ENV_FORWARD_CHAT_ID` = `客服群ID`
   - `ENV_ALERT_CHAT_ID` = `-100999999999`
3. 此时所有正常留言会进入客服群，而所有敏感词拦截、诈骗报警、危险文件拦截记录均会推送到独立报警群。

### 场景三：论坛群组多话题路由（每位客人独立 Topic）
1. 在 Telegram 群组设置中开启 Topics（论坛主题）功能。
2. 将 Bot 设为管理员，并确保勾选 Manage Topics（管理主题）权限。
3. 在环境变量中配置：
   - `ENV_FORWARD_CHAT_ID` = `论坛群ID`
   - `ENV_ENABLE_FORUM_TOPICS` = `true`
   - `ENV_ALERT_THREAD_ID` = `群内拦截通知话题的ID（可选）`
4. 运行逻辑：
   - 新客人首次发信时，Bot 会自动在群中创建专属话题（如 `张三 (123456)`）；
   - 该客人的后续消息均会进入该专属话题；
   - 客服团队在对应话题内直接发言，无需引用消息，Bot 自动回传给该客人。

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

### 页面 3：防护与离开设置
- **防刷频控**：切换短时防刷屏频控开关（默认 10s 内最多 5 条）
- **危险文件**：切换危险安装包与可执行文件（`.apk`、`.exe`、`.bat`）拦截开关
- **离开模式**：快速切换离开自动应答模式

---

## 客人画像与备注标签

- **查看画像**：回复客人留言发送 `/user`，或直接输入 `/user 用户ID`，可查看客人的首访时间、累计留言数、违规历史与备注名。
- **设置备注**：回复客人留言发送 `/tag 备注名`，或发送 `/tag 用户ID 备注名` 为客人添加标签。后续该客人留言时，通知卡片会自动显示备注名（`客人: 张三 [备注名] (123456)`）。输入 `/tag clear` 可清除备注。

---

## 快捷短语与离开模式

- **添加快捷短语**：`/addquick 价格 云服务器每月10U，年付8折优惠`
- **使用快捷短语**：回复客人留言发送 `/quick 价格`（或 `/q 价格`），一键发送给客人。
- **查看短语列表**：`/quicks`
- **删除快捷短语**：`/delquick 价格`
- **开启离开模式**：`/away 外出吃饭中，预计1小时后回复喵`（客人首次留言时会自动收到该说明）
- **关闭离开模式**：`/back`

---

## 关键词与正则表达式审查规则

审查引擎支持普通字符串与正则表达式两种规则，并在匹配前执行反混淆清洗（去除零宽字符、全角转半角、多余空白压缩）。

### 1. 普通文本规则
非 `/` 包裹的字符，执行不区分大小写的子串匹配。
- 示例：`代充`、`换汇`、`收u`

### 2. 正则表达式规则
采用 `/pattern/flags` 格式书写，支持标准 JavaScript 正则语法。
- 匹配微信联系方式引流：`/(?:加|联系|咨询)?\s*(?:vx|微信|v信)\s*[:：号]?\s*[a-zA-Z0-9_-]{5,}/i`
- 匹配 Telegram 群组/频道私有链接：`/t\.me\/(?:joinchat|\+[a-zA-Z0-9_-]+)/i`
- 匹配手机号引流：`/(?:电话|手机|联系)?\s*1[3-9]\d{9}/i`

---

## 数据文件维护

项目中的 `data/` 目录包含预设的数据与文案文件：

1. **`data/fraud.db`**
   - 诈骗 UID 列表，每行一个 Telegram 数字 UID。
   - 收到对应 UID 留言时，Bot 会自动向管理员发出诈骗库命中报警。

2. **`data/keyword.db`**
   - 敏感关键词与正则屏蔽列表，每行一个词或一条正则。
   - 管理员发送 `/synckeywords` 可将此文件中的规则同步合并至 KV。

3. **`data/startMessage.md`**
   - 默认的 `/start` 启动欢迎文案，支持 `{username}` 占位符。

4. **`data/notification.txt`**
   - 默认的定期交易安全提醒文案。

---

## 管理员指令总览

| 指令 | 格式 | 说明 |
| :--- | :--- | :--- |
| `/panel` | `/panel` | 打开交互式图形控制面板（支持3页切换） |
| `/stats` | `/stats` | 查看今日消息数、回复数与各项拦截统计 |
| `/user` | `/user` 或 `/user UID` | 查看客人画像、留言数、违规记录与备注 |
| `/tag` | `/tag 备注` 或 `/tag UID 备注` | 为客人添加身份备注标签（`/tag clear` 清除） |
| `/quick` / `/q` | `/quick 标签` | 使用快捷短语一键回复客人 |
| `/quicks` | `/quicks` | 查看已保存的全部快捷短语标签 |
| `/addquick` | `/addquick 标签 内容` | 新增或更新快捷短语 |
| `/delquick` | `/delquick 标签` | 删除指定快捷短语 |
| `/away` | `/away [离线文案]` | 开启离开模式与自动应答 |
| `/back` | `/back` | 关闭离开模式，恢复正常在线 |
| `/block` | `/block` 或 `/block UID` | 将指定用户加入黑名单（支持回复消息或直接输入数字 UID） |
| `/unblock` | `/unblock` 或 `/unblock UID` | 将指定用户从黑名单移出 |
| `/checkblock`| `/checkblock` 或 `/checkblock UID` | 查询指定用户的黑名单状态 |
| `/keywords` | `/keywords` | 查看当前生效的关键词与正则表达式列表 |
| `/addkeyword` | `/addkeyword 词` 或 `/addkeyword /正则/i` | 手动新增拦截规则（即时生效，含语法检查） |
| `/delkeyword` | `/delkeyword 规则` | 手动删除拦截规则 |
| `/synckeywords`| `/synckeywords` | 从远程 `keyword.db` 重新同步关键词到 KV |
