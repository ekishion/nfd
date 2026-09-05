# 部署指南

本项目支持三种部署方式：GitHub Actions 自动部署、Cloudflare 控制台单文件部署，以及本地 Wrangler CLI 部署。

---

## 方式一：GitHub Actions 自动部署（推荐）

### 1. 准备凭据并配置 GitHub

#### A. 获取 Cloudflare 必要凭据
- **Account ID**：登录 Cloudflare，进入 **Compute (Workers) -> Workers & Pages**，右侧栏复制 Account ID。
- **KV ID**：进入 **Storage & Databases -> KV**，复制 `nfd` 命名空间的 32 位 ID。
- **API Token**：右上角 **头像 -> My Profile -> API Tokens**，创建具备 Workers 编辑权限的 Token。

#### B. 在 GitHub 仓库添加参数
进入仓库 **Settings -> Secrets and variables -> Actions**：

- **机密（Secrets）**：
  | 名称 | 说明 |
  | :--- | :--- |
  | `CF_API_TOKEN` | Cloudflare API 令牌 |
  | `CF_ACCOUNT_ID` | Cloudflare 账户 ID |

- **变量（Variables）**：
  | 名称 | 说明 | 示例 |
  | :--- | :--- | :--- |
  | `KV_NAMESPACE_ID` | 32 位 KV 命名空间 ID | `8fb1bd8b...` |
  | `ENV_ADMIN_UID` | 管理员 Telegram UID | `1331096600` |
  | `ENV_FORWARD_CHAT_ID` | （可选）接收留言的群聊 ID | `-1004358728615` |
  | `ENV_ALERT_THREAD_ID` | （可选）拦截通知的话题 ID | `9` |
  | `ENV_ENABLE_FORUM_TOPICS` | （可选）是否开启多话题模式 | `true` |
  | `ENV_FORWARD_DELAY_SECONDS` | （可选）转发延迟秒数 | `5` |
  | `ENV_LISTEN_CHAT_IDS` | （可选）监听群/频道白名单（逗号分隔） | `-1001111111111,-1002222222222` |

### 2. 触发首次部署

推送代码至 `main` 分支，或在 GitHub **Actions** 页面点击 **Deploy to Cloudflare Workers -> Run workflow**。
GitHub Actions 将自动在 Cloudflare 上创建并发布 Worker 服务。

### 3. 在 Cloudflare 设置加密机密

部署成功后，登录 Cloudflare 控制台：
1. 进入 **Compute (Workers) -> Workers & Pages -> nfd -> 设置 -> 变量和机密**。
2. 点击 **添加变量**，添加以下两项并点击右侧 **加密（Encrypt）** 保存：

| 变量名 | 说明 | 示例 |
| :--- | :--- | :--- |
| `ENV_BOT_TOKEN` | Telegram Bot Token | `123456:ABC...` |
| `ENV_BOT_SECRET` | 自定义 Webhook 访问密钥 | `your-secret-key` |

### 4. 激活 Webhook

在浏览器访问以下地址：
```text
https://你的worker域名/registerWebhook?secret=你的ENV_BOT_SECRET
```
返回 `Ok` 即完成机器人注册与上线。

---

## 方式二：Cloudflare 单文件部署

1. 在本地打包生成 `worker.js`：
   ```bash
   node build.js
   ```
2. 在 Cloudflare 创建 Worker，绑定 KV（变量名 `nfd`），并在设置中添加环境变量。
3. 将生成的 `worker.js` 内容复制粘贴到 Worker 在线编辑器并部署。
4. 访问注册地址激活 Webhook：
   ```text
   https://你的worker域名/registerWebhook?secret=你的ENV_BOT_SECRET
   ```

---

## 方式三：Wrangler CLI 部署

1. 安装依赖并配置密钥：
   ```bash
   npm install
   npx wrangler secret put ENV_BOT_TOKEN
   npx wrangler secret put ENV_BOT_SECRET
   npx wrangler secret put ENV_ADMIN_UID
   ```
2. 执行部署：
   ```bash
   npx wrangler deploy
   ```
3. 访问 `/registerWebhook?secret=你的ENV_BOT_SECRET` 激活 Webhook。

---

## 可选：定时触发器（cron）

转发延迟（`ENV_FORWARD_DELAY_SECONDS`）依赖 Worker 在 `waitUntil` 中内联等待，而 Worker 单次请求最长存活约 30 秒，超过 25 秒的延迟会被截断。若进程在等待期间被回收，KV 中遗留的延迟批次由定时触发器兜底补发：

在 `wrangler.jsonc` 中取消注释（或通过 Cloudflare 控制台 -> Worker -> 设置 -> 触发事件 -> Cron 触发器添加）：

```jsonc
"triggers": {
  "crons": ["*/1 * * * *"]
}
```

建议频率为每分钟一次。使用 GitHub Actions 或控制台在线部署时，可在 Cloudflare 控制台直接添加 Cron 触发器。

---

## 安全注意事项

- **务必配置 `ENV_BOT_SECRET`**：未配置时 Webhook 处于无鉴权状态，任何人都可以向 `/endpoint` 伪造 Telegram 更新（Worker 日志会输出对应警告）。
- **`/registerWebhook` 支持三种传参方式**：URL 参数 `?secret=`、请求头 `X-Telegram-Bot-Api-Secret-Token` 或 `x-secret`。其中 URL 参数会随访问记录进入浏览器历史与访问日志，公网环境下更推荐用请求头方式携带密钥；若确有泄露风险，应立即更换 `ENV_BOT_SECRET` 并重新注册 Webhook。

---

## 常见问题

- **部署提示 Unauthorized**：检查 `CF_API_TOKEN` 是否具备 `Workers: Edit` 权限，且 `CF_ACCOUNT_ID` 填写正确。
- **Webhook 提示 Unauthorized**：检查访问链接中的 `?secret=` 参数是否与配置的 `ENV_BOT_SECRET` 一致。
- **收不到留言**：确认 `ENV_ADMIN_UID` 为纯数字 ID，且 KV 绑定变量名为 `nfd`。
