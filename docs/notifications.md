# 外部推送配置指南（PushDeer / Server酱）

当有客人留言转达或触发安全拦截报警时，系统支持通过 **PushDeer** 或 **Server酱（Turbo版）** 将通知实时推送到你的手机或微信。

---

## 环境变量总览

| 平台 | 环境变量名 | 说明 |
| :--- | :--- | :--- |
| **PushDeer** | `ENV_PUSHDEER_KEY` | PushDeer 客户端生成的 PushKey（支持逗号分隔多个 Key） |
| | `ENV_PUSHDEER_URL` | （可选）自建 PushDeer 服务的 API 地址，缺省默认使用官方云端 `https://api2.pushdeer.com` |
| **Server酱（Turbo版）** | `ENV_SERVERCHAN_KEY` | SendKey 微信服务号通知密钥 |
| **过滤控制** | `ENV_NOTIFY_CHANNELS_ON_ALERT_ONLY` | 设为 `true` 时仅在触发安全拦截报警时外发，正常留言不外发（默认 `false`） |

---

## 接入步骤

### 1. PushDeer 推送（推荐）
PushDeer 支持 iOS / Android / macOS 原生 App、轻 App 扫码免装以及自建服务器。

1. 在手机上安装 **PushDeer** App（或使用 iOS 轻 App 扫码）；
2. 打开 PushDeer，进入 **Key** 列表页面，点击右上角 **+** 生成一个专属 Key；
3. 将该 Key 配置到 GitHub 仓库变量或 Cloudflare Worker 环境变量 `ENV_PUSHDEER_KEY`；
4. *(可选)* 如果你使用自建的 PushDeer 服务器，可配置 `ENV_PUSHDEER_URL` 为你的自建域名。

### 2. Server酱 Turbo 版
1. 访问 [Server酱官网](https://sct.ftqq.com/) 使用微信扫码登录；
2. 关注方糖服务号绑定接收账号；
3. 在 **SendKey** 页面复制你的密钥；
4. 将密钥配置到 GitHub 仓库变量或 Cloudflare Worker 环境变量 `ENV_SERVERCHAN_KEY`。
