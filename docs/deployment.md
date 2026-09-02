# 部署指南

本项目支持三种部署方式：通过 GitHub Actions 自动化 CI/CD 部署、Cloudflare 控制台单文件直接部署，或使用本地 Wrangler CLI 部署。

---

## 方式一：GitHub Actions 自动部署（推荐）

通过 GitHub Actions 自动构建与部署，既能保证代码库公开（不泄露私有 ID 与密钥），又能在每次推送代码到 `main` 分支时自动部署到 Cloudflare，同时确保 KV 绑定和环境变量持久生效。

### 1. 获取 Cloudflare 凭据

1. **获取 Account ID（账户 ID）**：
   - 登录 Cloudflare 控制台，进入 Compute (Workers) -> Workers & Pages，在右侧栏目下方复制 Account ID。
2. **获取 32 位 KV ID**：
   - 进入 Storage & Databases -> KV，找到 `nfd` 命名空间，复制其右侧的 KV ID。
3. **创建 API Token（API 令牌）**：
   - 点击 Cloudflare 控制台右上角头像 -> My Profile -> API Tokens。
   - 点击 Create Token -> 选择 Edit Cloudflare Workers 模板 -> 点击 Continue to summary -> Create Token 并复制生成的 Token。

### 2. 在 GitHub 仓库中添加 Secrets

打开 GitHub 仓库页面：
1. 进入 Settings -> Secrets and variables -> Actions。
2. 点击 New repository secret，依次添加以下 6 个必要密钥：

| Secret 名称 | 说明 | 示例 |
| :--- | :--- | :--- |
| `CF_API_TOKEN` | 刚才创建的 Cloudflare API 令牌 | `v_xxxx...` |
| `CF_ACCOUNT_ID` | Cloudflare 账户 ID | `a1b2c3d4...` |
| `KV_NAMESPACE_ID` | 32 位 KV 命名空间 ID | `236c920e...` |
| `ENV_BOT_TOKEN` | Telegram Bot Token | `123456:ABC...` |
| `ENV_BOT_SECRET` | 自定义的 Webhook 访问密钥 | `uuid-string` |
| `ENV_ADMIN_UID` | 管理员的纯数字 Telegram UID | `12345678` |

*(可选密钥：`ENV_FORWARD_CHAT_ID` 用于群聊接收，`ENV_ALERT_CHAT_ID` 用于报警分流群)*

### 3. 推送代码触发部署

配置完 GitHub Secrets 后：
1. 项目中已包含 `.github/workflows/deploy.yml` 工作流。
2. 只要向 `main` 分支推送代码，GitHub Actions 就会自动运行单元测试、打包 `worker.js` 并将注入了 KV 绑定与变量的 Worker 发布到 Cloudflare。
3. 部署成功后，在浏览器访问：
   ```text
   https://你的worker域名/registerWebhook?secret=你的_ENV_BOT_SECRET
   ```
   显示 `Ok` 即完成 Webhook 注册。

---

## 方式二：网页端单文件复制粘贴部署

如果不使用 GitHub Actions，可直接在 Cloudflare 网页上使用打包好的 `worker.js`：

1. 在 Cloudflare 控制台创建新的 Worker（不要使用 Connect to Git）。
2. 在 Worker 的 Settings 中完成 KV 绑定（变量名 `nfd`），并添加环境变量（建议点击 Encrypt 加密保存）。
3. 打开 Worker 的在线代码编辑器，将根目录中的 `worker.js` 内容完整复制并覆盖粘贴，保存并部署。
4. 在浏览器中访问注册地址：
   ```text
   https://你的worker域名/registerWebhook?secret=你的_ENV_BOT_SECRET
   ```

---

## 方式三：Wrangler CLI 本地部署

使用 Cloudflare 官方 CLI 工具 `wrangler`：

1. 安装依赖：
   ```bash
   npm install
   ```
2. 配置环境变量与密钥：
   ```bash
   npx wrangler secret put ENV_BOT_TOKEN
   npx wrangler secret put ENV_BOT_SECRET
   npx wrangler secret put ENV_ADMIN_UID
   ```
3. 部署：
   ```bash
   npx wrangler deploy
   ```
4. 访问 `/registerWebhook?secret=你的_ENV_BOT_SECRET` 激活 Webhook。

---

## 常见问题排查

- **GitHub Actions 部署报错 Unauthorized**：检查 `CF_API_TOKEN` 是否具备 `Workers: Edit` 权限，且 `CF_ACCOUNT_ID` 填写正确。
- **Webhook 提示 Unauthorized**：检查访问 URL 中的 `?secret=` 参数是否与 GitHub Secret 中配置的 `ENV_BOT_SECRET` 完全一致。
- **收不到客人留言**：检查 `ENV_ADMIN_UID` 是否为正确的纯数字 ID，以及 KV 变量名是否为 `nfd`。
