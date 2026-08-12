# HAPI Nexus 服务器

**语言：** [English](README.md) | 简体中文

此压缩包只包含用于运行私有化 HAPI Nexus Hub 和内置 Web 应用的 `hapi-server`。

这个包只适合安装在服务器主机上。Runner/客户端机器请使用单独的 `hapi` 包。

## 包内容

- `hapi-server` 或 `hapi-server.exe` - Hub/Web 服务器程序
- `README.md` - 英文服务器部署、运行、运维说明
- `README.zh-CN.md` - 中文服务器说明
- `LICENSE` 和 `NOTICE.md` - 开源协议与署名文件

## 首次运行

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

浏览器打开 `HAPI_PUBLIC_URL`。首次启动时默认 Web 管理员为：

```text
用户名：admin
密码：admin
```

首次登录后请立即修改密码。也可以在第一次启动前设置 `HAPI_ADMIN_USERNAME` 和 `HAPI_ADMIN_PASSWORD`。

## 生产目录建议

推荐 Linux 目录：

```text
/opt/hapi-nexus/
└── hapi-server

/home/ubuntu/data/hapi/
├── config/
│   └── settings.json
└── database/
    └── hapi.db
```

推荐启动命令：

```bash
HAPI_HOME=/home/ubuntu/data/hapi/config \
DB_PATH=/home/ubuntu/data/hapi/database/hapi.db \
HAPI_LISTEN_HOST=0.0.0.0 \
HAPI_PUBLIC_URL=https://hapi.example.com \
/opt/hapi-nexus/hapi-server hub --no-relay
```

`DB_PATH` 必须包含 SQLite 文件名，不能只写目录。

## 配置

配置优先级：

```text
环境变量 > settings.json > 默认值
```

`HAPI_HOME` 和 `DB_PATH` 是路径控制项，只能通过环境变量指定，不从 `settings.json` 读取。

常用服务器变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HAPI_HOME` | `~/.hapi` | 服务器配置/数据目录 |
| `DB_PATH` | `$HAPI_HOME/hapi.db` | SQLite 数据库文件路径 |
| `HAPI_LISTEN_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `HAPI_LISTEN_PORT` | `3006` | HTTP 端口 |
| `HAPI_PUBLIC_URL` | `http://localhost:<port>` | 浏览器访问地址 |
| `CORS_ORIGINS` | 从 `HAPI_PUBLIC_URL` 推导 | 允许的跨域来源，逗号分隔 |
| `CLI_API_TOKEN` | 自动生成 | Hub 系统 token，用于引导/兼容 |
| `HAPI_ADMIN_USERNAME` | `admin` | 首个本地管理员用户名 |
| `HAPI_ADMIN_PASSWORD` | `admin` | 首个本地管理员密码 |
| `TELEGRAM_BOT_TOKEN` | 未设置 | Telegram bot token |
| `SERVERCHAN_SENDKEY` | 未设置 | ServerChan 通知 key |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Web Push 联系信息 |

`HAPI_HOME` 下的 `settings.json` 示例：

```json
{
  "listenHost": "0.0.0.0",
  "listenPort": 3006,
  "publicUrl": "https://hapi.example.com",
  "corsOrigins": ["https://hapi.example.com"]
}
```

## 运行模式

私有 LAN、VPN、反向代理、CloudFront 或 NLB：

```bash
./hapi-server hub --no-relay
```

Relay 模式，仅在你已经配置 relay 基础设施时使用：

```bash
./hapi-server hub --relay
```

本机测试：

```bash
./hapi-server hub --no-relay
```

`server` 仍然是 `hub` 的别名：

```bash
./hapi-server server --no-relay
```

## 反向代理说明

`HAPI_PUBLIC_URL` 必须设置为用户浏览器实际访问的 HTTPS 地址，不要设置为 `0.0.0.0`。

需要转发这些流量：

- `/api/*` 下的 HTTP REST 请求
- `/cli/*` 下的 CLI 请求
- `/api/events` 的 Server-Sent Events
- Socket.IO 的 WebSocket 流量
- 静态 Web 应用资源

健康检查地址：

```text
GET /health
```

正常响应会包含 `status: "ok"`。

## 数据库升级

`hapi-server` 使用 `PRAGMA user_version` 保存 SQLite 结构版本。新版服务器启动并发现旧版数据库时，会先执行内置迁移链，然后才开始对外服务。

非空数据库迁移前，HAPI Nexus 会在以下目录写入备份：

```text
<hapi.db 所在目录>/backups/
```

迁移历史会记录在 `schema_migrations` 表中，包括来源版本、目标版本、耗时和备份路径。

推荐升级流程：

1. 停止 `hapi-server`。
2. 备份整个数据目录或创建磁盘快照。
3. 替换 `hapi-server` 二进制文件。
4. 启动 `hapi-server`。
5. 查看日志，并在 Web 的 Settings -> Storage 检查 schema 版本。

回滚流程：

1. 停止 `hapi-server`。
2. 恢复之前的 `hapi.db` 备份或磁盘快照。
3. 恢复旧版 `hapi-server` 二进制文件。
4. 启动旧版程序。

## systemd 示例

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

常用命令：

```bash
sudo systemctl daemon-reload
sudo systemctl enable hapi-server
sudo systemctl start hapi-server
sudo systemctl status hapi-server
journalctl -u hapi-server -f
```

替换二进制文件后重启：

```bash
sudo systemctl restart hapi-server
```

## 运维检查清单

- 浏览器访问使用 HTTPS。
- 安全组或防火墙尽量限制到可信网络。
- 妥善保存 `CLI_API_TOKEN` 和用户 access token。
- 立即修改默认管理员密码。
- 备份 `DB_PATH` 以及 `HAPI_HOME` 下的附件数据。
- 负载均衡器使用 `/health` 做健康检查。
- 升级后在 Web Settings -> Storage 检查数据库版本。

## macOS 隔离属性

如果 macOS 下载后提示程序已损坏：

```bash
xattr -d com.apple.quarantine ./hapi-server
chmod +x ./hapi-server
```
