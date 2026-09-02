# 部署指南

本项目支持两种部署方式：通过 GitHub 仓库让 Cloudflare 自动编译部署，或者直接在 Cloudflare 控制台复制单文件部署。

---

## 方式一：GitHub 仓库自动编译部署（推荐）

该方式依托 Cloudflare Workers 的 Git CI/CD 功能，本地无需配置打包环境，推送代码后云端自动构建上线。

### 1. 准备配置信息
- 从 `@BotFather` 创建或获取你的 Telegram Bot Token。
- 生成一个随机 UUID 字符串作为 Webhook Secret（例如通过 uuidgenerator 生成）。
- 获取管理员的 Telegram 用户 ID（例如通过 `@username_to_id_bot` 查询）。

### 2. 在 Cloudflare 中绑定仓库
1. 登录 Cloudflare 控制台，进入 **Compute (Workers) -> Workers & Pages**。
2. 点击 **Create application** -> 选择 **Connect to Git**。
3. 授权并选择你的 `nfd` 仓库。
4. Cloudflare 会自动读取项目中的 `wrangler.jsonc` 配置，识别构建入口为 `src/index.js`。

### 3. 配置存储与环境变量
在 Cloudflare Worker 的控制台面板中：
- **KV 命名空间绑定**：进入 **Settings -> KV Namespace Bindings**，添加绑定，变量名固定填写为 `nfd`，下拉选择你的 KV 命名空间。
- **环境变量**：进入 **Settings -> Variables and Secrets**，添加以下必要变量：
  - `ENV_BOT_TOKEN`：你的 Bot Token
  - `ENV_BOT_SECRET`：你的 Webhook Secret
  - `ENV_ADMIN_UID`：管理员 Telegram 用户 ID

### 4. 注册 Webhook
配置完成后，在浏览器访问：
```text
https://你的worker域名/registerWebhook?secret=你的_ENV_BOT_SECRET
```
若返回 `Ok`，即表示 Webhook 注册成功。后续只要向 GitHub 仓库推送更新，Cloudflare 会自动完成构建与部署。

---

## 方式二：网页端单文件复制粘贴部署

如果你不希望绑定 GitHub 仓库，可直接使用根目录下预先打包好的 `worker.js`。

1. 在 Cloudflare 控制台创建新的 Worker。
2. 在 Worker 的 **Settings** 中完成 KV 绑定（变量名 `nfd`）和环境变量配置。
3. 打开 Worker 的在线代码编辑器，将根目录中的 `worker.js` 内容完整复制并覆盖粘贴，保存并部署。
4. 在浏览器中访问注册地址：
```text
https://你的worker域名/registerWebhook?secret=你的_ENV_BOT_SECRET
```

---

## 方式三：Wrangler CLI 本地部署

如果你熟悉命令行开发，可以使用 Cloudflare 官方 CLI 工具 `wrangler`：

1. 克隆仓库并安装依赖：
   ```bash
   git clone https://github.com/你的用户名/nfd.git
   cd nfd
   ```
2. 登录 Cloudflare 账号：
   ```bash
   npx wrangler login
   ```
3. 部署到 Cloudflare：
   ```bash
   npx wrangler deploy
   ```
4. 同样访问 `/registerWebhook?secret=你的_ENV_BOT_SECRET` 激活 Webhook。

---

## 常见问题与排查

- **Webhook 提示 Unauthorized**：检查访问 URL 中的 `?secret=` 参数是否与 Worker 环境变量中配置的 `ENV_BOT_SECRET` 完全一致。
- **收不到客人留言**：检查 `ENV_ADMIN_UID` 是否为正确的纯数字 ID，以及 KV 变量名是否为 `nfd`。
