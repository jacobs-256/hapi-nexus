# FAQ

**Language:** English | [简体中文](../../zh-CN/guide/faq.md)

## General

### What is HAPI Nexus?

HAPI Nexus is a local-first, self-hosted platform for running and controlling AI coding agents (Claude Code, Codex, Cursor Agent, Grok Build, and OpenCode) remotely. It lets teams start coding sessions on trusted machines and monitor/control them from a private Web/PWA interface.

### What does HAPI Nexus stand for?

HAPI comes from the upstream HAPI project name, itself a Chinese transliteration of "Happy". Nexus reflects this fork's private-hub direction: users, machines, workspaces, and projects connected through one deployment.

### Is HAPI Nexus free?

Yes, HAPI Nexus is open source and free to use under the AGPL-3.0-only license.

### What AI agents does HAPI Nexus support?

- **Claude Code** (recommended)
- **OpenAI Codex**
- **Cursor Agent**
- **Grok Build**
- **OpenCode**

## Setup & Installation

### Do I need a hub?

HAPI Nexus includes an embedded hub. Run `hapi-server hub` on your machine - no external hub required.

The `server` subcommand remains supported as an alias for `hub`.

### How do I access HAPI from my phone?

For local network access:
```
http://<your-computer-ip>:3006
```

If your phone cannot connect, make sure the hub is not only listening on `127.0.0.1`. For LAN access, set `listenHost` to `0.0.0.0` in `~/.hapi/settings.json` or set `HAPI_LISTEN_HOST=0.0.0.0`, then restart `hapi-server hub`.

For internet access:
- If the hub has a public IP, access it directly (use HTTPS via reverse proxy for production)
- If behind NAT, set up a tunnel (Cloudflare Tunnel, Tailscale, or ngrok)

### What's the access token for?

The `CLI_API_TOKEN` is a shared secret that authenticates:
- CLI connections to the hub
- runner connections and owner access
- Telegram account binding

It's auto-generated on first hub start and saved to `~/.hapi/settings.json`.

Normal browser/PWA login uses local username/password accounts instead. The first local admin is `admin` / `admin`; change it from **Settings -> Account** after first sign-in.

### Do you support multiple accounts?

Yes. Admins can create local username/password users in **Settings -> Users**. Each user has an independent password and a personal access token visible in **Settings -> Account**. Use projects to share sessions and runner workspaces between users in the same namespace. Use namespaces to isolate separate teams on one hub. See [Accounts and Access](./accounts.md), [Projects and Sharing](./projects.md), and [Namespace (Advanced)](./namespace.md).

### Can I use HAPI without Telegram?

Yes. Telegram is optional. You can use the web app directly in any browser or install it as a PWA.

## Usage

### How do I approve permissions remotely?

1. When your AI agent requests permission (e.g., to edit a file), you'll see a notification
2. Open HAPI on your phone
3. Navigate to the active session
4. Approve or deny the pending permission

### How do I receive notifications?

HAPI supports two methods:

1. **PWA Push Notifications** - Enable when prompted, works even when app is closed
2. **Telegram Bot** - See [Telegram Setup](./installation.md#telegram-setup)

### Can I start sessions remotely?

Yes, with runner mode:

1. Run `CLI_API_TOKEN="<personal-access-token>" hapi runner start --workspace-root /path/to/projects` on your computer
2. Your machine appears in the "Machines" list in the web app
3. Tap to spawn new sessions from anywhere

### How do I see what files were changed?

In the session view, tap the "Files" tab to:
- Browse project files
- View git status
- See diffs of changed files

### Can I send messages to the AI from my phone?

Yes. Open any session and use the chat interface to send messages directly to the AI agent.

### Can I access a terminal remotely?

Yes. Open a session in the web app and tap the Terminal tab for a remote shell.

Linux and macOS hosts use Bun's POSIX PTY support. Windows hosts use Bun's ConPTY support, which requires Bun 1.3.14 or newer.

### How do I use voice control?

Set `ELEVENLABS_API_KEY`, open a session in the web app, and click the microphone button. See [Voice Assistant](./voice-assistant.md).

## Security

### Is my data safe?

Yes. HAPI is local-first:
- All data stays on your machine
- Nothing is uploaded to external servers
- The database is stored locally in `~/.hapi/`

### How secure is authentication?

Browser login uses local username/password accounts. Passwords are hashed before storage. The auto-generated `CLI_API_TOKEN` is 256-bit and cryptographically secure. For external access, always use HTTPS via a tunnel or reverse proxy.

### Can others access my HAPI instance?

Only if they have valid browser credentials, a valid Web session, or a valid access token for CLI/companion/Telegram flows. For additional security:
- Change the default `admin` / `admin` password immediately
- Use strong, unique user passwords
- Keep CLI and personal access tokens secret
- Always use HTTPS for external access
- Consider Tailscale for private networking

## Troubleshooting

### "Connection refused" error

- Ensure hub is running: `hapi-server hub`
- Check firewall allows port 3006
- Verify `HAPI_API_URL` is correct

### My phone cannot access HAPI on the local network

If HAPI works on your computer but not from another device on the same LAN, check the hub bind address first. By default, HAPI listens on `127.0.0.1`, which only accepts localhost connections.

Use one of these:

```json
{
  "listenHost": "0.0.0.0"
}
```

```bash
export HAPI_LISTEN_HOST=0.0.0.0
```

Then restart `hapi-server hub` and open:

```bash
http://<your-computer-ip>:3006
```

Also verify your OS firewall allows inbound connections on port `3006`.

### "Invalid username or password" error

- Check the username and password
- If this is a new hub, try the first-start default `admin` / `admin`
- If you are already signed in as an admin, reset the user's password in **Settings -> Users**

### "Invalid token" error

- Re-run `hapi auth login`
- Check the CLI token is either the current user's personal access token or the hub owner system token
- Verify `~/.hapi/settings.json` has correct `cliApiToken`

### Runner won't start

```bash
# Check status
hapi runner status

# Clear stale lock file
rm ~/.hapi/runner.state.json.lock

# Check logs
hapi runner logs
```

### Claude Code not found

Install Claude Code or set custom path:
```bash
npm install -g @anthropic-ai/claude-code
# or
export HAPI_CLAUDE_PATH=/path/to/claude
```

### Cursor Agent not found

Install Cursor Agent CLI:
```bash
# macOS/Linux
curl https://cursor.com/install -fsS | bash

# Windows (PowerShell)
irm 'https://cursor.com/install?win32=true' | iex
```

Ensure `agent` is on your PATH.

### How do I run diagnostics?

```bash
hapi doctor
```

This checks hub connectivity, token validity, agent availability, and more.

## Comparison

### HAPI Nexus vs Happy

| Aspect | Happy | HAPI Nexus |
|--------|-------|------|
| Design | Cloud-first | Local-first |
| Users | Managed multi-user cloud | Private multi-user hub |
| Deployment | Multiple services | Single binary |
| Data | Encrypted on server | Never leaves your machine |

See [Why HAPI Nexus](./why-hapi.md) for detailed comparison.

### HAPI Nexus vs running Claude Code directly

| Feature | Claude Code | HAPI Nexus + Claude Code |
|---------|-------------|-------------------|
| Remote access | No | Yes |
| Mobile control | No | Yes |
| Permission approval | Terminal only | Phone/web |
| Session persistence | No | Yes |
| Multi-machine | Manual | Built-in |

## Contributing

### How can I contribute?

Use this repository's GitHub Issues and Pull Requests after it is published to:
- Report issues
- Submit pull requests
- Suggest features

### Where do I report bugs?

Open an issue in this repository after it is published.
