# 快速开始

**语言：** [English](../../en/guide/quick-start.md) | 简体中文

<Steps>

## 安装 HAPI

::: code-group

```bash [npm]
npm install -g @twsxtd/hapi --registry=https://registry.npmjs.org
```

```bash [Homebrew]
brew install tiann/tap/hapi
```

```bash [npx（一次性运行）]
npx @twsxtd/hapi
```

:::

> 建议使用官方 npm registry 全局安装。一些镜像可能无法及时同步平台相关包。

其他安装方式见：[安装](./installation.md)

## 启动 Hub

```bash
hapi hub --relay
```

首次运行时，HAPI 会创建：

- 保存在 `~/.hapi/settings.json` 中的 CLI access token
- 用户名为 `admin`、密码为 `admin` 的本地 Web 管理员

`hapi server` 仍然作为别名保留。

终端会显示用于远程访问的 URL 和二维码。

> 通过 WireGuard + TLS 端到端加密。

## 启动编程会话

```bash
hapi
```

这会启动由 HAPI 包装的 Claude Code。会话会出现在 Web UI 中。

## 打开界面

打开终端中显示的 URL，或用手机扫描二维码。

使用 `admin` / `admin` 登录，然后进入 **Settings -> Account** 修改默认用户名和密码。

</Steps>

## 下一步

- [无缝切换](./how-it-works.md#无缝切换) - 在终端和手机之间切换控制权
- [Hub 设置](./installation.md#hub-设置) - 从任意位置访问 HAPI
- [账号与访问](./accounts.md) - 管理用户、密码和 access token
- [设置控制台](./settings.md) - 配置账号、用户、项目、机器和偏好
- [通知](./installation.md#telegram-设置) - 配置 Telegram 通知
- [安装应用](./pwa.md) - 将 HAPI 添加到主屏幕
