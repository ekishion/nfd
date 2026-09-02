# 部署指南

本项目支持三种部署方式：通过 GitHub Actions 自动化 CI/CD 部署、Cloudflare 控制台单文件直接部署，或使用本地 Wrangler CLI 部署。

---

## 方式一：GitHub Actions 自动部署（推荐）

通过 GitHub Actions 自动构建与部署，既能保证代码库公开（不泄露私有 ID 与密钥），又能在每次推送代码或手动点击时自动部署到 Cloudflare，同时确保 KV 绑定和环境变量持久生效。

### 1. 获取 Cloudflare 凭据

1. **获取 Account ID（账户 ID）**：
   - 登录 Cloudflare 控制台，进入 Compute (Workers) -> Workers & Pages，在右侧栏目下方复制 Account ID。
2. **获取 32 位 KV ID**：
   - 进入 Storage & Databases -> KV，找到 `nfd` 命名空间，复制其右侧的 KV ID。
3. **创建 API Token（API 令牌）**：
   - 点击 Cloudflare 控制台右上角头像 -> My Profile -> API Tokens。
   - 点击 Create Token -> 选择 Edit Cloudflare Workers 模板 -> 点击 Continue to summary -> Create Token 并复制生成的 Token。

### 2. 在 GitHub 仓库中添加 Secrets（机密）与 Variables（变量）

进入 GitHub 仓库的 **Settings -> Secrets and variables -> Actions**。

> 提示：工作流已做双向自动兼容，无论将参数填入 Secrets 还是 Variables 均可正常生效。建议按以下规范分类添加：

#### 填在「Secrets（机密）」标签页中的高敏感凭证（点击 New repository secret）

| 名称 | 说明 | 示例 |
| :--- | :--- | :--- |
| `CF_API_TOKEN` | Cloudflare API 令牌（需具备 Workers 编辑权限） | `v_xxxx...` |
| `ENV_BOT_TOKEN` | Telegram Bot Token | `123456:ABC...` |
| `ENV_BOT_SECRET` | 自定义的 Webhook 访问密钥 | `uuid-string` |

#### 填在「Variables（变量）」标签页中的普通参数（点击 New repository variable）

| 名称 | 说明 | 示例 |
| :--- | :--- | :--- |
| `CF_ACCOUNT_ID` | Cloudflare 账户 ID | `a1b2c3d4...` |
| `KV_NAMESPACE_ID` | 32 位 KV 命名空间 ID | `236c920e...` |
| `ENV_ADMIN_UID` | 管理员的纯数字 Telegram UID | `12345678` |
| `ENV_FORWARD_CHAT_ID` | （可选）接收留言的群聊 ID | `-1001234567890` |
| `ENV_ALERT_CHAT_ID` | （可选）接收报警的独立群聊 ID | `-1009999999999` |
| `ENV_ALERT_THREAD_ID` | （可选）拦截通知的话题 ID | `9` |
| `ENV_ENABLE_FORUM_TOPICS` | （可选）是否开启论坛独立话题模式 | `true` |
| `ENV_FORWARD_DELAY_SECONDS` | （可选）转发聚合延迟秒数 | `5` |

### 3. 运行部署与 Webhook 激活

- **自动触发**：向 `main` 分支推送代码即可自动触发构建与部署。
- **手动触发**：进入 GitHub 仓库页面 -> 点击 **Actions** 标签页 -> 点击左侧 **Deploy to Cloudflare Workers** -> 点击右侧 **Run workflow** 下拉按钮并确认运行。

部署成功后，在浏览器访问：
```text
https://你的worker域名/registerWebhook?secret=你的_ENV_BOT_SECRET
```
显示 `Ok` 即完成 Webhook 注册。

---

## 方式二：网页端单文件复制粘贴部署

如果不使用 GitHub Actions，可在本地生成 `worker.js` 后手动粘贴到 Cloudflare：

1. 本地安装依赖并执行打包：
   ```bash
   node build.js
   ```
2. 在 Cloudflare 控制台创建新的 Worker（不要使用 Connect to Git）。
3. 在 Worker 的 Settings 中完成 KV 绑定（变量名 `nfd`），并添加环境变量（建议点击 Encrypt 加密保存）。
4. 打开 Worker 的在线代码编辑器，将生成的 `worker.js` 内容完整复制并覆盖粘贴，保存并部署。
5. 在浏览器中访问注册地址：
   ```text
   https://你的worker域名/registerWebhook?secret=你的_ENV_BOT_SECRET
   ```

---

## 方式三：Wrangler CLI 本地部署

使用 Cloudflare 官方 CLI 工具 `wrangler`：

1. 安装依赖并配置环境变量：
   ```bash
   npm install
   npx wrangler secret put ENV_BOT_TOKEN
   npx wrangler secret put ENV_BOT_SECRET
   npx wrangler secret put ENV_ADMIN_UID
   ```
2. 部署：
   ```bash
   npx wrangler deploy
   ```
3. 访问 `/registerWebhook?secret=你的_ENV_BOT_SECRET` 激活 Webhook。

---

## 常见问题排查

- **GitHub Actions 部署报错 Unauthorized**：检查 `CF_API_TOKEN` 是否具备 `Workers: Edit` 权限，且 `CF_ACCOUNT_ID` 填写正确。
- **Missing entry-point**：请确保 `.github/workflows/deploy.yml` 为最新版本，且部署指令指定了 `deploy worker.js --config wrangler.json`。
- **Webhook 提示 Unauthorized**：检查访问 URL 中的 `?secret=` 参数是否与 GitHub Secret 中配置的 `ENV_BOT_SECRET` 完全一致。
- **收不到客人留言**：检查 `ENV_ADMIN_UID` 是否为正确的纯数字 ID，以及 KV 变量名是否为 `nfd`。
