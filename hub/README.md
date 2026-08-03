# hapi-hub

Telegram bot + HTTP API + realtime updates for hapi hub.

## What it does

- Telegram bot for notifications and the Mini App entrypoint.
- HTTP API for sessions, messages, permissions, machines, and files.
- Server-Sent Events stream for live updates in the web app.
- Socket.IO channel for CLI connections.
- Serves the web app from `web/dist` or embedded assets in the single binary.
- Local username/password accounts for private deployments.
- Project/member/workspace sharing inside a namespace.
- Persists state in SQLite.

## Configuration

See `src/configuration.ts` for all options.

### Required

- `CLI_API_TOKEN` - Base shared secret used by CLI, runner, owner access, and Telegram binding. Clients append `:<namespace>` for advanced namespace isolation. Auto-generated on first run if not set.

### Optional (initial local admin)

- `HAPI_ADMIN_USERNAME` - Username for the first local administrator. Defaults to `admin`.
- `HAPI_ADMIN_PASSWORD` - Password for the first local administrator. Defaults to `admin`.

These are used only when the hub creates the first active local admin. If an active local admin already exists, they do not replace it.

### Optional (Telegram)

- `TELEGRAM_BOT_TOKEN` - Token from @BotFather.
- `HAPI_PUBLIC_URL` - Public HTTPS URL for Telegram Mini App access. Also used to derive default CORS origins for the web app.

### Optional (Voice)

- `ELEVENLABS_API_KEY` - ElevenLabs API key for voice assistant.
- `ELEVENLABS_AGENT_ID` - Custom ElevenLabs agent ID (auto-created if not set).

### Optional

- `HAPI_LISTEN_HOST` - HTTP bind address (default: 127.0.0.1).
- `HAPI_LISTEN_PORT` - HTTP port (default: 3006).
- `CORS_ORIGINS` - Comma-separated origins, or `*`.
- `HAPI_HOME` - Data directory (default: ~/.hapi).
- `DB_PATH` - SQLite database path (default: HAPI_HOME/hapi.db).
- `TELEGRAM_NOTIFICATION` - Enable/disable Telegram notifications (default: true).
- `HAPI_RELAY_API` - Relay API domain (default: relay.hapi.run).
- `HAPI_RELAY_AUTH` - Relay auth key (default: hapi).
- `HAPI_RELAY_FORCE_TCP` - Force TCP relay mode (true/1).
- `VAPID_SUBJECT` - Contact email/URL for Web Push.

## Running

Binary (single executable):

```bash
export TELEGRAM_BOT_TOKEN="..."
export CLI_API_TOKEN="shared-secret"
export HAPI_PUBLIC_URL="https://your-domain.example"

hapi hub
```

`hapi server` remains supported as an alias.

If you only need web + CLI, you can omit TELEGRAM_BOT_TOKEN.
The browser UI signs in with local username/password accounts. On first start the default admin is `admin` / `admin`; change it from Settings -> Account.
To enable Telegram, set TELEGRAM_BOT_TOKEN and HAPI_PUBLIC_URL, start the hub, open `/app`
in the bot chat, and bind the Mini App with `CLI_API_TOKEN:<namespace>` when prompted.

From source:

```bash
bun install
bun run dev:hub
```

## HTTP API

See `src/web/routes/` for all endpoints.

### Authentication (`src/web/routes/auth.ts`)

- `POST /api/auth` - Get JWT token (Telegram initData, local username/password, `CLI_API_TOKEN[:namespace]`, or a personal access token). The Web UI uses username/password for normal browser login.
- `POST /api/bind` - Bind a Telegram account using initData + `CLI_API_TOKEN:<namespace>`.

### Users (`src/web/routes/users.ts`)

- `GET /api/me` - Return current profile, role, namespace, and own access token.
- `POST /api/me/token/regenerate` - Regenerate the current local user's personal access token.
- `PATCH /api/me/username` - Change the current local user's username. Usernames are unique inside a namespace.
- `POST /api/me/password` - Change the current local user's password after verifying the current password.
- `GET /api/users` - Admin-only user list for the current namespace.
- `POST /api/users` - Admin-only local user creation with username, password, display name, and role.
- `PATCH /api/users/:id` - Admin-only profile, role, and disabled-state updates.
- `POST /api/users/:id/password` - Admin-only local password reset.
- `POST /api/users/:id/token/regenerate` - Admin/self personal access token regeneration.

### Sessions (`src/web/routes/sessions.ts`)

- `GET /api/sessions` - List all sessions.
- `GET /api/sessions/:id` - Get session details.
- `POST /api/sessions/:id/abort` - Abort session.
- `POST /api/sessions/:id/switch` - Switch session to remote mode.
- `POST /api/sessions/:id/resume` - Resume inactive session.
- `POST /api/sessions/:id/upload` - Upload file (base64, max 50MB).
- `POST /api/sessions/:id/upload/delete` - Delete uploaded file.
- `POST /api/sessions/:id/archive` - Archive active session.
- `PATCH /api/sessions/:id` - Rename session.
- `DELETE /api/sessions/:id` - Delete inactive session.
- `GET /api/sessions/:id/slash-commands` - List slash commands.
- `GET /api/sessions/:id/skills` - List skills.
- `POST /api/sessions/:id/permission-mode` - Set permission mode.
- `POST /api/sessions/:id/model` - Set model preference.
- `POST /api/sessions/:id/effort` - Set Claude effort preference.

### Messages (`src/web/routes/messages.ts`)

- `GET /api/sessions/:id/messages` - Get messages (paginated).
- `POST /api/sessions/:id/messages` - Send message.

### Permissions (`src/web/routes/permissions.ts`)

- `POST /api/sessions/:id/permissions/:requestId/approve` - Approve permission.
- `POST /api/sessions/:id/permissions/:requestId/deny` - Deny permission.

### Machines (`src/web/routes/machines.ts`)

- `GET /api/machines` - List online machines.
- `POST /api/machines/:id/spawn` - Spawn new session on machine.
- `POST /api/machines/:id/list-directory` - List directories inside accessible workspace roots.
- `POST /api/machines/:id/paths/exists` - Check if path exists.

### Projects (`src/web/routes/projects.ts`)

- `GET /api/projects` - List projects visible to the current user.
- `POST /api/projects` - Create project, optionally with an initial owned workspace.
- `GET /api/projects/:id` - Get project details.
- `PATCH /api/projects/:id` - Rename project.
- `GET /api/projects/:id/members` - List members.
- `POST /api/projects/:id/members` - Add or update a member by bound user ID.
- `DELETE /api/projects/:id/members/:userId` - Remove a member.
- `GET /api/projects/:id/workspaces` - List project workspaces.
- `POST /api/projects/:id/workspaces` - Attach an owned machine workspace.
- `DELETE /api/projects/:id/workspaces/:workspaceId` - Remove a workspace.
- `POST /api/projects/:id/invites` - Create a reusable invite link.
- `POST /api/project-invites/:token/accept` - Accept an invite.

### Git/Files (`src/web/routes/git.ts`)

- `GET /api/sessions/:id/git-status` - Git status.
- `GET /api/sessions/:id/git-diff-numstat` - Diff summary.
- `GET /api/sessions/:id/git-diff-file` - File-specific diff.
- `GET /api/sessions/:id/file` - Read file content.
- `GET /api/sessions/:id/files` - File search with ripgrep.

### Events (`src/web/routes/events.ts`)

- `GET /api/events` - SSE stream for live updates.
- `POST /api/visibility` - Report client visibility state.

### Voice (`src/web/routes/voice.ts`)

- `POST /api/voice/token` - Get ElevenLabs conversation token.

### Push Notifications (`src/web/routes/push.ts`)

- `GET /api/push/vapid-public-key` - Get VAPID public key.
- `POST /api/push/subscribe` - Subscribe to push notifications.
- `DELETE /api/push/subscribe` - Unsubscribe.

### CLI (`src/web/routes/cli.ts`)

- `POST /cli/sessions` - Create/load session.
- `GET /cli/sessions/:id` - Get session by ID.
- `POST /cli/machines` - Create/load machine.
- `GET /cli/machines/:id` - Get machine by ID.

## Socket.IO

See `src/socket/handlers/cli.ts` for event handlers.

Namespace: `/cli`

### Client events (CLI to hub)

- `message` - Send message to session.
- `update-metadata` - Update session metadata.
- `update-state` - Update agent state.
- `session-alive` - Keep session active.
- `session-ready` - Cursor ACP `session/load` (or `newSession`) succeeded; hub defers merge/dedup until this arrives on reopen.
- `session-end` - Mark session ended.
- `machine-alive` - Keep machine online.
- `rpc-register` - Register RPC handler.
- `rpc-unregister` - Unregister RPC handler.

### Terminal events (web to hub)

- `terminal:create` - Open terminal for session.
- `terminal:write` - Send input.
- `terminal:resize` - Resize dimensions.
- `terminal:close` - Close terminal.

### Hub events (hub to clients)

- `update` - Broadcast session/message updates.
- `rpc-request` - Incoming RPC call.

See `src/socket/rpcRegistry.ts` for RPC routing.

## Telegram Bot

See `src/telegram/bot.ts` for bot implementation.

### Commands

- `/start` - Welcome message with Mini App link.
- `/app` - Open Mini App.

### Features

- Permission request notifications with approve/deny buttons.
- Session ready notifications.
- Deep links to Mini App sessions.

See `src/telegram/callbacks.ts` for button handlers.

## Core Logic

See `src/sync/syncEngine.ts` for the main session/message manager:

- In-memory session cache with versioning.
- Message pagination and retrieval.
- Permission approval/denial.
- RPC method routing via Socket.IO.
- Event publishing to SSE and Telegram.
- Git operations and file search.
- Activity tracking and timeouts.

## Storage

See `src/store/index.ts` for SQLite persistence:

- Sessions with metadata and agent state.
- Messages with pagination support.
- Machines with runner state.
- Projects, project members, project workspaces, and invite links.
- Todo extraction from messages.
- Users table for Telegram bindings and local username/password accounts (includes namespace, roles, disabled state, and per-user access tokens).

## Source structure

- `src/web/` - HTTP service and routes.
- `src/socket/` - Socket.IO setup and handlers.
- `src/socket/handlers/cli/` - Modular CLI handlers.
- `src/telegram/` - Telegram bot.
- `src/sync/` - Core session/message logic.
- `src/store/` - SQLite persistence.
- `src/sse/` - Server-Sent Events.
- `src/config/` - Configuration loading and generation.
- `src/notifications/` - Push and Telegram notifications.
- `src/visibility/` - Client visibility tracking.

## Security model

Access is controlled by:
- Telegram initData verification plus bound Telegram users (bound via `CLI_API_TOKEN:<namespace>`).
- Local username/password accounts for normal browser/PWA login.
- `CLI_API_TOKEN` base secret for CLI, runner, owner access, and Telegram binding (namespace is appended by clients).
- Per-user personal access tokens for companion/CLI-style user access.
- Project ACLs for sessions, messages, machines, files, and SSE events inside a namespace.
- Runner workspace roots as a machine-side allow-list; project workspaces grant narrower shared access.

Transport security depends on HTTPS in front of the hub.

## Build for deployment

From the repo root:

```bash
bun run build:hub
bun run build:web
```

The hub build output is `hub/dist/index.js`, and the web assets are in `web/dist`.

## Networking notes

- Telegram Mini Apps require HTTPS and a public URL. If the hub has no public IP, use Cloudflare Tunnel or Tailscale and set `HAPI_PUBLIC_URL` to the HTTPS endpoint.
- If the web app is hosted on a different origin, set `CORS_ORIGINS` (or `HAPI_PUBLIC_URL`) to include that static host origin.

## Standalone web hosting

The web UI can be hosted separately from the hub (for example on GitHub Pages or Cloudflare Pages):

1. Build and deploy `web/dist` from the repo root.
2. Set `CORS_ORIGINS` (or `HAPI_PUBLIC_URL`) to the static host origin.
3. Open the static site, click the Hub button on the login screen, and enter the hapi hub origin.

Leaving the hub override empty preserves the default same-origin behavior when the hub serves the web assets directly.
