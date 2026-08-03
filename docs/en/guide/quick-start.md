# Quick Start

**Language:** English | [简体中文](../../zh-CN/guide/quick-start.md)

<Steps>

## Install HAPI

::: code-group

```bash [npm]
npm install -g @twsxtd/hapi --registry=https://registry.npmjs.org
```

```bash [Homebrew]
brew install tiann/tap/hapi
```

```bash [npx (one-off)]
npx @twsxtd/hapi
```

:::

> Recommendation: use the official npm registry for global install. Some mirrors may not sync platform packages in time.

Other install options: [Installation](./installation.md)

## Start the hub

```bash
hapi hub --relay
```

On first run, HAPI creates:

- a CLI access token in `~/.hapi/settings.json`
- a local Web administrator with username `admin` and password `admin`

`hapi server` remains supported as an alias.

The terminal will display a URL and QR code for remote access.

> End-to-end encrypted with WireGuard + TLS.

## Start a coding session

```bash
hapi
```

This starts Claude Code wrapped with HAPI. The session appears in the web UI.

## Open the UI

Open the URL shown in the terminal, or scan the QR code with your phone.

Sign in with `admin` / `admin`, then go to **Settings -> Account** and change the default username and password.

</Steps>

## Next steps

- [Seamless Handoff](./how-it-works.md#seamless-handoff) - Switch between terminal and phone seamlessly
- [Hub setup](./installation.md#hub-setup) - Access HAPI from anywhere
- [Accounts and Access](./accounts.md) - Manage users, passwords, and access tokens
- [Settings Console](./settings.md) - Configure accounts, users, projects, machines, and preferences
- [Notifications](./installation.md#telegram-setup) - Set up Telegram notifications
- [Install the App](./pwa.md) - Add HAPI to your home screen
