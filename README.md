# HAPI Nexus

**Language:** English | [简体中文](README.zh-CN.md)

Enterprise-oriented private-deployment platform for running official Claude Code / Codex / Cursor Agent / Grok Build / OpenCode sessions locally and controlling them remotely through a Web / PWA / Telegram Mini App.

HAPI Nexus is an independent modified version of HAPI. It keeps the local-first agent workflow and adds private-hub features for teams: local username/password accounts, administrator-managed users, per-user access tokens, scoped runner workspaces, project sharing, and an enterprise-style Web console.

The CLI command is still `hapi` for compatibility with the existing codebase.

## Features

- **Seamless Handoff** - Work locally, switch to remote when needed, switch back anytime. No context loss, no session restart.
- **Native First** - HAPI wraps your AI agent instead of replacing it. Same terminal, same experience, same muscle memory.
- **AFK Without Stopping** - Step away from your desk? Approve AI requests from your phone with one tap.
- **Your AI, Your Choice** - Claude Code, Codex, Cursor Agent, Grok Build, OpenCode—different agents, one unified workflow.
- **Terminal Anywhere** - Run commands from your phone or browser, directly connected to the working machine.
- **Voice Control** - Talk to your AI agent hands-free using the built-in voice assistant.
- **Workspace Browser** - Opt-in via one or more `hapi runner start --workspace-root <path>` flags: browse scoped file trees from the web and start sessions in allowed subdirectories.
- **Project Sharing** - Create projects, attach runner workspaces, invite users, and share sessions without copying source code to every device.
- **Private Hub Accounts** - Browser users sign in with local username/password accounts. Admins can create users, assign roles, reset passwords, and issue per-user access tokens for companion/CLI use.

## Getting Started

After cloning this repository, install dependencies and build the all-in-one binary:

```bash
bun install
bun run build:single-exe
```

Start a private hub:

```bash
HAPI_LISTEN_HOST=0.0.0.0 HAPI_PUBLIC_URL=http://<server-ip>:3006 ./cli/dist/hapi hub --no-relay
```

Start a runner with one or more allowed workspace roots:

```bash
./cli/dist/hapi runner start --workspace-root /path/to/projects
```

Open the hub URL in a browser. The default browser login is `admin` / `admin`; change it from **Settings -> Account** after first sign-in.

For deployment options, see [Installation](docs/en/guide/installation.md).

## Docs

- [Quick Start](docs/en/guide/quick-start.md)
- [Installation](docs/en/guide/installation.md)
- [App](docs/en/guide/pwa.md)
- [Accounts and Access](docs/en/guide/accounts.md)
- [Settings Console](docs/en/guide/settings.md)
- [Projects and Sharing](docs/en/guide/projects.md)
- [How it Works](docs/en/guide/how-it-works.md)
- [License and Attribution](docs/en/guide/license.md)
- [Cursor Agent](docs/en/guide/cursor.md)
- [Grok Build](docs/en/guide/grok.md)
- [Voice Assistant](docs/en/guide/voice-assistant.md)
- [Why HAPI Nexus](docs/en/guide/why-hapi.md)
- [FAQ](docs/en/guide/faq.md)

## Build from source

```bash
bun install
bun run build:single-exe
```

## License and Attribution

HAPI Nexus is distributed under the [GNU Affero General Public License v3.0](LICENSE). Because this is a modified AGPL-covered project, keep the license, preserve upstream notices, and provide corresponding source code to users who interact with a deployed network service.

See [NOTICE.md](NOTICE.md) and [License and Attribution](docs/en/guide/license.md) for upstream attribution and modification notes.
