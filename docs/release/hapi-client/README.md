# HAPI Nexus Client

**Language:** English | [简体中文](README.zh-CN.md)

This archive contains the `hapi` client binary for local agent sessions, runner management, authentication, and diagnostics.

Use this package on developer, runner, or workstation machines. The Hub/Web server is distributed separately as the `hapi-server` package.

## Package Contents

- `hapi` or `hapi.exe` - Client binary
- `README.md` - Client commands and configuration guide
- `README.zh-CN.md` - Chinese client guide
- `LICENSE` and `NOTICE.md` - License and attribution files

## Requirements

Install and authenticate the agent CLIs you plan to use:

- Claude Code: `claude --version`
- OpenAI Codex CLI: `codex --version`
- Cursor Agent CLI: `agent --version`
- Grok Build CLI: `grok --version`
- OpenCode CLI: `opencode --version`

Only the agent you use must be installed on that client/runner machine.

## Install

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

macOS quarantine fix after browser download:

```bash
xattr -d com.apple.quarantine ./hapi
chmod +x ./hapi
```

## Connect to a Hub

Set the Hub URL and sign in with the current user's personal access token. The token is visible in Web Settings -> Account after username/password login.

```bash
export HAPI_API_URL="https://hapi.example.com"
hapi auth login
hapi auth status
```

Non-interactive setup:

```bash
HAPI_API_URL="https://hapi.example.com" \
CLI_API_TOKEN="<personal-access-token>" \
hapi auth status
```

If a reverse proxy requires extra headers:

```bash
export HAPI_EXTRA_HEADERS_JSON='{"Cookie":"CF_Authorization=..."}'
```

## Start Local Sessions

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

Resume a HAPI session locally:

```bash
hapi resume
hapi resume <session-id>
```

## Runner

The runner lets the Web app start sessions on this machine and browse only allowed workspace roots.

```bash
hapi runner start --workspace-root /path/to/projects
hapi runner status
hapi runner logs
hapi runner stop
```

Use multiple roots on the same runner when one machine has multiple allowed directories:

```bash
hapi runner start \
  --workspace-root /path/a \
  --workspace-root /path/b
```

`--workspace-root` means:

- The Web browse page can list files under that directory.
- Remote session creation is denied outside the configured roots.
- Project workspaces must be under one configured root.
- `~` and `~/path` are expanded.

Use `start-sync` when another supervisor such as systemd, launchd, pm2, or Docker keeps the process alive:

```bash
CLI_API_TOKEN="<personal-access-token>" \
hapi runner start-sync --workspace-root /path/to/projects
```

Stop the runner:

```bash
hapi runner stop
```

Runner-spawned agent sessions stay alive when the runner stops.

## Runner systemd Example

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

Commands:

```bash
systemctl --user daemon-reload
systemctl --user enable hapi-runner
systemctl --user start hapi-runner
systemctl --user status hapi-runner
journalctl --user -u hapi-runner -f
```

## Commands

Authentication:

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

Diagnostics:

```bash
hapi doctor
hapi doctor clean
```

Peer helpers:

```bash
hapi inspect-peer <session-id-or-prefix>
hapi ping-peer <session-id-prefix> <message>
```

MCP bridge:

```bash
hapi mcp
```

## Configuration

Client settings are stored under `HAPI_HOME`, defaulting to `~/.hapi`.

Common client variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `HAPI_API_URL` | `http://localhost:3006` | Hub base URL |
| `CLI_API_TOKEN` | unset | Current user's personal access token |
| `HAPI_HOME` | `~/.hapi` | Client config, runner state, and logs directory |
| `HAPI_EXTRA_HEADERS_JSON` | unset | Extra JSON headers for Hub requests |
| `HAPI_EXPERIMENTAL` | unset | Enable experimental features with `true`, `1`, or `yes` |
| `HAPI_CLAUDE_PATH` | `claude` from PATH | Specific Claude executable path |
| `HAPI_HTTP_MCP_URL` | unset | Default MCP target for `hapi mcp` |
| `HAPI_RUNNER_HEARTBEAT_INTERVAL` | `60000` | Runner heartbeat interval in milliseconds |
| `HAPI_RUNNER_HTTP_TIMEOUT` | `10000` | Runner control HTTP timeout in milliseconds |

Local files:

```text
~/.hapi/
├── settings.json
├── runner.state.json
├── runner.state.json.lock
└── logs/
```

## Troubleshooting

Check auth and machine identity:

```bash
hapi auth status
```

Check runner state:

```bash
hapi runner status
hapi runner logs
```

Clean stale local HAPI processes:

```bash
hapi doctor clean
```

For HTTP 401/403 errors, verify:

- `HAPI_API_URL` points to the correct Hub.
- `CLI_API_TOKEN` is the current user's personal access token.
- The user has access to the target machine/project.
- Extra proxy headers are present when required.
