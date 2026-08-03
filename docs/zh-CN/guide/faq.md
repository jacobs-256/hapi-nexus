# FAQ

**语言：** [English](../../en/guide/faq.md) | 简体中文

## 常见问题

### HAPI Nexus 是什么？

HAPI Nexus 是一个 local-first、自托管的平台，用于远程运行和控制 AI 编程代理（Claude Code、Codex、Cursor Agent、Grok Build 和 OpenCode）。团队可以在可信机器上启动编程会话，并通过私有 Web/PWA 界面监控和控制。

### HAPI Nexus 代表什么？

HAPI 来自上游 HAPI 项目名，本身是 “Happy” 的中文音译。Nexus 表示这个 fork 的私有 Hub 方向：把用户、机器、工作区和项目连接到同一个部署中。

### HAPI Nexus 免费吗？

是。HAPI Nexus 是开源项目，使用 AGPL-3.0-only 许可证，可免费使用。

### HAPI Nexus 支持哪些 AI agent？

- **Claude Code**（推荐）
- **OpenAI Codex**
- **Cursor Agent**
- **Grok Build**
- **OpenCode**

## 设置与安装

### 我需要单独的 hub 吗？

不需要。HAPI Nexus 内置 hub。只要在你的机器上运行 `hapi hub` 即可，不需要外部 hub。

`hapi server` 仍然作为别名保留。

### 如何从手机访问 HAPI Nexus？

本地网络访问：

```
http://<your-computer-ip>:3006
```

如果手机无法连接，先确认 hub 不是只监听 `127.0.0.1`。局域网访问时，在 `~/.hapi/settings.json` 中把 `listenHost` 设置为 `0.0.0.0`，或设置 `HAPI_LISTEN_HOST=0.0.0.0`，然后重启 `hapi hub`。

公网访问：

- 如果 hub 有公网 IP，可直接访问（生产环境请通过反向代理使用 HTTPS）
- 如果在 NAT 后面，请配置隧道（Cloudflare Tunnel、Tailscale 或 ngrok）

### Access token 是做什么的？

`CLI_API_TOKEN` 是一个共享密钥，用于认证：

- CLI 到 hub 的连接
- runner 连接和 owner 访问
- Telegram 账号绑定

它会在 hub 首次启动时自动生成，并保存到 `~/.hapi/settings.json`。

普通浏览器/PWA 登录改用本地用户名/密码账号。第一个本地管理员是 `admin` / `admin`；首次登录后请在 **Settings -> Account** 中修改。

### 支持多个账号吗？

支持。管理员可以在 **Settings -> Users** 创建本地用户名/密码用户。每个用户有独立密码，并可在 **Settings -> Account** 查看自己的个人 access token。使用项目在同一命名空间内共享会话和 runner workspace；使用命名空间在同一个 hub 上隔离不同团队。见[账号与访问](./accounts.md)、[项目与共享](./projects.md)和[命名空间（高级）](./namespace.md)。

### 可以不使用 Telegram 吗？

可以。Telegram 是可选的。你可以直接在任意浏览器中使用 Web 应用，也可以把它安装为 PWA。

## 使用

### 如何远程批准权限？

1. 当 AI agent 请求权限（例如编辑文件）时，你会看到通知。
2. 在手机上打开 HAPI。
3. 进入活跃会话。
4. 批准或拒绝待处理权限。

### 如何接收通知？

HAPI 支持两种方式：

1. **PWA Push Notifications** - 按提示启用，应用关闭时也能工作
2. **Telegram Bot** - 见 [Telegram 设置](./installation.md#telegram-设置)

### 可以远程启动会话吗？

可以，使用 runner 模式：

1. 在电脑上运行 `hapi runner start --workspace-root /path/to/projects`
2. 你的机器会出现在 Web 应用的 “Machines” 列表中
3. 点击即可从任意位置启动新会话

### 如何查看哪些文件发生了变化？

在会话视图中点击 “Files” 标签：

- 浏览项目文件
- 查看 git status
- 查看变更 diff

### 可以从手机给 AI 发送消息吗？

可以。打开任意会话，使用聊天界面直接给 AI agent 发送消息。

### 可以远程访问终端吗？

可以。在 Web 应用中打开会话，点击 Terminal 标签即可使用远程 shell。

Linux 和 macOS 主机使用 Bun 的 POSIX PTY 支持。Windows 主机使用 Bun 的 ConPTY 支持，需要 Bun 1.3.14 或更新版本。

### 如何使用语音控制？

设置 `ELEVENLABS_API_KEY`，在 Web 应用中打开会话，然后点击麦克风按钮。见[语音助手](./voice-assistant.md)。

## 安全

### 我的数据安全吗？

是。HAPI Nexus 是 local-first：

- 所有数据都留在你的机器上
- 不会上传到外部服务器
- 数据库存储在本地 `~/.hapi/`

### 认证安全吗？

浏览器登录使用本地用户名/密码账号。密码在存储前会被哈希。自动生成的 `CLI_API_TOKEN` 是 256-bit 并且具备密码学安全性。外部访问时，请始终通过隧道或反向代理使用 HTTPS。

### 其他人能访问我的 HAPI 实例吗？

只有在拥有有效浏览器凭据、有效 Web session 或用于 CLI/伴侣客户端/Telegram 流程的有效 access token 时才可以。进一步加固：

- 立即修改默认 `admin` / `admin` 密码
- 使用强且唯一的用户密码
- 保管好 CLI 和个人 access token
- 外部访问始终使用 HTTPS
- 私有网络可考虑 Tailscale

## 故障排查

### "Connection refused" 错误

- 确保 hub 正在运行：`hapi hub`
- 检查防火墙是否允许 3006 端口
- 验证 `HAPI_API_URL` 是否正确

### 手机无法在局域网访问 HAPI Nexus

如果 HAPI 在电脑上可用，但同一局域网的其他设备无法访问，请先检查 hub 绑定地址。默认情况下，HAPI 监听 `127.0.0.1`，只接受本机连接。

使用下面任一方式：

```json
{
  "listenHost": "0.0.0.0"
}
```

```bash
export HAPI_LISTEN_HOST=0.0.0.0
```

然后重启 `hapi hub` 并打开：

```bash
http://<your-computer-ip>:3006
```

同时确认操作系统防火墙允许 `3006` 端口入站连接。

### "Invalid username or password" 错误

- 检查用户名和密码
- 如果这是新 hub，尝试首次启动默认值 `admin` / `admin`
- 如果你已作为管理员登录，可在 **Settings -> Users** 重置该用户密码

### "Invalid token" 错误

- 重新运行 `hapi auth login`
- 检查 CLI token 是否匹配 hub 的 `CLI_API_TOKEN`
- 验证 `~/.hapi/settings.json` 中是否有正确的 `cliApiToken`

### Runner 无法启动

```bash
# 检查状态
hapi runner status

# 清除陈旧 lock 文件
rm ~/.hapi/runner.state.json.lock

# 查看日志
hapi runner logs
```

### 找不到 Claude Code

安装 Claude Code 或设置自定义路径：

```bash
npm install -g @anthropic-ai/claude-code
# or
export HAPI_CLAUDE_PATH=/path/to/claude
```

### 找不到 Cursor Agent

安装 Cursor Agent CLI：

```bash
# macOS/Linux
curl https://cursor.com/install -fsS | bash

# Windows (PowerShell)
irm 'https://cursor.com/install?win32=true' | iex
```

确保 `agent` 在你的 PATH 中。

### 如何运行诊断？

```bash
hapi doctor
```

该命令会检查 hub 连通性、token 有效性、agent 可用性等。

## 对比

### HAPI Nexus vs Happy

| 方面 | Happy | HAPI Nexus |
|--------|-------|------|
| 设计 | Cloud-first | Local-first |
| 用户 | 托管多用户云服务 | 私有多用户 hub |
| 部署 | 多个服务 | 单个二进制 |
| 数据 | 在服务器上加密保存 | 不离开你的机器 |

详细对比见[为什么选择 HAPI](./why-hapi.md)。

### HAPI Nexus vs 直接运行 Claude Code

| 功能 | Claude Code | HAPI Nexus + Claude Code |
|---------|-------------|-------------------|
| 远程访问 | 否 | 是 |
| 手机控制 | 否 | 是 |
| 权限批准 | 仅终端 | 手机/Web |
| 会话持久化 | 否 | 是 |
| 多机器 | 手动 | 内置 |

## 贡献

### 如何贡献？

项目发布后，请使用本仓库的 GitHub Issues 和 Pull Requests：

- 报告问题
- 提交 pull request
- 建议功能

### 在哪里报告 bug？

项目发布后，在本仓库创建 issue。
