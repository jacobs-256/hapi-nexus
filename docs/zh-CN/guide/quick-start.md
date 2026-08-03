# 快速开始

**语言：** [English](../../en/guide/quick-start.md) | 简体中文

## 安装 HAPI Nexus

本 fork 文档按“从源码构建并私有部署”的方式编写。后续如果你发布自己的包或 release，请把这里的命令更新为你的仓库或包命名空间。

```bash
bun install
bun run build:single-exe
```

为了兼容现有代码，构建后的 CLI 仍保留 `hapi` 命令名。在本仓库中可这样运行：

```bash
./cli/dist/hapi --help
```

其他安装和部署方式见：[安装](./installation.md)

## 启动 Hub

私有 LAN/VPN/反向代理部署：

```bash
HAPI_LISTEN_HOST=0.0.0.0 HAPI_PUBLIC_URL=http://<server-ip>:3006 ./cli/dist/hapi hub --no-relay
```

首次运行时，HAPI Nexus 会创建：

- 保存在 `~/.hapi/settings.json` 中的 CLI access token
- 用户名为 `admin`、密码为 `admin` 的本地 Web 管理员

`hapi server` 仍然作为别名保留。

终端会显示 Hub URL。

> 如果要从公网访问，请把 Hub 放在你自己的 VPN、反向代理或 tunnel 后面，并设置 `HAPI_PUBLIC_URL`。

## 启动 Runner

Runner 允许 Web 用户在授权目录中启动会话：

```bash
./cli/dist/hapi runner start --workspace-root /path/to/projects
```

如果需要多个允许访问的根目录，传入多个 `--workspace-root` 参数。

## 启动本地编程会话

```bash
./cli/dist/hapi
```

这会启动由 HAPI Nexus 包装的 Claude Code。会话会出现在 Web UI 中。

## 打开界面

打开终端中显示的 URL，或用手机扫描二维码。

使用 `admin` / `admin` 登录，然后进入 **Settings -> Account** 修改默认用户名和密码。

## 下一步

- [无缝切换](./how-it-works.md#无缝切换) - 在终端和手机之间切换控制权
- [Hub 设置](./installation.md#hub-设置) - 从任意位置访问 HAPI Nexus
- [账号与访问](./accounts.md) - 管理用户、密码和 access token
- [设置控制台](./settings.md) - 配置账号、用户、项目、机器和偏好
- [通知](./installation.md#telegram-设置) - 配置 Telegram 通知
- [安装应用](./pwa.md) - 将 HAPI Nexus 添加到主屏幕
- [许可证与归属](./license.md) - 了解 AGPL-3.0 义务和上游声明
