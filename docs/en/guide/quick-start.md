# Quick Start

**Language:** English | [简体中文](../../zh-CN/guide/quick-start.md)

## Install HAPI Nexus

This fork is documented as a source-built private deployment. After publishing your own packages or releases, update these commands to point to your repository or package namespace.

```bash
bun install
bun run build:single-exe
```

The build writes two binaries under `cli/dist-exe/<bun-target>/`: `hapi-server` for the Hub/Web server, and `hapi` for auth, runner, and local agent sessions. Pick the paths that match your machine:

```bash
# macOS Apple Silicon
HAPI_SERVER_BIN=./cli/dist-exe/bun-darwin-arm64/hapi-server
HAPI_BIN=./cli/dist-exe/bun-darwin-arm64/hapi

# macOS Intel
# HAPI_SERVER_BIN=./cli/dist-exe/bun-darwin-x64/hapi-server
# HAPI_BIN=./cli/dist-exe/bun-darwin-x64/hapi

# Linux x64
# HAPI_SERVER_BIN=./cli/dist-exe/bun-linux-x64-baseline/hapi-server
# HAPI_BIN=./cli/dist-exe/bun-linux-x64-baseline/hapi

"$HAPI_SERVER_BIN" --help
"$HAPI_BIN" --help
```

Other install and deployment options: [Installation](./installation.md)

## Start the hub

For a private LAN/VPN/reverse-proxy deployment:

```bash
HAPI_LISTEN_HOST=0.0.0.0 HAPI_PUBLIC_URL=http://<server-ip>:3006 "$HAPI_SERVER_BIN" hub --no-relay
```

`HAPI_LISTEN_HOST=0.0.0.0` listens on all interfaces. `HAPI_PUBLIC_URL` must be the real IP or domain that browsers use to reach the hub; do not set it to `0.0.0.0`.

On first run, HAPI Nexus creates:

- a CLI access token in `~/.hapi/settings.json`
- a local Web administrator with username `admin` and password `admin`

The `server` subcommand remains supported as an alias for `hub`.

The terminal will display the hub URL.

> For public internet access, put the hub behind your own VPN, reverse proxy, or tunnel and set `HAPI_PUBLIC_URL`.

## Start a runner

The runner lets Web users start sessions inside allowed directories. In multi-user deployments, use the runner owner's personal access token from **Settings -> Account**:

```bash
CLI_API_TOKEN="<personal-access-token>" "$HAPI_BIN" runner start --workspace-root /path/to/projects
```

Pass multiple `--workspace-root` flags when you need multiple allowed root directories.

## Sync Codex folder history

After the runner is online, create a Codex session from the Web UI, choose the machine and workspace folder, then click **Sync folder**. HAPI Nexus asks the runner to read local Codex transcripts for that exact folder, imports every matching history item into HAPI sessions, and opens the newest imported session.

Imported Codex sessions keep their original `codexSessionId` in HAPI metadata. That means future Web messages and local `hapi resume <session-id>` can continue from the original Codex thread instead of starting from an empty conversation.

## Start a local coding session

```bash
"$HAPI_BIN"
```

This starts Claude Code wrapped with HAPI Nexus. The session appears in the web UI.

## Open the UI

Open the URL shown in the terminal, or scan the QR code with your phone.

Sign in with `admin` / `admin`, then go to **Settings -> Account** and change the default username and password.

## Next steps

- [Seamless Handoff](./how-it-works.md#seamless-handoff) - Switch between terminal and phone seamlessly
- [Hub setup](./installation.md#hub-setup) - Access HAPI Nexus from anywhere
- [Codex folder history sync](#sync-codex-folder-history) - Bring existing Codex CLI history into HAPI Nexus
- [Accounts and Access](./accounts.md) - Manage users, passwords, and access tokens
- [Settings Console](./settings.md) - Configure accounts, users, projects, machines, and preferences
- [Notifications](./installation.md#telegram-setup) - Set up Telegram notifications
- [Install the App](./pwa.md) - Add HAPI Nexus to your home screen
- [License and Attribution](./license.md) - Understand AGPL-3.0 obligations and upstream notices
