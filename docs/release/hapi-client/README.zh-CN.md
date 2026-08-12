# HAPI Nexus 客户端

**语言：** [English](README.md) | 简体中文

此压缩包只包含 `hapi` 客户端程序，用于本地 agent 会话、runner 管理、认证和诊断。

这个包适合安装在开发机、runner 机器或工作站上。Hub/Web 服务器由单独的 `hapi-server` 包提供。

## 包内容

- `hapi` 或 `hapi.exe` - 客户端程序
- `README.md` - 英文客户端命令和配置说明
- `README.zh-CN.md` - 中文客户端说明
- `LICENSE` 和 `NOTICE.md` - 开源协议与署名文件

## 运行要求

根据你要使用的 agent 安装并登录对应 CLI：

- Claude Code: `claude --version`
- OpenAI Codex CLI: `codex --version`
- Cursor Agent CLI: `agent --version`
- Grok Build CLI: `grok --version`
- OpenCode CLI: `opencode --version`

只需要在这台客户端/runner 机器上安装实际会用到的 agent。

## 安装

Linux/macOS:

```bash
chmod +x ./hapi
sudo mv ./hapi /usr/local/bin/hapi
hapi --version
```

Windows PowerShell:

```powershell
.\hapi.exe --version
```

macOS 浏览器下载后的隔离属性处理：

```bash
xattr -d com.apple.quarantine ./hapi
chmod +x ./hapi
```

## 连接到 Hub

设置 Hub 地址，并使用当前用户的个人 access token 登录。该 token 可在 Web 使用用户名/密码登录后，从 Settings -> Account 中查看。

```bash
export HAPI_API_URL="https://hapi.example.com"
hapi auth login
hapi auth status
```

非交互式配置：

```bash
HAPI_API_URL="https://hapi.example.com" \
CLI_API_TOKEN="<personal-access-token>" \
hapi auth status
```

如果反向代理需要额外请求头：

```bash
export HAPI_EXTRA_HEADERS_JSON='{"Cookie":"CF_Authorization=..."}'
```

## 启动本地会话

Claude Code:

```bash
hapi
```

Codex:

```bash
hapi codex
hapi codex resume <session-id>
```

Cursor Agent:

```bash
hapi cursor
hapi cursor resume <chat-id>
hapi cursor --continue
```

Grok Build:

```bash
hapi grok
```

OpenCode:

```bash
hapi opencode
```

本地恢复 HAPI 会话：

```bash
hapi resume
hapi resume <session-id>
```

## Runner

Runner 允许 Web 应用在这台机器上启动会话，并且只浏览允许的工作目录。

```bash
hapi runner start --workspace-root /path/to/projects
hapi runner status
hapi runner logs
hapi runner stop
```

同一台机器有多个允许目录时，可以在同一个 runner 上指定多个 root：

```bash
hapi runner start \
  --workspace-root /path/a \
  --workspace-root /path/b
```

`--workspace-root` 的含义：

- Web 的目录浏览页面只能看到该目录下的文件。
- 远程创建会话时，路径不能超出这些 root。
- Project workspace 必须位于某个已配置 root 下面。
- 支持 `~` 和 `~/path` 展开。

如果使用 systemd、launchd、pm2 或 Docker 等外部进程管理器，使用 `start-sync`：

```bash
CLI_API_TOKEN="<personal-access-token>" \
hapi runner start-sync --workspace-root /path/to/projects
```

停止 runner：

```bash
hapi runner stop
```

runner 停止后，由 runner 创建的 agent 会话仍会继续运行。

## Runner systemd 示例

`~/.config/systemd/user/hapi-runner.service`:

```ini
[Unit]
Description=HAPI Nexus Runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
KillMode=process
Environment=HAPI_API_URL=https://hapi.example.com
Environment=CLI_API_TOKEN=<personal-access-token>
ExecStart=/usr/local/bin/hapi runner start-sync --workspace-root /path/to/projects
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

常用命令：

```bash
systemctl --user daemon-reload
systemctl --user enable hapi-runner
systemctl --user start hapi-runner
systemctl --user status hapi-runner
journalctl --user -u hapi-runner -f
```

## 命令

认证：

```bash
hapi auth status
hapi auth login
hapi auth logout
```

Runner:

```bash
hapi runner start
hapi runner start-sync
hapi runner stop
hapi runner status
hapi runner list
hapi runner stop-session <session-id>
hapi runner logs
```

诊断：

```bash
hapi doctor
hapi doctor clean
```

会话协作辅助：

```bash
hapi inspect-peer <session-id-or-prefix>
hapi ping-peer <session-id-prefix> <message>
```

MCP bridge:

```bash
hapi mcp
```

## 配置

客户端设置保存在 `HAPI_HOME` 下，默认是 `~/.hapi`。

常用客户端变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HAPI_API_URL` | `http://localhost:3006` | Hub 基础地址 |
| `CLI_API_TOKEN` | 未设置 | 当前用户的个人 access token |
| `HAPI_HOME` | `~/.hapi` | 客户端配置、runner 状态和日志目录 |
| `HAPI_EXTRA_HEADERS_JSON` | 未设置 | 访问 Hub 时附加的 JSON 请求头 |
| `HAPI_EXPERIMENTAL` | 未设置 | 使用 `true`、`1` 或 `yes` 启用实验功能 |
| `HAPI_CLAUDE_PATH` | PATH 中的 `claude` | 指定 Claude 可执行文件路径 |
| `HAPI_HTTP_MCP_URL` | 未设置 | `hapi mcp` 的默认 MCP 目标 |
| `HAPI_RUNNER_HEARTBEAT_INTERVAL` | `60000` | Runner 心跳间隔，毫秒 |
| `HAPI_RUNNER_HTTP_TIMEOUT` | `10000` | Runner 控制接口 HTTP 超时，毫秒 |

本地文件：

```text
~/.hapi/
├── settings.json
├── runner.state.json
├── runner.state.json.lock
└── logs/
```

## 排查

检查认证和机器身份：

```bash
hapi auth status
```

检查 runner 状态：

```bash
hapi runner status
hapi runner logs
```

清理本机残留 HAPI 进程：

```bash
hapi doctor clean
```

遇到 HTTP 401/403 时，重点检查：

- `HAPI_API_URL` 是否指向正确 Hub。
- `CLI_API_TOKEN` 是否为当前用户的个人 access token。
- 当前用户是否有目标 machine/project 权限。
- 反向代理需要的额外请求头是否已设置。
