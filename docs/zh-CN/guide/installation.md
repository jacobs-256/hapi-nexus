# 安装

**语言：** [English](../../en/guide/installation.md) | 简体中文

从源码安装 HAPI Nexus，并设置私有 Hub。

## 前置条件

已安装 Claude Code、OpenAI Codex CLI、Cursor Agent CLI、Grok Build CLI 或 OpenCode CLI。

验证 CLI 是否已安装：

```bash
# Claude Code
claude --version

# OpenAI Codex CLI
codex --version

# Cursor Agent CLI
agent --version

# Grok Build CLI
grok --version

# OpenCode CLI
opencode --version
```

## 架构

HAPI Nexus 有三个组件：

| 组件 | 角色 | 必需 |
|-----------|------|----------|
| **CLI** | 包装 AI agent（Claude/Codex/Cursor/Grok/OpenCode），运行会话 | 是 |
| **Hub** | 中央协调器：持久化、实时同步、远程访问 | 是 |
| **Runner** | 用于远程启动会话的后台服务 | 可选 |

### 它们如何协作

```
┌─────────────────────────────────────────────────────┐
│              Your Machine                           │
│                                                     │
│  ┌─────────┐    Socket.IO    ┌─────────────┐       │
│  │  CLI    │◄───────────────►│    Hub      │       │
│  │+ Agent  │                 │ + 存储      │       │
│  └─────────┘                 └──────┬──────┘       │
│       ▲                             │ SSE          │
│       │ spawn                       ▼              │
│  ┌────┴────┐                 ┌─────────────┐       │
│  │ Runner  │◄────RPC────────►│   Web App   │       │
│  │(背景)   │                 └─────────────┘       │
│  └─────────┘                                       │
└─────────────────────────────────────────────────────┘
                    │
           [Tunnel / Public URL]
                    │
              ┌─────▼─────┐
              │ Phone/Web │
              └───────────┘
```

- **CLI**：用 `hapi` 启动会话。CLI 包装 AI agent 并与 hub 同步。
- **Hub**：运行 `hapi-server hub`。保存会话、处理权限、启用远程访问。
- **Runner**：运行 `CLI_API_TOKEN="<personal-access-token>" hapi runner start --workspace-root /path/to/projects`。无需保持终端打开，也能从 Web/PWA 远程启动会话。

### 典型工作流

**仅本地**：`hapi-server hub` -> `hapi` -> 在终端工作

**远程访问**：`hapi-server hub --relay` -> `CLI_API_TOKEN="<personal-access-token>" hapi runner start --workspace-root /path/to/projects` -> 从 Web/PWA 控制

浏览器/PWA 用户使用本地用户名/密码账号登录。首次启动管理员是 `admin` / `admin`；首次登录后请修改，或在第一次启动 hub 前设置 `HAPI_ADMIN_USERNAME` 和 `HAPI_ADMIN_PASSWORD`。

## 在 macOS 安装客户端

macOS Apple Silicon 和 Intel 机器可以通过 Homebrew 安装纯客户端 `hapi`：

```bash
brew install jacobs-256/hapi-nexus/hapi
hapi --version
```

升级、卸载和验证：

```bash
brew update
brew upgrade hapi
brew uninstall hapi
hapi --version
```

Homebrew 包不包含 Hub/Web 服务器，也不会自动启动本地 Hub。私有服务器请从 GitHub Releases 安装 `hapi-server`，或从源码构建。

## 构建二进制

请从本仓库构建服务器端和客户端二进制：

```bash
bun install
bun run build:single-exe
```

构建产物会输出到 `cli/dist-exe/<bun-target>/`：

- `hapi-server` - 服务器端二进制，用于运行 Hub 并提供内嵌 Web app
- `hapi` - 客户端二进制，用于 auth、runner 和本地 agent 会话

常见路径：

| 平台 | 服务器端二进制 | 客户端二进制 |
|----------|---------------|---------------|
| macOS Apple Silicon | `./cli/dist-exe/bun-darwin-arm64/hapi-server` | `./cli/dist-exe/bun-darwin-arm64/hapi` |
| macOS Intel | `./cli/dist-exe/bun-darwin-x64/hapi-server` | `./cli/dist-exe/bun-darwin-x64/hapi` |
| Linux x64 | `./cli/dist-exe/bun-linux-x64-baseline/hapi-server` | `./cli/dist-exe/bun-linux-x64-baseline/hapi` |
| Linux ARM64 | `./cli/dist-exe/bun-linux-arm64/hapi-server` | `./cli/dist-exe/bun-linux-arm64/hapi` |
| Windows x64 | `.\cli\dist-exe\bun-windows-x64\hapi-server.exe` | `.\cli\dist-exe\bun-windows-x64\hapi.exe` |

运行示例前，可以先设置辅助变量：

```bash
HAPI_SERVER_BIN=./cli/dist-exe/bun-darwin-arm64/hapi-server
HAPI_BIN=./cli/dist-exe/bun-darwin-arm64/hapi
```

## 其他安装方式

<details>
<summary>开发模式</summary>

```bash
bun run dev
```

这会同时启动 hub 和 web app，用于本地开发。
</details>

<details>
<summary>从 GitHub Releases 安装预构建二进制</summary>

GitHub Releases 会把服务器端和客户端分别打包发布：

- `hapi-nexus-vX.Y.Z-hapi-server-<platform>.tar.gz` / `.zip` - 安装到 Hub 服务器
- `hapi-nexus-vX.Y.Z-hapi-<platform>.tar.gz` / `.zip` - 安装到 runner / 客户端机器

客户端 release 覆盖 macOS、Linux 和 Windows。Windows x64 客户端压缩包名称为 `hapi-nexus-vX.Y.Z-hapi-windows-amd64.zip`。Homebrew 只支持 macOS；Linux 和 Windows 用户请下载匹配平台的 GitHub Release 压缩包。

解压 macOS/Linux 压缩包后：

```bash
chmod +x ./hapi-server
chmod +x ./hapi
sudo mv ./hapi-server /usr/local/bin/
sudo mv ./hapi /usr/local/bin/
```

macOS 上，通过浏览器下载的未签名二进制可能提示 **“hapi”已损坏，无法打开**。请对解压后的文件或已安装文件清除 quarantine 隔离属性：

```bash
xattr -dr com.apple.quarantine ./hapi
sudo xattr -dr com.apple.quarantine /usr/local/bin/hapi
```
</details>

<details>
<summary>上游包发布渠道</summary>

上游 HAPI 项目可能发布 npm、npx、Homebrew 或 GitHub Release 构建物。这些是上游 HAPI 构建，不是 HAPI Nexus 构建。只有当你明确想使用上游项目时才使用它们。
</details>

## Hub 设置

Hub 可以部署在：

- **本地桌面**（默认）- 运行在你的开发机器上
- **远程主机** - 部署到 VPS、云主机或任何有网络访问的机器

### 私有 LAN / VPN / 反向代理（推荐）

```bash
HAPI_LISTEN_HOST=0.0.0.0 HAPI_PUBLIC_URL=http://<server-ip>:3006 "$HAPI_SERVER_BIN" hub --no-relay
```

终端会显示 Hub URL。

`HAPI_LISTEN_HOST=0.0.0.0` 表示监听所有网卡。`HAPI_PUBLIC_URL` 必须是真实可被浏览器访问的 IP 或域名，不能写成 `0.0.0.0`。

`server` 子命令仍然作为 `hub` 的别名保留。

- 适合企业/私有部署
- 可配合 LAN、VPN、反向代理或私有 tunnel 使用
- Web app 由你自己的 Hub 提供

> **提示：** 将 `HAPI_PUBLIC_URL` 设置为浏览器用户实际访问的外部 URL。

### Relay 模式

Relay 模式仍保留在代码中，但 HAPI Nexus 不把上游公共 relay 作为私有部署的默认路径。只有当你已经配置了符合自己部署的 relay 基础设施时才使用。

```bash
"$HAPI_SERVER_BIN" hub --relay
```

### 仅本地

```bash
"$HAPI_SERVER_BIN" hub
# or
"$HAPI_SERVER_BIN" hub --no-relay
```

Hub 默认监听 `http://localhost:3006`。

首次运行时，HAPI Nexus 会：

1. 创建 `~/.hapi/`
2. 生成安全的 `CLI_API_TOKEN`
3. 打印 token 并保存到 `~/.hapi/settings.json`
4. 创建用户名为 `admin`、密码为 `admin` 的本地 Web 管理员

`admin` / `admin` 只用于首次登录，之后请在 **Settings -> Account** 中修改。

<details>
<summary>配置文件</summary>

```
~/.hapi/
├── settings.json      # 主配置
├── hapi.db           # 默认 SQLite 数据库（hub）
├── runner.state.json  # Runner 进程状态
└── logs/             # 日志文件
```
</details>

### 数据库升级

`hapi-server` 会把 SQLite 数据文件的结构版本保存在 `PRAGMA user_version`。当新版服务器启动并发现旧版 SQLite 数据库时，会先执行内置迁移链，然后才开始正常对外服务。如果在 Settings -> Storage 中选择 Elasticsearch 作为对话存储，或选择 MySQL 作为核心数据存储，该外部后端就是对应领域的直接运行时数据库；显式切换存储时可复制现有数据，大量数据复制会在后台继续执行。

对非空数据库执行迁移前，HAPI Nexus 会自动在下面目录生成备份：

```text
<hapi.db 所在目录>/backups/
```

每个迁移步骤都会写入 `schema_migrations` 表，包含来源版本、目标版本、耗时和备份路径。当前版本和目标版本也可以在 **Settings -> Storage** 中查看。

生产环境推荐升级流程：

1. 停止 `hapi-server`。
2. 备份整个数据目录，或创建 EBS volume snapshot。
3. 替换新的 `hapi-server` 二进制。
4. 启动 `hapi-server`；如有需要会自动执行数据库迁移。
5. 检查日志和 **Settings -> Storage** 中的数据库结构版本。

如果升级失败需要回滚，先停止 `hapi-server`，恢复之前的 `hapi.db` 备份或 volume snapshot，然后启动旧版本 `hapi-server`。

<details>
<summary>环境变量</summary>

| 变量 | 默认值 | settings.json | 说明 |
|----------|---------|---------------|-------------|
| `CLI_API_TOKEN` | 自动生成 | `cliApiToken` | 认证共享密钥 |
| `HAPI_ADMIN_USERNAME` | `admin` | - | 第一个本地 Web 管理员用户名 |
| `HAPI_ADMIN_PASSWORD` | `admin` | - | 第一个本地 Web 管理员密码 |
| `HAPI_API_URL` | `http://localhost:3006` | `apiUrl` | CLI 连接 hub 的 URL |
| `HAPI_EXTRA_HEADERS_JSON` | - | `extraHeaders` | CLI → hub HTTP/WebSocket 请求的额外出站 headers |
| `HAPI_LISTEN_HOST` | `127.0.0.1` | `listenHost` | Hub HTTP 绑定地址 |
| `HAPI_LISTEN_PORT` | `3006` | `listenPort` | Hub HTTP 端口 |
| `HAPI_PUBLIC_URL` | - | `publicUrl` | 外部访问公网 URL |
| `CORS_ORIGINS` | - | `corsOrigins` | 允许的 CORS origins（逗号分隔） |
| `TELEGRAM_BOT_TOKEN` | - | `telegramBotToken` | Telegram Bot API token |
| `TELEGRAM_NOTIFICATION` | `true` | `telegramNotification` | 启用 Telegram 通知 |
| `HAPI_RELAY_FORCE_TCP` | `false` | - | relay 强制使用 TCP 模式 |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | - | Web Push 联系信息 |
| `HAPI_HOME` | `~/.hapi` | - | 配置目录路径 |
| `DB_PATH` | `~/.hapi/hapi.db` | - | 旧版/默认 SQLite 数据库文件路径 |
| `HAPI_CONVERSATION_STORE` | `sqlite` | storage.conversation.type | 对话存储：`sqlite` 或 `elasticsearch` |
| `HAPI_CONVERSATION_SQLITE_PATH` | `DB_PATH` | storage.conversation.sqlitePath | 对话记录 SQLite 路径 |
| `ELASTICSEARCH_URL` | - | storage.conversation.elasticsearch.url | 对话存储 Elasticsearch 地址 |
| `ELASTICSEARCH_INDEX` | `hapi-conversations` | storage.conversation.elasticsearch.index | Elasticsearch index 或 data stream |
| `ELASTICSEARCH_API_KEY` | - | storage.conversation.elasticsearch.apiKey | Base64 后的 Elasticsearch API key |
| `HAPI_CORE_STORE` | `sqlite` | storage.core.type | 核心数据存储：`sqlite` 或 `mysql` |
| `HAPI_CORE_SQLITE_PATH` | `DB_PATH` | storage.core.sqlitePath | 用户/项目/机器/设置的 SQLite 路径 |
| `MYSQL_URL` | - | storage.core.mysql.url | 核心数据 MySQL 连接 URL；需要 TLS 时可追加 `?ssl=true` |
| `MYSQL_TLS` | - | storage.core.mysql.tls | 为 host/port 形式的 MySQL 核心存储配置启用 TLS |
| `ELEVENLABS_API_KEY` | - | - | 语音功能的 ElevenLabs API key |
| `ELEVENLABS_AGENT_ID` | 自动创建 | - | 自定义 ElevenLabs agent ID |
</details>

<details>
<summary>settings.json 示例</summary>

配置优先级：**ENV > settings.json > default**

当 ENV 中设置了值且 settings.json 中不存在时，HAPI 会自动保存这些值。`HAPI_EXTRA_HEADERS_JSON` 不会自动保存，以避免访问凭据被意外持久化。

```json
{
  "listenHost": "0.0.0.0",
  "listenPort": 3006,
  "publicUrl": "https://your-domain.com",
  "extraHeaders": {
    "Cookie": "CF_Authorization=..."
  }
}
```
</details>

## CLI 设置

如果 hub 不在 localhost，请在运行 `hapi` 前设置：

```bash
export HAPI_API_URL="http://your-hub:3006"
export CLI_API_TOKEN="your-token-here"
export HAPI_EXTRA_HEADERS_JSON='{"Cookie":"CF_Authorization=..."}'
```

或使用交互式登录：

```bash
hapi auth login
```

认证命令：

```bash
hapi auth status
hapi auth login
hapi auth logout
```

每台机器会获得一个唯一 ID，并保存到 `~/.hapi/settings.json`。这支持：

- 多台机器连接到同一个 hub
- 在指定机器上远程启动会话
- 机器健康监控

## 运维

### 自托管隧道

如果你不想使用公共 relay（例如希望更低延迟或自管基础设施），可以使用以下替代方案：

<details>
<summary>Cloudflare Tunnel</summary>

https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/

> **注意：** Cloudflare Quick Tunnels（TryCloudflare）不受支持，因为它们[不支持 SSE](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)，而 HAPI 依赖 SSE 实时更新。请使用 Named Tunnel。

**Named tunnel 设置：**

```bash
# 安装 cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

# 创建并配置 named tunnel
cloudflared tunnel create hapi
cloudflared tunnel route dns hapi hapi.yourdomain.com

# 运行 tunnel
cloudflared tunnel --protocol http2 run hapi
```

> **提示：** 使用 `--protocol http2` 代替默认 QUIC，可避免长连接的潜在超时问题。

</details>

<details>
<summary>Tailscale</summary>

https://tailscale.com/download

```bash
sudo tailscale up
hapi-server hub
```

通过你的 Tailscale IP 访问：

```
http://100.x.x.x:3006
```
</details>

<details>
<summary>公网 IP / 反向代理</summary>

如果 hub 有公网 IP，可直接通过 `http://your-hub-ip:3006` 访问。

生产环境请使用 HTTPS（Nginx、Caddy 等）。

**自签证书（HTTPS）**

如果 `HAPI_API_URL` 指向一个使用自签名证书（或其他不受信证书）的 `https://...` URL，CLI 可能失败：

```
Error: self signed certificate
```

推荐修复方式（按优先级）：

1. 使用公开受信任证书（例如 Let's Encrypt）
2. 信任你的私有 CA（私有网络推荐）
3. 仅开发环境临时方案：关闭 TLS 校验（不安全）

```bash
# 推荐：信任自己的 CA
export NODE_EXTRA_CA_CERTS="/path/to/your-ca.pem"

# 仅开发环境：关闭 TLS 校验（不安全）
export NODE_TLS_REJECT_UNAUTHORIZED=0
```

如果使用仅开发环境方案，请假设存在 MITM 风险；不要在公网使用。

</details>

### Telegram 设置

启用 Telegram 通知和 Mini App 访问：

1. 给 [@BotFather](https://t.me/BotFather) 发消息并创建 bot
2. 设置 bot token 和 public URL
3. 启动 hub 并绑定账号

```bash
export TELEGRAM_BOT_TOKEN="your-bot-token"
export HAPI_PUBLIC_URL="https://your-public-url"

hapi-server hub
```

然后向 bot 发送 `/start`，打开应用，并输入你的 `CLI_API_TOKEN`。

普通浏览器/PWA 登录不使用 `CLI_API_TOKEN`；请使用本地用户名/密码账号。

**故障排查：**

- 如果绑定失败，确认 `HAPI_PUBLIC_URL` 可以从互联网访问
- Telegram Mini App 要求 HTTPS（不是 HTTP）

### Runner 设置

运行后台服务以支持远程启动会话。多用户部署时，请使用 runner 所属用户在 **Settings -> Account** 中看到的个人 access token：

```bash
CLI_API_TOKEN="<personal-access-token>" hapi runner start --workspace-root /path/to/projects
hapi runner status
hapi runner logs
hapi runner stop
```

Runner 运行后：

- 你的机器会出现在 “Machines” 列表中
- 可以从 Web 应用远程启动会话
- 即使终端关闭，会话也会继续存在

`/path/to/projects` 是 runner 机器上的目录。它应包含你想浏览或启动会话的仓库。多个允许目录时，在同一个 runner 上重复传入参数：

```bash
CLI_API_TOKEN="<personal-access-token>" hapi runner start --workspace-root /path/a --workspace-root /path/b
```

远程用户不需要本地复制源码。他们连接到 hub，并使用 runner 机器共享出来的项目。

<details>
<summary>替代方案：pm2</summary>

如果你偏好用 pm2 管理进程：

```bash
pm2 start "env CLI_API_TOKEN='<personal-access-token>' hapi runner start-sync --workspace-root /path/to/projects" --name hapi-runner
pm2 save
```
</details>

### 后台服务部署

让 HAPI 持续运行，使其在终端关闭、系统重启后仍在后台运行。

<details>
<summary>快速方式：nohup</summary>

快速后台运行的一行命令：

```bash
# Hub
nohup hapi-server hub --relay > ~/.hapi/logs/hub.log 2>&1 &

# Runner
CLI_API_TOKEN="<personal-access-token>" nohup hapi runner start-sync --workspace-root /path/to/projects > ~/.hapi/logs/runner.log 2>&1 &
```

查看日志：

```bash
tail -f ~/.hapi/logs/hub.log
tail -f ~/.hapi/logs/runner.log
```

停止进程：

```bash
pkill -f "hapi-server hub"
pkill -f "hapi runner"
```
</details>

<details>
<summary>pm2（Node.js 用户推荐）</summary>

pm2 提供崩溃自动重启和系统重启后自启动。

```bash
# 安装 pm2
npm install -g pm2

# 启动 hub 和 runner
pm2 start "hapi-server hub --relay" --name hapi-hub
pm2 start "env CLI_API_TOKEN='<personal-access-token>' hapi runner start-sync --workspace-root /path/to/projects" --name hapi-runner

# 查看状态和日志
pm2 status
pm2 logs hapi-hub
pm2 logs hapi-runner

# 系统重启后自动启动
pm2 startup    # 按输出提示操作
pm2 save       # 保存当前进程列表
```
</details>

<details>
<summary>macOS: launchd</summary>

在 macOS 上创建 plist 文件实现自动启动。

**Hub** (`~/Library/LaunchAgents/com.hapi.hub.plist`)：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.hapi.hub</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/hapi-server</string>
        <string>hub</string>
        <string>--relay</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/.hapi/logs/hub.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/.hapi/logs/hub.log</string>
</dict>
</plist>
```

**Runner** (`~/Library/LaunchAgents/com.hapi.runner.plist`)：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.hapi.runner</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/hapi</string>
        <string>runner</string>
        <string>start-sync</string>
        <string>--workspace-root</string>
        <string>/path/to/projects</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/.hapi/logs/runner.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/.hapi/logs/runner.log</string>
</dict>
</plist>
```

加载/卸载服务：

```bash
# Load (start)
launchctl load ~/Library/LaunchAgents/com.hapi.hub.plist
launchctl load ~/Library/LaunchAgents/com.hapi.runner.plist

# Unload (stop)
launchctl unload ~/Library/LaunchAgents/com.hapi.hub.plist
launchctl unload ~/Library/LaunchAgents/com.hapi.runner.plist
```

> **macOS 睡眠说明：** 显示器睡眠时，macOS 可能挂起后台进程。可用 `caffeinate` 防止：
> ```bash
> caffeinate -dimsu hapi-server hub --relay
> ```
> 或单独在一个终端中运行 `caffeinate -dimsu`。
</details>

<details>
<summary>Linux: systemd</summary>

创建用户级 systemd 服务实现自动启动。

**Hub** (`~/.config/systemd/user/hapi-hub.service`)：

```ini
[Unit]
Description=HAPI Hub
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/hapi-server hub --relay
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

**Runner** (`~/.config/systemd/user/hapi-runner.service`)：

```ini
[Unit]
Description=HAPI Runner
After=network.target hapi-hub.service

[Service]
Type=simple
KillMode=process
Environment=CLI_API_TOKEN=<personal-access-token>
ExecStart=/usr/local/bin/hapi runner start-sync --workspace-root /path/to/projects
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

> **为什么需要 `KillMode=process`？** runner 会把每个 agent 会话作为 detached child process 启动（`detached: true`，见 `cli/src/runner/run.ts`），这样 runner 退出时会话仍能存活。如果不设置 `KillMode=process`，systemd 默认 `KillMode=control-group` 会在 unit 停止时向 runner cgroup 中的每个 PID 发送 SIGTERM，破坏 detach 约定并强制归档所有运行中的会话。`KillMode=process` 保留约定：停止或重启 runner 只影响 runner 自身；agent 会话保持运行，新的 runner 会通过现有 socket.io reconnect 路径重新接管。这适用于 runner 升级、手动重启，以及任何在 agent 完成前停止 runner unit 的重启流程。

启用并启动：

```bash
# Reload systemd
systemctl --user daemon-reload

# Enable (auto-start on login)
systemctl --user enable hapi-hub
systemctl --user enable hapi-runner

# Start now
systemctl --user start hapi-hub
systemctl --user start hapi-runner

# View status/logs
systemctl --user status hapi-hub
journalctl --user -u hapi-hub -f
```

> **退出登录后仍保持运行：**
> ```bash
> loginctl enable-linger $USER
> ```
</details>

### 语音助手设置

启用语音控制：

1. 从 [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys) 获取 API key
2. 设置环境变量：

```bash
export ELEVENLABS_API_KEY="your-api-key"
hapi-server hub --relay
```

使用详情见[语音助手](./voice-assistant.md)。

### 安全注意事项

- 首次登录后立即修改默认 `admin` / `admin` 凭据
- 保管好 CLI 和个人 access token，并在需要时轮换
- 公网访问使用 HTTPS
- 生产环境限制 CORS origins

<details>
<summary>防火墙示例（ufw）</summary>

```bash
ufw allow from 192.168.1.0/24 to any port 3006
```
</details>
