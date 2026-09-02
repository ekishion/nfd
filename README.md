# NFD

No Fraud / Node Forward Bot

基于 Cloudflare Workers 的 Telegram 消息转发与反诈管理 Bot。支持用户留言转达、反诈提醒、黑名单管理、条件审查（用户名、头像、关键词）、延迟缓冲审查与内联控制面板。

## 功能特性

- 支持 Cloudflare Workers Git 集成，连接 GitHub 仓库后推送代码即可自动编译发布。
- 提供 Telegram 内联按钮控制面板（`/panel`），支持在聊天中直接调整拦截规则与延迟时间。
- 采用内存与 KV 双层缓存，缓存黑名单、关键词列表与用户头像状态，减少 KV 读写频率。
- 支持消息延迟缓冲与批量审查，在设定时间内汇总同一用户的多条消息，统一检测关键词并合并转达。
- 支持多级审查过滤：
  - 黑名单用户静音拦截
  - 未设置 Telegram 用户名（`@username`）拦截
  - 未设置个人头像拦截
  - 敏感关键词过滤与多次违规自动拉黑
  - 命中 `fraud.db` 诈骗名单向管理员报警
- 双向消息转达：管理员直接回复转发消息即可回传给原用户，并支持一键撤回。

## 项目结构

```text
nfd/
├── src/                # 源码目录
│   ├── config.js       # 环境变量、常量与数据文案引入
│   ├── cache.js        # 内存缓存、KV 存储与远程数据库拉取
│   ├── telegram.js     # Telegram API 封装与消息格式化
│   ├── moderation.js   # 黑名单、用户名、头像与关键词审查
│   ├── pipeline.js     # 消息延迟缓冲与批量转发逻辑
│   ├── panel.js        # 控制面板渲染与回调处理
│   ├── admin.js        # 管理员指令与操作处理
│   └── index.js        # Worker 入口与 Webhook 路由
├── data/               # 独立数据与文案目录
│   ├── fraud.db        # 诈骗 UID 列表
│   ├── keyword.db      # 敏感关键词列表
│   ├── startMessage.md # /start 欢迎文案模板
│   └── notification.txt# 交易安全提醒文案模板
├── docs/               # 详细文档目录
│   ├── deployment.md   # 详细部署教程（GitHub 自动部署 / 单文件部署 / CLI）
│   └── configuration.md# 完整环境变量对照表与管理指令手册
├── wrangler.jsonc      # Cloudflare Workers 配置文件
├── build.js            # 单文件打包脚本
├── package.json        # 项目配置与构建命令
├── worker.js           # 编译生成的单文件脚本
└── README.md
```

## 快速开始

### 方式一：通过 GitHub 仓库自动部署（推荐）

1. 获取 Telegram Bot Token、Webhook Secret 与管理员用户 ID。
2. 登录 Cloudflare 控制台，进入 Workers & Pages，选择 Connect to Git 关联本仓库。
3. 在 Worker 设置中绑定 KV 命名空间（变量名为 `nfd`）并填入环境变量（`ENV_BOT_TOKEN`、`ENV_BOT_SECRET`、`ENV_ADMIN_UID`）。
4. 访问 `https://你的worker域名/registerWebhook?secret=你的_ENV_BOT_SECRET` 完成注册。

更详细的步骤与常见问题排查，请参阅 [部署指南](docs/deployment.md)。

### 方式二：直接复制单文件部署

1. 在 Cloudflare 中创建 Worker，绑定 KV 命名空间 `nfd` 并配置环境变量。
2. 复制根目录下的 `worker.js` 内容粘贴到 Worker 编辑器中并保存部署。
3. 访问 `https://你的worker域名/registerWebhook?secret=你的_ENV_BOT_SECRET` 完成注册。

## 详细文档

- [部署指南](docs/deployment.md)：包含 GitHub 自动构建、单文件部署与 Wrangler CLI 操作说明。
- [配置与管理手册](docs/configuration.md)：包含完整环境变量说明、`/panel` 控制面板使用说明与管理指令汇总。

## 参考

- [telegram-bot-cloudflare](https://github.com/cvzi/telegram-bot-cloudflare)
