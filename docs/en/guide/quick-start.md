# Quick Start

**Language:** English | [简体中文](../../zh-CN/guide/quick-start.md)

## Install HAPI Nexus

This fork is documented as a source-built private deployment. After publishing your own packages or releases, update these commands to point to your repository or package namespace.

```bash
bun install
bun run build:single-exe
```

The built CLI keeps the `hapi` command name for compatibility. In this repository, run it from:

```bash
./cli/dist/hapi --help
```

Other install and deployment options: [Installation](./installation.md)

## Start the hub

For a private LAN/VPN/reverse-proxy deployment:

```bash
HAPI_LISTEN_HOST=0.0.0.0 HAPI_PUBLIC_URL=http://<server-ip>:3006 ./cli/dist/hapi hub --no-relay
```

On first run, HAPI Nexus creates:

- a CLI access token in `~/.hapi/settings.json`
- a local Web administrator with username `admin` and password `admin`

`hapi server` remains supported as an alias.

The terminal will display the hub URL.

> For public internet access, put the hub behind your own VPN, reverse proxy, or tunnel and set `HAPI_PUBLIC_URL`.

## Start a runner

The runner lets Web users start sessions inside allowed directories:

```bash
./cli/dist/hapi runner start --workspace-root /path/to/projects
```

Pass multiple `--workspace-root` flags when you need multiple allowed root directories.

## Start a local coding session

```bash
./cli/dist/hapi
```

This starts Claude Code wrapped with HAPI Nexus. The session appears in the web UI.

## Open the UI

Open the URL shown in the terminal, or scan the QR code with your phone.

Sign in with `admin` / `admin`, then go to **Settings -> Account** and change the default username and password.

## Next steps

- [Seamless Handoff](./how-it-works.md#seamless-handoff) - Switch between terminal and phone seamlessly
- [Hub setup](./installation.md#hub-setup) - Access HAPI Nexus from anywhere
- [Accounts and Access](./accounts.md) - Manage users, passwords, and access tokens
- [Settings Console](./settings.md) - Configure accounts, users, projects, machines, and preferences
- [Notifications](./installation.md#telegram-setup) - Set up Telegram notifications
- [Install the App](./pwa.md) - Add HAPI Nexus to your home screen
- [License and Attribution](./license.md) - Understand AGPL-3.0 obligations and upstream notices
