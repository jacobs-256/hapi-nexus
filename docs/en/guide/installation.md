# Installation

**Language:** English | [简体中文](../../zh-CN/guide/installation.md)

Install HAPI Nexus from source and set up the private hub.

## Prerequisites

- Claude Code, OpenAI Codex CLI, Cursor Agent CLI, Grok Build CLI, or OpenCode CLI installed

Verify your CLI is installed:

```bash
# For Claude Code
claude --version

# For OpenAI Codex CLI
codex --version

# For Cursor Agent CLI
agent --version

# For Grok Build CLI
grok --version

# For OpenCode CLI
opencode --version
```

## Architecture

HAPI Nexus has three components:

| Component | Role | Required |
|-----------|------|----------|
| **CLI** | Wraps AI agents (Claude/Codex/Cursor/Grok/OpenCode), runs sessions | Yes |
| **Hub** | Central coordinator: persistence, real-time sync, remote access | Yes |
| **Runner** | Background service for remote session spawning | Optional |

### How they work together

```
┌─────────────────────────────────────────────────────┐
│              Your Machine                           │
│                                                     │
│  ┌─────────┐    Socket.IO    ┌─────────────┐       │
│  │  CLI    │◄───────────────►│    Hub      │       │
│  │+ Agent  │                 │  + SQLite   │       │
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

- **CLI**: Start a session with `hapi`. The CLI wraps your AI agent and syncs with the hub.
- **Hub**: Run `hapi-server hub`. Stores sessions, handles permissions, enables remote access.
- **Runner**: Run `CLI_API_TOKEN="<personal-access-token>" hapi runner start --workspace-root /path/to/projects`. Lets you spawn sessions from Web/PWA without keeping a terminal open.

### Typical workflows

**Local only**: `hapi-server hub` -> `hapi` -> work in terminal

**Remote access**: `hapi-server hub --relay` -> `CLI_API_TOKEN="<personal-access-token>" hapi runner start --workspace-root /path/to/projects` -> control from Web/PWA

Browser/PWA users sign in with local username/password accounts. The first-start administrator is `admin` / `admin`; change it after first login or set `HAPI_ADMIN_USERNAME` and `HAPI_ADMIN_PASSWORD` before the first hub start.

## Build the binaries

This fork is documented as a source-built private deployment. Build the server and client binaries from this repository:

```bash
bun install
bun run build:single-exe
```

The build writes two binaries under `cli/dist-exe/<bun-target>/`:

- `hapi-server` - server binary for running the Hub and serving the embedded Web app
- `hapi` - client binary for auth, runner, and local agent sessions

Common paths:

| Platform | Server binary | Client binary |
|----------|---------------|---------------|
| macOS Apple Silicon | `./cli/dist-exe/bun-darwin-arm64/hapi-server` | `./cli/dist-exe/bun-darwin-arm64/hapi` |
| macOS Intel | `./cli/dist-exe/bun-darwin-x64/hapi-server` | `./cli/dist-exe/bun-darwin-x64/hapi` |
| Linux x64 | `./cli/dist-exe/bun-linux-x64-baseline/hapi-server` | `./cli/dist-exe/bun-linux-x64-baseline/hapi` |
| Linux ARM64 | `./cli/dist-exe/bun-linux-arm64/hapi-server` | `./cli/dist-exe/bun-linux-arm64/hapi` |

Set helper variables before running the examples:

```bash
HAPI_SERVER_BIN=./cli/dist-exe/bun-darwin-arm64/hapi-server
HAPI_BIN=./cli/dist-exe/bun-darwin-arm64/hapi
```

## Other install options

<details>
<summary>Development mode</summary>

```bash
bun run dev
```

This starts the hub and web app concurrently for local development.
</details>

<details>
<summary>Prebuilt binary from your own release</summary>

GitHub Releases publish separate archives for the server and client binaries:

- `hapi-nexus-vX.Y.Z-hapi-server-<platform>.tar.gz` / `.zip` - install on the hub server
- `hapi-nexus-vX.Y.Z-hapi-<platform>.tar.gz` / `.zip` - install on runner/client machines

```bash
xattr -d com.apple.quarantine ./hapi-server ./hapi
chmod +x ./hapi-server
chmod +x ./hapi
sudo mv ./hapi-server /usr/local/bin/
sudo mv ./hapi /usr/local/bin/
```
</details>

<details>
<summary>Upstream package channels</summary>

The upstream HAPI project may publish npm, npx, Homebrew, or GitHub Release artifacts. Those artifacts are upstream HAPI builds, not HAPI Nexus builds. Use them only when you intentionally want the upstream project instead of this fork.
</details>

## Hub setup

The hub can be deployed on:

- **Local desktop** (default) - Run on your development machine
- **Remote host** - Deploy the hub on a VPS, cloud host, or any machine with network access

### Private LAN / VPN / reverse proxy (recommended)

```bash
HAPI_LISTEN_HOST=0.0.0.0 HAPI_PUBLIC_URL=http://<server-ip>:3006 "$HAPI_SERVER_BIN" hub --no-relay
```

The terminal displays the hub URL.

`HAPI_LISTEN_HOST=0.0.0.0` listens on all interfaces. `HAPI_PUBLIC_URL` must be the real IP or domain that browsers use to reach the hub; do not set it to `0.0.0.0`.

The `server` subcommand remains supported as an alias for `hub`.

- Fits enterprise/private deployments
- Works well with LAN, VPN, reverse proxy, or a private tunnel
- Keeps the web app served by your own hub

> **Tip:** Set `HAPI_PUBLIC_URL` to the externally reachable URL that browser users should open.

### Relay mode

Relay mode still exists in the codebase, but HAPI Nexus does not document upstream public relay as the default private-deployment path. Use it only when you have configured relay infrastructure that matches your deployment.

```bash
"$HAPI_SERVER_BIN" hub --relay
```

### Local only

```bash
"$HAPI_SERVER_BIN" hub
# or
"$HAPI_SERVER_BIN" hub --no-relay
```

The hub listens on `http://localhost:3006` by default.

On first run, HAPI Nexus:

1. Creates `~/.hapi/`
2. Generates a secure `CLI_API_TOKEN`
3. Prints the token and saves it to `~/.hapi/settings.json`
4. Creates a local Web administrator with username `admin` and password `admin`

Use `admin` / `admin` only for first sign-in, then change it in **Settings -> Account**.

<details>
<summary>Config files</summary>

```
~/.hapi/
├── settings.json      # Main configuration
├── hapi.db           # SQLite database (hub)
├── runner.state.json  # Runner process state
└── logs/             # Log files
```
</details>

### Database upgrades

`hapi-server` stores the current SQLite schema version in `PRAGMA user_version`. When a newer server starts with an older database, it runs the built-in migration chain before accepting traffic.

Before any non-empty database migration, HAPI Nexus writes a backup under:

```text
<directory-containing-hapi.db>/backups/
```

Migration steps are recorded in the `schema_migrations` table with the source version, target version, duration, and backup path. The current and expected schema versions are also visible in **Settings -> Storage**.

Recommended production upgrade flow:

1. Stop `hapi-server`.
2. Back up the whole data directory or EBS volume snapshot.
3. Replace the `hapi-server` binary.
4. Start `hapi-server`; database migration runs automatically if needed.
5. Check logs and **Settings -> Storage** for the schema version.

To roll back after a failed upgrade, stop `hapi-server`, restore the previous `hapi.db` backup or volume snapshot, then start the previous `hapi-server` binary.

<details>
<summary>Environment variables</summary>

| Variable | Default | settings.json | Description |
|----------|---------|---------------|-------------|
| `CLI_API_TOKEN` | Auto-generated | `cliApiToken` | Shared secret for authentication |
| `HAPI_ADMIN_USERNAME` | `admin` | - | Username for the first local Web administrator |
| `HAPI_ADMIN_PASSWORD` | `admin` | - | Password for the first local Web administrator |
| `HAPI_API_URL` | `http://localhost:3006` | `apiUrl` | Hub URL for CLI connections |
| `HAPI_EXTRA_HEADERS_JSON` | - | `extraHeaders` | JSON object of extra outbound headers for CLI → hub HTTP/WebSocket requests |
| `HAPI_LISTEN_HOST` | `127.0.0.1` | `listenHost` | Hub HTTP bind address |
| `HAPI_LISTEN_PORT` | `3006` | `listenPort` | Hub HTTP port |
| `HAPI_PUBLIC_URL` | - | `publicUrl` | Public URL for external access |
| `CORS_ORIGINS` | - | `corsOrigins` | Allowed CORS origins (comma-separated) |
| `TELEGRAM_BOT_TOKEN` | - | `telegramBotToken` | Telegram Bot API token |
| `TELEGRAM_NOTIFICATION` | `true` | `telegramNotification` | Enable Telegram notifications |
| `HAPI_RELAY_FORCE_TCP` | `false` | - | Force TCP mode for relay |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | - | Web Push contact info |
| `HAPI_HOME` | `~/.hapi` | - | Config directory path |
| `DB_PATH` | `~/.hapi/hapi.db` | - | Database file path |
| `ELEVENLABS_API_KEY` | - | - | ElevenLabs API key for voice |
| `ELEVENLABS_AGENT_ID` | Auto-created | - | Custom ElevenLabs agent ID |
</details>

<details>
<summary>settings.json example</summary>

Configuration priority: **ENV > settings.json > default**

When ENV values are set and not present in settings.json, they are automatically saved.
`HAPI_EXTRA_HEADERS_JSON` is not automatically saved, so access credentials are not persisted unexpectedly.

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

## CLI setup

If the hub is not on localhost, set these before running `hapi`:

```bash
export HAPI_API_URL="http://your-hub:3006"
export CLI_API_TOKEN="your-token-here"
export HAPI_EXTRA_HEADERS_JSON='{"Cookie":"CF_Authorization=..."}'
```

Or use interactive login:

```bash
hapi auth login
```

Authentication commands:

```bash
hapi auth status
hapi auth login
hapi auth logout
```

Each machine gets a unique ID stored in `~/.hapi/settings.json`. This allows:

- Multiple machines to connect to one hub
- Remote session spawning on specific machines
- Machine health monitoring

## Operations

### Self-hosted tunnels

If you prefer not to use the public relay (e.g., for lower latency or self-managed infrastructure), you can use these alternatives:

<details>
<summary>Cloudflare Tunnel</summary>

https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/

> **Note:** Cloudflare Quick Tunnels (TryCloudflare) are not supported because they [do not support SSE](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), which HAPI uses for real-time updates. Use a Named Tunnel instead.

**Named tunnel setup:**

```bash
# Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

# Create and configure a named tunnel
cloudflared tunnel create hapi
cloudflared tunnel route dns hapi hapi.yourdomain.com

# Run the tunnel
cloudflared tunnel --protocol http2 run hapi
```

> **Tip:** Use `--protocol http2` instead of QUIC (the default) to avoid potential timeout issues with long-lived connections.

</details>

<details>
<summary>Tailscale</summary>

https://tailscale.com/download

```bash
sudo tailscale up
hapi-server hub
```

Access via your Tailscale IP:

```
http://100.x.x.x:3006
```
</details>

<details>
<summary>Public IP / Reverse Proxy</summary>

If the hub has a public IP, access directly via `http://your-hub-ip:3006`.

Use HTTPS (via Nginx, Caddy, etc.) for production.

**Self-signed certificates (HTTPS)**

If `HAPI_API_URL` is set to an `https://...` URL with a self-signed (or otherwise untrusted) certificate, the CLI may fail with:

```
Error: self signed certificate
```

Recommended fixes (in order):

1. Use a publicly trusted certificate (e.g., Let's Encrypt)
2. Trust your private CA (recommended for private networks)
3. Dev-only workaround: disable TLS verification (insecure)

```bash
# Preferred: trust your own CA
export NODE_EXTRA_CA_CERTS="/path/to/your-ca.pem"

# Dev-only workaround: disable TLS verification (INSECURE)
export NODE_TLS_REJECT_UNAUTHORIZED=0
```

If you use the dev-only workaround, assume MITM risk; do not use on public networks.

</details>

### Telegram setup

Enable Telegram notifications and Mini App access:

1. Message [@BotFather](https://t.me/BotFather) and create a bot
2. Set the bot token and public URL
3. Start the hub and bind your account

```bash
export TELEGRAM_BOT_TOKEN="your-bot-token"
export HAPI_PUBLIC_URL="https://your-public-url"

hapi-server hub
```

Then message your bot with `/start`, open the app, and enter your `CLI_API_TOKEN`.

Normal browser/PWA login does not use `CLI_API_TOKEN`; use the local username/password account instead.

**Troubleshooting:**

- If binding fails, verify `HAPI_PUBLIC_URL` is accessible from the internet
- Telegram Mini App requires HTTPS (not HTTP)

### Runner setup

Run a background service for remote session spawning. In multi-user deployments, use the runner owner's personal access token from **Settings -> Account**:

```bash
CLI_API_TOKEN="<personal-access-token>" hapi runner start --workspace-root /path/to/projects
hapi runner status
hapi runner logs
hapi runner stop
```

With the runner running:

- Your machine appears in the "Machines" list
- You can spawn sessions remotely from the web app
- Sessions persist even when the terminal is closed

`/path/to/projects` is a directory on the runner machine. It should contain the repositories you want to browse or start sessions in. For multiple allowed directories, repeat the flag on the same runner:

```bash
CLI_API_TOKEN="<personal-access-token>" hapi runner start --workspace-root /path/a --workspace-root /path/b
```

Remote users do not need a local copy of the source code. They connect to the hub and use projects shared from the runner machine.

<details>
<summary>Alternative: pm2</summary>

If you prefer pm2 for process management:

```bash
pm2 start "env CLI_API_TOKEN='<personal-access-token>' hapi runner start-sync --workspace-root /path/to/projects" --name hapi-runner
pm2 save
```
</details>

### Background service deployment

Keep HAPI running persistently so it survives terminal closes, system restarts, and continues running in the background.

<details>
<summary>Quick: nohup</summary>

Simple one-liner for quick background runs:

```bash
# Hub
nohup hapi-server hub --relay > ~/.hapi/logs/hub.log 2>&1 &

# Runner
CLI_API_TOKEN="<personal-access-token>" nohup hapi runner start-sync --workspace-root /path/to/projects > ~/.hapi/logs/runner.log 2>&1 &
```

View logs:

```bash
tail -f ~/.hapi/logs/hub.log
tail -f ~/.hapi/logs/runner.log
```

Stop processes:

```bash
pkill -f "hapi-server hub"
pkill -f "hapi runner"
```
</details>

<details>
<summary>pm2 (recommended for Node.js users)</summary>

pm2 provides process management with auto-restart on crashes and system reboot.

```bash
# Install pm2
npm install -g pm2

# Start hub and runner
pm2 start "hapi-server hub --relay" --name hapi-hub
pm2 start "env CLI_API_TOKEN='<personal-access-token>' hapi runner start-sync --workspace-root /path/to/projects" --name hapi-runner

# View status and logs
pm2 status
pm2 logs hapi-hub
pm2 logs hapi-runner

# Auto-restart on system reboot
pm2 startup    # Follow the printed instructions
pm2 save       # Save current process list
```
</details>

<details>
<summary>macOS: launchd</summary>

Create plist files for automatic startup on macOS.

**Hub** (`~/Library/LaunchAgents/com.hapi.hub.plist`):

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

**Runner** (`~/Library/LaunchAgents/com.hapi.runner.plist`):

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

Load/unload services:

```bash
# Load (start)
launchctl load ~/Library/LaunchAgents/com.hapi.hub.plist
launchctl load ~/Library/LaunchAgents/com.hapi.runner.plist

# Unload (stop)
launchctl unload ~/Library/LaunchAgents/com.hapi.hub.plist
launchctl unload ~/Library/LaunchAgents/com.hapi.runner.plist
```

> **macOS sleep note:** macOS may suspend background processes when the display sleeps. Use `caffeinate` to prevent this:
> ```bash
> caffeinate -dimsu hapi-server hub --relay
> ```
> Or run `caffeinate -dimsu` in a separate terminal while HAPI is running.
</details>

<details>
<summary>Linux: systemd</summary>

Create user-level systemd services for automatic startup.

**Hub** (`~/.config/systemd/user/hapi-hub.service`):

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

**Runner** (`~/.config/systemd/user/hapi-runner.service`):

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

> **Why `KillMode=process`?** The runner spawns each agent session as a detached child process (`detached: true` in `cli/src/runner/run.ts`) so that sessions stay alive when the runner exits. Without `KillMode=process`, systemd's default `KillMode=control-group` sends SIGTERM to every PID in the runner's cgroup when the unit stops, defeating the detach and forcibly archiving every running session. `KillMode=process` preserves the contract: stopping or restarting the runner only signals the runner itself; agent sessions stay alive, and a fresh runner re-establishes control via the existing socket.io reconnect path. This applies to runner upgrades, manual restarts, and any reboot in which the runner unit is stopped before agents have finished.

Enable and start:

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

> **Persist after logout:** To keep services running even when not logged in:
> ```bash
> loginctl enable-linger $USER
> ```
</details>

### Voice assistant setup

Enable voice control:

1. Get an API key from [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys)
2. Set the environment variable:

```bash
export ELEVENLABS_API_KEY="your-api-key"
hapi-server hub --relay
```

See [Voice Assistant](./voice-assistant.md) for usage details.

### Security notes

- Change the default `admin` / `admin` credentials immediately after first sign-in
- Keep CLI and personal access tokens secret and rotate if needed
- Use HTTPS for public access
- Restrict CORS origins in production

<details>
<summary>Firewall example (ufw)</summary>

```bash
ufw allow from 192.168.1.0/24 to any port 3006
```
</details>
