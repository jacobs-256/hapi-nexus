# HAPI Nexus Server

**Language:** English | [简体中文](README.zh-CN.md)

This archive contains the `hapi-server` binary for running a private HAPI Nexus Hub and the embedded Web app.

Use this package on the server host only. Runner/client machines should use the separate `hapi` package.

## Package Contents

- `hapi-server` or `hapi-server.exe` - Hub/Web server binary
- `README.md` - Server deployment, runtime, and operations guide
- `README.zh-CN.md` - Chinese server guide
- `LICENSE` and `NOTICE.md` - License and attribution files

## First Run

Linux/macOS:

```bash
chmod +x ./hapi-server
HAPI_LISTEN_HOST=0.0.0.0 \
HAPI_PUBLIC_URL=http://<server-ip-or-domain>:3006 \
./hapi-server hub --no-relay
```

Windows PowerShell:

```powershell
$env:HAPI_LISTEN_HOST = "0.0.0.0"
$env:HAPI_PUBLIC_URL = "http://<server-ip-or-domain>:3006"
.\hapi-server.exe hub --no-relay
```

Open `HAPI_PUBLIC_URL` in a browser. On first start, the default Web administrator is:

```text
Username: admin
Password: admin
```

Change this password immediately after the first login. You can also set `HAPI_ADMIN_USERNAME` and `HAPI_ADMIN_PASSWORD` before the first start.

## Production Layout

Recommended Linux layout:

```text
/opt/hapi-nexus/
└── hapi-server

/home/ubuntu/data/hapi/
├── config/
│   └── settings.json
└── database/
    └── hapi.db
```

Recommended start command:

```bash
HAPI_HOME=/home/ubuntu/data/hapi/config \
DB_PATH=/home/ubuntu/data/hapi/database/hapi.db \
HAPI_LISTEN_HOST=0.0.0.0 \
HAPI_PUBLIC_URL=https://hapi.example.com \
/opt/hapi-nexus/hapi-server hub --no-relay
```

`DB_PATH` must include the SQLite filename. Do not set it to a directory.

## Configuration

Configuration priority is:

```text
environment variables > settings.json > defaults
```

`HAPI_HOME` and `DB_PATH` are environment-only path controls. They are not read from `settings.json`.

Common server variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `HAPI_HOME` | `~/.hapi` | Server config/data directory |
| `DB_PATH` | `$HAPI_HOME/hapi.db` | Legacy/default SQLite database file path |
| `HAPI_CONVERSATION_STORE` | `sqlite` | Conversation storage backend: `sqlite` or `elasticsearch` |
| `ELASTICSEARCH_URL` / `ELASTICSEARCH_INDEX` / `ELASTICSEARCH_API_KEY` | unset | Elasticsearch conversation storage settings |
| `HAPI_CORE_STORE` | `sqlite` | Core storage backend: `sqlite` or `mysql` |
| `MYSQL_URL` or `MYSQL_HOST`/`MYSQL_PORT`/`MYSQL_DATABASE`/`MYSQL_USER`/`MYSQL_PASSWORD`/`MYSQL_TLS` | unset | MySQL core storage settings |
| `HAPI_LISTEN_HOST` | `127.0.0.1` | HTTP bind address |
| `HAPI_LISTEN_PORT` | `3006` | HTTP port |
| `HAPI_PUBLIC_URL` | `http://localhost:<port>` | Browser-facing URL |
| `CORS_ORIGINS` | derived from `HAPI_PUBLIC_URL` | Comma-separated allowed origins |
| `CLI_API_TOKEN` | generated | Hub system token for bootstrap/compatibility |
| `HAPI_ADMIN_USERNAME` | `admin` | First local admin username |
| `HAPI_ADMIN_PASSWORD` | `admin` | First local admin password |
| `TELEGRAM_BOT_TOKEN` | unset | Telegram bot token |
| `SERVERCHAN_SENDKEY` | unset | ServerChan notification key |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Web Push contact |

Example `settings.json` under `HAPI_HOME`:

```json
{
  "listenHost": "0.0.0.0",
  "listenPort": 3006,
  "publicUrl": "https://hapi.example.com",
  "corsOrigins": ["https://hapi.example.com"]
}
```

## Run Modes

Private LAN, VPN, reverse proxy, CloudFront, or NLB:

```bash
./hapi-server hub --no-relay
```

Relay mode, only when relay infrastructure is configured:

```bash
./hapi-server hub --relay
```

Local-only testing:

```bash
./hapi-server hub --no-relay
```

`server` remains an alias for `hub`:

```bash
./hapi-server server --no-relay
```

## Reverse Proxy Notes

Set `HAPI_PUBLIC_URL` to the public HTTPS URL users open in the browser, not to `0.0.0.0`.

Forward these traffic types to the hub:

- HTTP REST routes under `/api/*`
- CLI routes under `/cli/*`
- Server-Sent Events under `/api/events`
- WebSocket traffic for Socket.IO
- Static Web app assets

Health check endpoint:

```text
GET /health
```

Expected response includes `status: "ok"`.

## Database Upgrades

`hapi-server` stores the SQLite schema version in `PRAGMA user_version` for SQLite-backed data files. When a newer server starts with an older SQLite database, it runs the built-in migration chain before accepting traffic. If Settings -> Storage selects Elasticsearch for conversations or MySQL for core data, that external backend is the direct runtime database for its domain; explicit storage switching can copy existing data and long copies continue in the background.

Before migrating a non-empty database, HAPI Nexus writes a backup under:

```text
<directory-containing-hapi.db>/backups/
```

SQLite migration history is recorded in the `schema_migrations` table, including source version, target version, duration, and backup path. Storage-switch migration status is exposed in Web Settings -> Storage.

Recommended upgrade flow:

1. Stop `hapi-server`.
2. Back up the whole data directory or create a volume snapshot.
3. Replace the `hapi-server` binary.
4. Start `hapi-server`.
5. Check logs and Web Settings -> Storage for the schema version.

Rollback flow:

1. Stop `hapi-server`.
2. Restore the previous `hapi.db` backup or volume snapshot.
3. Restore the previous `hapi-server` binary.
4. Start the previous binary.

## systemd Example

`/etc/systemd/system/hapi-server.service`:

```ini
[Unit]
Description=HAPI Nexus Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/hapi-nexus
Environment=HAPI_HOME=/home/ubuntu/data/hapi/config
Environment=DB_PATH=/home/ubuntu/data/hapi/database/hapi.db
Environment=HAPI_LISTEN_HOST=0.0.0.0
Environment=HAPI_PUBLIC_URL=https://hapi.example.com
ExecStart=/opt/hapi-nexus/hapi-server hub --no-relay
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Commands:

```bash
sudo systemctl daemon-reload
sudo systemctl enable hapi-server
sudo systemctl start hapi-server
sudo systemctl status hapi-server
journalctl -u hapi-server -f
```

Restart after replacing the binary:

```bash
sudo systemctl restart hapi-server
```

## Operations Checklist

- Use HTTPS for browser access.
- Restrict security groups or firewall rules to trusted networks when possible.
- Keep `CLI_API_TOKEN` and user access tokens secret.
- Rotate the default admin password immediately.
- Back up `DB_PATH`, `HAPI_HOME`, and any configured MySQL/Elasticsearch backends.
- Check `/health` from the load balancer.
- Check Web Settings -> Storage after upgrades.

## macOS Quarantine

If macOS reports the binary as damaged after download:

```bash
xattr -d com.apple.quarantine ./hapi-server
chmod +x ./hapi-server
```
