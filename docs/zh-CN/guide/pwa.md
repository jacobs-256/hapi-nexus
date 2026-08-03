# Progressive Web App (PWA)

**语言：** [English](../../en/guide/pwa.md) | 简体中文

HAPI 的 Web 界面是一个完整的 PWA，可以安装到手机上，获得接近原生应用的体验。

## 什么是 PWA？

Progressive Web App（PWA）是一种可以安装到设备上的 Web 应用，使用方式类似原生应用：

- **主屏幕图标** - 像其他应用一样启动 HAPI
- **全屏模式** - 没有浏览器 chrome，更沉浸
- **离线支持** - 无网络时仍有基础功能
- **自动更新** - 始终获取最新版本

## 安装 HAPI PWA

### Android（Chrome/Edge）

1. 在 Chrome 或 Edge 浏览器中打开 HAPI
2. 查找底部的安装横幅
3. 点击 **"Install"**
4. HAPI 会出现在主屏幕

> 提示：如果没有看到安装横幅，点击三点菜单并选择 **"Add to Home screen"** 或 **"Install app"**。

### iOS（Safari）

1. 在 Safari 中打开 HAPI
2. 点击 **Share** 按钮（方框带箭头）
3. 向下滚动并点击 **"Add to Home Screen"**
4. 点击右上角 **"Add"**

> 警告：iOS 要求使用 Safari 安装 PWA。iOS 上的 Chrome/Firefox 不支持 “Add to Home Screen” 功能。

### 桌面端（Chrome/Edge）

1. 在浏览器中打开 HAPI
2. 点击地址栏中的安装图标（⊕）
3. 或使用浏览器安装菜单
4. HAPI 会作为独立窗口打开

## PWA 功能

### 离线模式

离线时，HAPI 可以：

- 显示缓存的会话列表
- 显示已加载过的消息
- 在重新联网后发送排队操作

失去连接时会显示离线指示。

### 自动更新

HAPI 会在后台检查更新，并让你选择何时刷新：

- 每小时检查一次更新，回到标签页时也会检查
- 当新版本可用时，应用顶部会显示持久横幅
- 准备好应用更新时点击 **Reload**；横幅会一直保留直到你刷新
- 展开横幅中的 **"Why can't I dismiss this?"** 可查看原因

HAPI 使用用户可控的刷新，而不是强制自动刷新，所以由你决定何时刷新。升级前横幅不能关闭，以免忘记自己仍在旧版本上。

### 后台同步

离线时执行的操作会在重新连接后同步：

- 发送待处理消息
- 转发权限决策
- 刷新会话状态

## 缓存策略

HAPI 使用智能缓存：

| 内容 | 策略 | 时长 |
|---------|----------|----------|
| App shell | Cache first | 直到更新 |
| Sessions API | Network first | 5 分钟 |
| Machines API | Network first | 10 分钟 |
| 静态资源 | Cache first | 永久 |

## 通知

HAPI 支持 push notifications，在 agent 需要注意时提醒你。

### 启用通知

1. 打开 HAPI - 权限弹窗会自动出现
2. 点击 **Allow** 启用通知
3. 如果错过弹窗，到系统设置中授予权限

### 通知类型

| 类型 | 发送时机 |
|------|-----------|
| Permission Request | Agent 需要你批准 |
| Ready | Agent 完成并等待输入 |

> 提示：如果 push notifications 在你的地区不可用（例如 FCM 不可用），请改用 [Telegram 集成](./installation.md#telegram-设置)。

## 管理你的 PWA

### 检查安装状态

HAPI 会根据安装状态显示不同 UI：

- **Not installed** - 显示安装提示
- **Installing** - 显示进度指示
- **Installed** - 不显示提示

### 卸载

**Android：**

1. 长按 HAPI 图标
2. 拖到 “Uninstall” 或点击 X

**iOS：**

1. 长按 HAPI 图标
2. 点击 “Remove App” → “Delete App”

**桌面端：**

1. 打开 HAPI
2. 点击三点菜单
3. 选择 “Uninstall HAPI”

### 清除缓存

如果遇到问题：

1. 在浏览器中打开 HAPI Nexus（不是已安装版本）
2. 打开 Developer Tools（F12）
3. 进入 Application → Storage
4. 点击 “Clear site data”

## 最佳实践

### 电池优化

在 Android 上，关闭 HAPI 的电池优化以确保：

- 后台同步可靠工作
- 通知及时到达

Settings → Apps → HAPI → Battery → Unrestricted

### 数据使用

HAPI 使用的数据很少：

- 首次加载：约 500KB
- 首次加载后会缓存
- 只同步变化的数据

### 多设备

你可以在多个设备上安装 HAPI：

- 所有设备使用同一个服务器
- 会话跨设备同步
- 每个设备使用用户名和密码登录
- 个人 access token 可在 Account 设置中查看，用于伴侣客户端/CLI 风格流程

## 故障排查

### 没有显示安装按钮

- 确认使用 HTTPS（PWA 必需）
- 尝试刷新页面
- 检查是否已经安装

### 应用没有更新

1. 完全关闭应用
2. 重新打开并等待更新提示
3. 如果卡住，清除缓存并重新安装

### 离线模式不工作

- 确认你至少在线加载过一次应用
- 检查 ServiceWorker 是否已注册（DevTools → Application）
- 清除缓存并重新加载

### iOS 特定问题

- 必须使用 Safari 安装
- iOS 不支持后台同步
- 离线能力有限

## Telegram Mini App 替代方案

如果 PWA 不适合你的需求，可以考虑 Telegram Mini App：

- 在 Telegram 内使用
- 不需要单独安装
- 功能与 PWA 相同
- 集成通知

Telegram 设置见[安装指南](./installation.md#telegram-设置)。
