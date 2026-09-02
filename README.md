# NFD

No Fraud / Node Forward Bot

基于 Cloudflare Workers 的 Telegram 消息转发与反诈管理 Bot。支持用户留言转达、反诈提醒、黑名单管理、条件审查（用户名、头像、关键词）、延迟缓冲审查与内联控制面板。

## 功能特性

- GitHub Actions 自动化 CI/CD 构建与部署，代码公开且凭据隔离。
- Telegram 内联按钮控制面板（`/panel`），直接在聊天中调节拦截规则与延迟时间。
- 内存与 KV 双层缓存架构，降低 Cloudflare KV 读写频率。
- 消息延迟缓冲与批量聚合，在设定时间窗口内汇总同一用户的多条消息统一转达。
- 多级审查与防护体系：
  - 黑名单用户静音拦截
  - 未设置 Telegram 用户名（`@username`）拦截
  - 未设置个人头像拦截
  - 敏感关键词与正则表达式过滤，支持多次违规自动拉黑
  - 短时防刷屏频控（10s 内超过 5 条自动静音 60s）
  - 危险可执行文件（`.exe`、`.apk`、`.bat` 等）拦截
  - 命中 `fraud.db` 诈骗名单向管理员报警
- 群聊与论坛多话题（Forum Topics）路由：
  - 支持将消息转发至私密群组或指定话题
  - 支持论坛超级群模式，自动为每位新客人创建专属独立话题
  - 对话消息与拦截报警日志支持双通道独立分流
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
├── docs/               # 文档目录
│   ├── deployment.md   # 部署教程（GitHub Actions / 单文件部署 / CLI）
│   └── configuration.md# 环境变量对照表与管理指令手册
├── .github/workflows/  # CI/CD 工作流
│   └── deploy.yml      # GitHub Actions 自动化构建部署脚本
├── test/               # 自动化测试套件
│   └── index.js        # 16 项功能与逻辑测试
├── wrangler.jsonc      # Cloudflare Workers 配置文件
├── build.js            # 单文件打包脚本
├── package.json        # 项目配置与构建命令
├── worker.js           # 编译生成的单文件脚本
└── README.md
```

## 快速开始

### 方式一：GitHub Actions 自动部署（推荐）

1. 获取 Telegram Bot Token、Webhook Secret 与管理员用户 ID。
2. 在 Cloudflare 控制台获取 Account ID、32 位 KV ID 与 API Token。
3. 在 GitHub 仓库的 Settings -> Secrets and variables -> Actions 中添加对应 Secrets。
4. 推送代码至 `main` 分支触发自动化部署。
5. 访问 `https://你的worker域名/registerWebhook?secret=你的_ENV_BOT_SECRET` 完成 Webhook 注册。

详细步骤与图文说明请参阅 [部署指南](docs/deployment.md)。

### 方式二：单文件直接部署

1. 在 Cloudflare 中创建 Worker，绑定 KV 命名空间 `nfd` 并配置环境变量。
2. 复制根目录下的 `worker.js` 内容粘贴到 Worker 在线编辑器中并部署。
3. 访问 `https://你的worker域名/registerWebhook?secret=你的_ENV_BOT_SECRET` 完成 Webhook 注册。

## 详细文档

- [部署指南](docs/deployment.md)：包含 GitHub Actions 自动化配置、单文件部署与 Wrangler CLI 操作说明。
- [配置与管理手册](docs/configuration.md)：包含完整环境变量说明、群聊话题路由指引、`/panel` 控制面板使用说明与管理指令汇总。

## 参考

- [telegram-bot-cloudflare](https://github.com/cvzi/telegram-bot-cloudflare)
