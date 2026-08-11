# 账号与访问

**语言：** [English](../../en/guide/accounts.md) | 简体中文

HAPI 的浏览器界面在私有部署中使用本地用户名和密码账号。Access token 仍然存在，但它们用于 CLI、runner、Telegram 绑定和伴侣客户端流程，不用于普通浏览器登录。

## 初始管理员

Hub 首次启动时，如果不存在启用状态的本地管理员，HAPI 会创建一个本地管理员：

| 字段 | 默认值 |
| --- | --- |
| 用户名 | `admin` |
| 密码 | `admin` |

首次登录后请立即修改默认凭据：

1. 打开 Web UI。
2. 使用 `admin` / `admin` 登录。
3. 进入 **Settings -> Account**。
4. 修改用户名和密码。

无人值守部署时，可以在第一次启动 hub 前设置环境变量：

```bash
export HAPI_ADMIN_USERNAME="admin"
export HAPI_ADMIN_PASSWORD="change-this-password"
hapi-server hub
```

如果本地管理员已经存在，这些环境变量不会覆盖现有账号。

## 浏览器登录

普通浏览器/PWA 登录只接受：

- 用户名
- 密码

Web UI 会在浏览器中保存登录后返回的短期 Web session token。它会刻意忽略 `?token=` 链接和已保存的 `CLI_API_TOKEN` 值，不会把它们作为浏览器登录凭据。

## 账号设置

每个本地用户都可以打开 **Settings -> Account**：

- 查看个人资料、命名空间和角色
- 查看并复制个人 access token
- 重新生成个人 access token
- 修改自己的用户名
- 修改自己的密码
- 退出浏览器登录

用户名在同一个命名空间内必须唯一。改名为已有用户名会被拒绝。

## 用户管理

管理员可以打开 **Settings -> Users**：

- 创建本地用户名/密码用户
- 分配 `user` 或 `admin` 角色
- 禁用账号
- 重置本地用户密码
- 重新生成个人 access token

内置 hub owner 身份仍由 `CLI_API_TOKEN` 支撑；本地管理员账号是管理浏览器 UI 的推荐方式。

## 各类凭据的用途

| 凭据 | 使用方 | 说明 |
| --- | --- | --- |
| 用户名/密码 | 浏览器和 PWA 登录 | 首次启动的默认管理员是 `admin` / `admin`。 |
| 个人 access token | 伴侣客户端/CLI 风格的用户访问 | 在 **Settings -> Account** 中显示，用户可以重新生成。 |
| `CLI_API_TOKEN` | CLI、runner、owner 访问、Telegram 绑定 | 首次启动时生成，并保存到 `~/.hapi/settings.json`，除非显式配置。 |
| Web session JWT | 浏览器 API/SSE 调用 | 用户名/密码登录后返回的短期 token。 |

## Telegram 绑定

Telegram Mini App 认证使用 Telegram initData。Telegram 账号仍需要用 hub access token 绑定后才能访问 hub。默认命名空间可使用基础 `CLI_API_TOKEN`，本地用户可使用个人 access token，高级命名空间可使用 `CLI_API_TOKEN:<namespace>`。

## 命名空间

本地用户名在命名空间内唯一。普通私有部署中的浏览器登录会指向默认命名空间。高级命名空间主要用于 CLI/runner/Telegram token 后缀和完整团队隔离；见[命名空间](./namespace.md)。
