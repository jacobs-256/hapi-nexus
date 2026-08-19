# 快速开始

**语言：** [English](../../en/guide/quick-start.md) | 简体中文

## 安装 HAPI Nexus

本 fork 文档按“从源码构建并私有部署”的方式编写。后续如果你发布自己的包或 release，请把这里的命令更新为你的仓库或包命名空间。

```bash
bun install
bun run build:single-exe
```

构建产物会输出到 `cli/dist-exe/<bun-target>/`：`hapi-server` 用于 Hub/Web 服务器，`hapi` 用于 auth、runner 和本地 agent 会话。请选择匹配当前机器的路径：

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

其他安装和部署方式见：[安装](./installation.md)

## 启动 Hub

私有 LAN/VPN/反向代理部署：

```bash
HAPI_LISTEN_HOST=0.0.0.0 HAPI_PUBLIC_URL=http://<server-ip>:3006 "$HAPI_SERVER_BIN" hub --no-relay
```

`HAPI_LISTEN_HOST=0.0.0.0` 表示监听所有网卡。`HAPI_PUBLIC_URL` 必须是真实可被浏览器访问的 IP 或域名，不能写成 `0.0.0.0`。

首次运行时，HAPI Nexus 会创建：

- 保存在 `~/.hapi/settings.json` 中的 CLI access token
- 用户名为 `admin`、密码为 `admin` 的本地 Web 管理员

`server` 子命令仍然作为 `hub` 的别名保留。

终端会显示 Hub URL。

> 如果要从公网访问，请把 Hub 放在你自己的 VPN、反向代理或 tunnel 后面，并设置 `HAPI_PUBLIC_URL`。

## 启动 Runner

Runner 允许 Web 用户在授权目录中启动会话。多用户部署时，请使用 runner 所属用户在 **Settings -> Account** 中看到的个人 access token：

```bash
CLI_API_TOKEN="<personal-access-token>" "$HAPI_BIN" runner start --workspace-root /path/to/projects
```

如果需要多个允许访问的根目录，传入多个 `--workspace-root` 参数。

## 同步 Codex 目录历史

runner 在线后，在 Web UI 创建 Codex 会话，选择设备和工作目录，然后点击 **同步目录**。HAPI Nexus 会让 runner 读取该目录对应的本地 Codex transcript，把匹配的历史加入后台导入队列，并在任务完成后打开最新导入的会话。

导入后的 Codex 会话会在 HAPI metadata 中保留原始 `codexSessionId`。后续通过 Web 发送消息或在本地执行 `hapi resume <session-id>` 时，可以继续原 Codex thread，而不是从空会话开始。

## 启动本地编程会话

```bash
"$HAPI_BIN"
```

这会启动由 HAPI Nexus 包装的 Claude Code。会话会出现在 Web UI 中。

## 打开界面

打开终端中显示的 URL，或用手机扫描二维码。

使用 `admin` / `admin` 登录，然后进入 **Settings -> Account** 修改默认用户名和密码。

## 下一步

- [无缝切换](./how-it-works.md#无缝切换) - 在终端和手机之间切换控制权
- [Hub 设置](./installation.md#hub-设置) - 从任意位置访问 HAPI Nexus
- [Codex 目录历史同步](#同步-codex-目录历史) - 将已有 Codex CLI 历史带入 HAPI Nexus
- [账号与访问](./accounts.md) - 管理用户、密码和 access token
- [设置控制台](./settings.md) - 配置账号、用户、项目、机器和偏好
- [通知](./installation.md#telegram-设置) - 配置 Telegram 通知
- [安装应用](./pwa.md) - 将 HAPI Nexus 添加到主屏幕
- [许可证与归属](./license.md) - 了解 AGPL-3.0 义务和上游声明
