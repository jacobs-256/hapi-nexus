# 原生伴侣 API 合同（手机 + Wear）

**语言：** [English](../../en/api/native-companion-contract.md) | 简体中文

**受众：** 实现原生伴侣应用的开发者（Android 手机 + Wear OS、iOS 等），这些应用通过 FCM 与 hapi hub 配对。

**认证：** 将配对 `code`、个人 access token 或 operator `CLI_API_TOKEN` 发送到 `POST /api/auth` 进行交换：`{ "accessToken": "<code-or-token>" }`。使用返回的 JWT 作为 `Authorization: Bearer <token>`，用于设备注册和会话操作。浏览器/PWA 用户使用用户名/密码登录；access-token exchange 用于原生伴侣、CLI 风格、owner 和 Telegram 绑定流程。

`POST /api/bind` 仅用于 Telegram Mini App 绑定（需要 Telegram `initData`）。

## 范围

实现该合同的伴侣应用是一个**连接到 PWA 同一 hub 的原生客户端**，用于在手机或穿戴设备上显示通知，并执行回复/批准操作。Hub 拓扑不变：hub 仍运行在 operator 的桌面、runner 机器或私有服务器上。

---

## 设备注册（FCM）

### 注册

`POST /api/devices/register`

```json
{
  "token": "<fcm-registration-token>",
  "platform": "phone",
  "deviceId": "<stable-install-id-uuid>"
}
```

`platform`: `"phone"` | `"wear"`

**响应：** `{ "ok": true }`

按 `(namespace, deviceId, platform)` upsert；同一设备重新注册会替换 FCM token。

### 注销

`DELETE /api/devices/register`

```json
{
  "token": "<fcm-registration-token>"
}
```

---

## 出站推送（hub → device）

当命名空间中存在已注册原生设备且配置了 FCM 时，hub 会在通知事件发出时发送 FCM HTTP v1。原生伴侣被视为腕上优先的标准入口，因此 FCM 会**无条件**触发（不取决于某个 PWA 标签页是否前台/通过 SSE 可见）- 这是有意设计，见 `FcmNotificationChannel.deliver()`。同一命名空间的 Web Push 会被抑制，以避免重复的系统通知。

### 数据 payload（所有平台）

| Key | Example | Purpose |
|-----|---------|---------|
| `type` | `ready` | `ready`, `permission-request`, `task-notification` |
| `sessionId` | uuid | 目标会话 |
| `sessionName` | string | 显示名称（`agent - project`） |
| `url` | `/sessions/{id}` | 深链接路径 |
| `requestId` | uuid | 仅权限请求使用 - approve/deny |
| `title` | string | 通知标题 |
| `body` | string | 通知正文 |
| `severity` | `info` | `info`（ready）、`warning`（permission）、`success` / `error`（task） |
| `notifySummary` | JSON string | 可选：从 agent 文本中解析出的 `AGENT_NOTIFY_SUMMARY` 行 |

原生应用**必须**处理 Wear 的 `data`；notification block 只用于展示。

### 客户端动作（native - not hub）

| 用户动作 | Hub API |
|-------------|---------|
| 发送文本 | `POST /api/sessions/:id/messages` `{ "text": "...", "localId": "..." }` |
| 允许 | `POST /api/sessions/:id/permissions/:requestId/approve` |
| 拒绝 | `POST /api/sessions/:id/permissions/:requestId/deny` |

`sentFrom` 扩展（未来可选）：`android-phone`、`android-wear`。

---

## 环境（hub operator）

```bash
FCM_SERVICE_ACCOUNT_PATH=/path/to/service-account.json
FCM_PROJECT_ID=your-firebase-project-id
```

未设置时，hub 会跳过 FCM 通道（Web Push / Telegram 不变）。

原生推送通道是**可选启用**的：未运行伴侣应用的 operator 不会看到行为变化。当某个命名空间至少注册了一个设备时，现有 Web Push 通道会抑制该命名空间的 fallback，以避免重复通知（一个来自原生应用，一个来自 PWA service worker）。仅使用 PWA 的 operator 不受影响。

---

## 版本

合同版本 **1**。破坏性变更需要在 FCM payload 中加入 `data.contractVersion` 并更新文档。
