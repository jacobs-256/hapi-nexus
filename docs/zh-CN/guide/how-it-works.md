# 工作原理

**语言：** [English](../../en/guide/how-it-works.md) | 简体中文

HAPI 由三个互相连接的组件组成，共同提供远程 AI agent 控制能力。Hub 使用可配置存储：默认 SQLite；启用后对话历史可用 Elasticsearch，核心 Hub 数据可用 MySQL。

## 架构概览

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     Your Machine (Local or Hub Host)                       │
│                                                                            │
│   ┌──────────────┐         ┌──────────────┐         ┌──────────────┐       │
│   │              │         │              │         │              │       │
│   │   HAPI CLI   │◄───────►│  HAPI Hub    │◄───────►│   Web App    │       │
│   │              │ Socket  │              │   SSE   │  (embedded)  │       │
│   │  + AI Agent  │   .IO   │  + 存储      │         │              │       │
│   │              │         │  + REST API  │         │              │       │
│   └──────────────┘         └──────┬───────┘         └──────────────┘       │
│                                   │                                        │
│                                   │ localhost:3006                         │
└───────────────────────────────────┼────────────────────────────────────────┘
                                    │
                          ┌─────────▼─────────┐
                          │  Tunnel (Optional)│
                          │  Cloudflare/ngrok │
                          └─────────┬─────────┘
                                    │
┌───────────────────────────────────┼────────────────────────────────────────┐
│                           Public Internet                                  │
│                                   │                                        │
│         ┌─────────────────────────┼─────────────────────────┐              │
│         │                         ▼                         │              │
│         │    ┌──────────────┐           ┌──────────────┐    │              │
│         │    │              │           │              │    │              │
│         │    │  Telegram    │           │    PWA /     │    │              │
│         │    │  Mini App    │           │   Browser    │    │              │
│         │    │              │           │              │    │              │
│         │    └──────────────┘           └──────────────┘    │              │
│         │                                                   │              │
│         └───────────────────────────────────────────────────┘              │
│                            Your Phone                                      │
└────────────────────────────────────────────────────────────────────────────┘
```

> **说明：** hub 可以运行在本地桌面，也可以运行在远程主机（VPS、云主机等）。如果部署在有公网 IP 的主机上，就不需要隧道。

## 组件

### HAPI CLI

CLI 是 AI 编程代理（Claude Code、Codex、Cursor Agent、Grok Build、OpenCode）的包装器。它负责：

- 启动和管理编程会话
- 向 HAPI hub 注册会话
- 转发消息和权限请求
- 提供 MCP（Model Context Protocol）工具

**关键命令：**

```bash
hapi              # 启动 Claude Code 会话
hapi codex       # 启动 OpenAI Codex 会话
hapi cursor      # 启动 Cursor Agent 会话
hapi grok        # 启动 Grok Build 会话
hapi opencode    # 启动 OpenCode 会话
CLI_API_TOKEN="<personal-access-token>" hapi runner start --workspace-root /path/to/projects # 运行远程启动会话的后台服务
```

### HAPI Hub

Hub 是连接所有组件的中心服务：

- **HTTP API** - 面向会话、消息、权限的 REST 端点
- **Socket.IO** - 与 CLI 的实时双向通信
- **SSE (Server-Sent Events)** - 向 Web 客户端推送实时更新
- **可配置存储** - 默认 SQLite；对话历史可用 Elasticsearch；核心 Hub 数据可用 MySQL
- **Local Accounts** - 用户名/密码浏览器登录、管理员用户管理和个人 access token
- **Project ACLs** - 在暴露会话、机器、文件和事件前检查用户/项目/workspace 权限
- **Telegram Bot** - 通知和 Mini App 集成

### Web App

React PWA 提供移动端界面：

- **Session List** - 查看所有活跃和历史会话
- **Chat Interface** - 发送消息并查看 agent 响应
- **Permission Management** - 批准或拒绝工具访问
- **File Browser** - 浏览项目文件并查看 git diff
- **Remote Spawn** - 在任意已连接机器上启动新会话
- **Projects** - 与其他用户共享选定 runner workspace 和项目会话
- **Enterprise Settings** - 管理账号凭据、用户、项目、机器、存储和外观

## 数据流

### 启动会话

```
1. 用户在终端运行 `hapi`
         │
         ▼
2. CLI 启动 Claude Code（或其他 agent）
         │
         ▼
3. CLI 通过 Socket.IO 连接到 hub
         │
         ▼
4. Hub 在配置的核心数据存储中创建会话
         │
         ▼
5. Web 客户端收到 SSE 更新
         │
         ▼
6. 会话出现在 Web/PWA 客户端中
```

### 权限请求流程

```
1. AI agent 请求工具权限（例如编辑文件）
         │
         ▼
2. CLI 把权限请求发送给 hub
         │
         ▼
3. Hub 保存请求，并通过 SSE + Telegram 通知
         │
         ▼
4. 用户在 Web/PWA、Telegram 或原生伴侣中收到通知
         │
         ▼
5. 用户在 Web 应用或 Telegram 中批准/拒绝
         │
         ▼
6. Hub 通过 Socket.IO 把决定转发给 CLI
         │
         ▼
7. CLI 通知 AI agent，执行继续
```

### 消息流程

```
User (Web/PWA)               Hub                     CLI
     │                         │                       │
     │──── Send message ──────►│                       │
     │                         │─── Socket.IO emit ───►│
     │                         │                       │
     │                         │                       ├── AI processes
     │                         │                       │
     │                         │◄── Stream response ───│
     │◄─────── SSE ────────────│                       │
     │                         │                       │
```

## 通信协议

### CLI ↔ Hub: Socket.IO

用于实时双向通信：

- 会话注册和心跳
- 消息转发（用户输入 → agent）
- 权限请求和响应
- 元数据和状态更新
- RPC 方法调用

### Hub ↔ Web: REST + SSE

- **REST API** 用于动作（发送消息、批准权限）
- **SSE stream** 用于实时更新（新消息、状态变化）

### 外部访问：隧道

从局域网外远程访问时：

- **Cloudflare Tunnel**（推荐）- 免费、安全、可靠
- **Tailscale** - 私有网络 mesh VPN
- **ngrok** - 快速测试设置

## 无缝切换

HAPI 的核心特性是可以在本地终端和远程设备之间无缝交接控制权，同时不丢失会话状态。

### 本地模式

本地模式下，你拥有完整终端体验，它就是原生 Claude Code、Codex 或 OpenCode：

- 键盘直接输入，响应即时
- 完整终端 UI 和语法高亮
- 适合专注、不间断的编程会话
- 所有 AI 处理都在你的机器上运行

### 远程模式

需要离开座位时切换到远程模式：

- 从任意设备通过 Web/PWA/Telegram 控制
- 随时批准权限
- 离开桌面时监控进度
- 会话继续在本地机器上运行

### 切换方式

```
┌─────────────────┐                    ┌─────────────────┐
│   Local Mode    │◄──────────────────►│   Remote Mode   │
│   (Terminal)    │                    │   (Phone/Web)   │
└─────────────────┘                    └─────────────────┘
        │                                      │
        │  ┌────────────────────────────┐      │
        └─►│  Same Session, Same State  │◄─────┘
           └────────────────────────────┘
```

**本地 → 远程：**

- 从 Web/PWA 收到消息
- 会话自动切换到远程模式
- 终端显示 “Remote mode - waiting for input”

**远程 → 本地：**

- 在终端按两次空格
- 立即重新获得本地控制权
- 像从未离开一样继续输入

### 使用场景

1. **离开座位后的远程控制** - 在桌面启动会话，通勤或休息时用手机或浏览器继续
2. **权限批准** - AI 请求文件访问，手机收到通知，一键批准后会话继续
3. **多设备协作** - 桌面负责执行，手机查看会话进度
