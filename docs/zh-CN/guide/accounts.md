# 账号与访问

**语言：** [English](../../en/guide/accounts.md) | 简体中文

HAPI 的浏览器界面在私有部署中使用本地邮箱和密码账号。Access token 仍然存在，但它们用于 CLI、runner、Telegram 绑定和伴侣客户端流程，不用于普通浏览器登录。

## 初始管理员

Hub 首次启动时，如果不存在启用状态的本地管理员，HAPI 会创建一个本地管理员：

| 字段 | 默认值 |
| --- | --- |
| 邮箱 | `admin@hapi.local` |
| 密码 | `admin` |

首次登录后请立即修改默认凭据：

1. 打开 Web UI。
2. 使用 `admin@hapi.local` / `admin` 登录。
3. 进入 **Settings -> Account**。
4. 修改邮箱和密码。

无人值守部署时，可以在第一次启动 hub 前设置环境变量：

```bash
export HAPI_ADMIN_EMAIL="admin@hapi.local"
export HAPI_ADMIN_PASSWORD="change-this-password"
hapi-server hub
```

如果本地管理员已经存在，这些环境变量不会覆盖现有账号。

## 浏览器登录

普通浏览器/PWA 登录只接受：

- 邮箱
- 密码

Web UI 会在浏览器中保存登录后返回的短期 Web session token。它会刻意忽略 `?token=` 链接和已保存的 `CLI_API_TOKEN` 值，不会把它们作为浏览器登录凭据。

## 账号设置

每个本地用户都可以打开 **Settings -> Account**：

- 查看个人资料、命名空间和角色
- 查看并复制个人 access token
- 重新生成个人 access token
- 修改自己的邮箱
- 修改自己的密码
- 退出浏览器登录

邮箱在同一个命名空间内必须唯一。改名为已有邮箱会被拒绝。

## 用户管理

管理员可以打开 **Settings -> Users**：

- 创建本地邮箱/密码用户
- 分配 `user` 或 `admin` 角色
- 禁用账号
- 重置本地用户密码
- 重新生成个人 access token

内置 hub owner 身份仍由 `CLI_API_TOKEN` 支撑；本地管理员账号是管理浏览器 UI 的推荐方式。

## 各类凭据的用途

| 凭据 | 使用方 | 说明 |
| --- | --- | --- |
| 邮箱/密码 | 浏览器和 PWA 登录 | 首次启动的默认管理员是 `admin@hapi.local` / `admin`。 |
| 个人 access token | 伴侣客户端/CLI 风格的用户访问 | 在 **Settings -> Account** 中显示，用户可以重新生成。 |
| `CLI_API_TOKEN` | CLI、runner、owner 访问、Telegram 绑定 | 首次启动时生成，并保存到 `~/.hapi/settings.json`，除非显式配置。 |
| Web session JWT | 浏览器 API/SSE 调用 | 邮箱/密码登录后返回的短期 token。 |

## Telegram 绑定

Telegram Mini App 认证使用 Telegram initData。Telegram 账号仍需要用 hub access token 绑定后才能访问 hub。默认命名空间可使用基础 `CLI_API_TOKEN`，本地用户可使用个人 access token，高级命名空间可使用 `CLI_API_TOKEN:<namespace>`。

## 命名空间

本地邮箱在命名空间内唯一。普通私有部署中的浏览器登录会指向默认命名空间。高级命名空间主要用于 CLI/runner/Telegram token 后缀和完整团队隔离；见[命名空间](./namespace.md)。

## 旧用户名账号升级

替换 `hapi-server` 后启动，SQLite 和 MySQL 中已有的本地用户都会自动转换为 `<用户名>@hapi.local`。例如，`alice` 变为 `alice@hapi.local`，`admin` 变为 `admin@hapi.local`。使用新邮箱标识和原密码登录。每个旧用户名只追加一次后缀，包括原本已含 `@` 的用户名。这些本地地址不需要邮件服务器或邮箱验证。

用户 ID、密码、个人访问令牌、角色、停用状态、项目成员关系和会话归属均保留。邮箱查询不区分大小写，同一命名空间内唯一。用户可在 **设置 → 账户** 中改为实际邮箱；新建用户和修改邮箱时校验邮箱格式。

SQLite 自动升级到数据库版本 21，沿用自动备份，并写入 `schema_migrations` 迁移记录。MySQL 自动扩展标识字段长度，数据转换和迁移记录在同一事务中提交。重复启动不会再次追加后缀。若要回退旧版本，先停止 Hub，再恢复完整的升级前数据库备份；MySQL 请在升级前备份。

全新部署使用 `HAPI_ADMIN_EMAIL` 替代 `HAPI_ADMIN_USERNAME`。已有管理员会自动迁移，不会被该配置覆盖。API 客户端的本地登录、创建用户参数改为 `email`，修改邮箱使用 `PATCH /api/me/email`，本地账户响应字段也改为 `email`。
