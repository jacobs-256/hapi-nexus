# HAPI Nexus

**语言：** [English](README.md) | 简体中文

面向企业私有部署的本地优先平台：在本地运行官方 Claude Code / Codex / Cursor Agent / Grok Build / OpenCode 会话，并通过 Web / PWA / Telegram Mini App 远程控制。

HAPI Nexus 是基于 HAPI 的独立二次开发版本。它保留 local-first agent 工作流，并增加面向团队的私有 Hub 能力：本地用户名/密码账号、管理员用户管理、每用户 access token、受限 runner 工作区、项目共享，以及企业控制台风格的 Web 界面。

为了兼容现有代码，CLI 命令仍然是 `hapi`。

## 安装客户端

macOS 可以通过 Homebrew 安装纯客户端 `hapi`：

```bash
brew install jacobs-256/hapi-nexus/hapi
hapi --version
```

这只会安装用于 auth、runner 和本地 agent 会话的客户端。它不包含 Hub/Web 服务器，也不会自动启动本地 Hub。如果需要运行私有服务器，请从 GitHub Releases 安装 `hapi-server`，或从源码构建。

## 功能特性

- **无缝切换** - 本地工作，需要时切到远程，随时再切回来。上下文不丢失，会话不重启。
- **原生优先** - HAPI 包装你的 AI agent，而不是替换它。仍然是同一个终端、同一种体验、同一套肌肉记忆。
- **离开电脑也不中断** - 离开工位时，也可以在手机上一键批准 AI 请求。
- **你的 AI，由你选择** - Claude Code、Codex、Cursor Agent、Grok Build、OpenCode，不同 agent，共用一套统一工作流。
- **随处使用终端** - 直接连接到工作机器，在手机或浏览器中运行命令。
- **语音控制** - 使用内置语音助手，免手操作你的 AI agent。
- **工作区浏览器** - 通过一个或多个 `hapi runner start --workspace-root <path>` 参数按需启用：在 Web 端浏览受限范围内的文件树，并在允许的子目录中启动会话。
- **Codex 目录历史同步** - 将某个工作目录下的全部 Codex CLI transcript 导入 HAPI Nexus，并可从最新导入会话继续 Web 或 `hapi resume` 工作流。
- **项目共享** - 创建项目、绑定 runner 工作区、邀请用户并共享会话，无需把源码复制到每台设备。
- **私有 Hub 账号** - 浏览器用户使用本地用户名/密码登录。管理员可以创建用户、分配角色、重置密码，并为每个用户签发 companion/CLI 使用的 access token。
- **可配置存储** - 对话历史支持 SQLite 或 Elasticsearch；其他 Hub 数据支持 SQLite 或 MySQL，可在设置中的存储页面选择，并支持切换时迁移数据。

## 快速开始

克隆本仓库后，安装依赖并构建服务器端和客户端二进制：

```bash
bun install
bun run build:single-exe
```

构建产物会输出到 `cli/dist-exe/<bun-target>/`：

- `hapi-server` - 服务器端二进制，用于运行 Hub 并提供内嵌 Web app
- `hapi` - 客户端二进制，用于 auth、runner 和本地 agent 会话

例如：

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
```

启动私有 Hub：

```bash
HAPI_LISTEN_HOST=0.0.0.0 HAPI_PUBLIC_URL=http://<server-ip>:3006 "$HAPI_SERVER_BIN" hub --no-relay
```

`HAPI_LISTEN_HOST=0.0.0.0` 表示监听所有网卡。`HAPI_PUBLIC_URL` 必须是真实可被浏览器访问的 IP 或域名，不能写 `0.0.0.0`。

登录 Web UI，打开 **Settings -> Account**，复制当前用户的个人 access token。使用这个 token 启动 runner，并指定一个或多个允许访问的工作区根目录：

```bash
CLI_API_TOKEN="<personal-access-token>" "$HAPI_BIN" runner start --workspace-root /path/to/projects
```

在浏览器打开 Hub URL。默认浏览器登录账号是 `admin` / `admin`；首次登录后请在 **Settings -> Account** 中修改。

部署方式见 [安装指南](docs/zh-CN/guide/installation.md)。

## 文档

- [快速开始](docs/zh-CN/guide/quick-start.md)
- [安装](docs/zh-CN/guide/installation.md)
- [App](docs/zh-CN/guide/pwa.md)
- [账号与访问](docs/zh-CN/guide/accounts.md)
- [设置控制台](docs/zh-CN/guide/settings.md)
- [Elasticsearch 对话存储模板](docs/zh-CN/storage/elasticsearch.md)
- [架构说明](docs/zh-CN/development/architecture.md)
- [存储开发指南](docs/zh-CN/development/storage.md)
- [项目与共享](docs/zh-CN/guide/projects.md)
- [工作原理](docs/zh-CN/guide/how-it-works.md)
- [许可证与归属](docs/zh-CN/guide/license.md)
- [Cursor Agent](docs/zh-CN/guide/cursor.md)
- [Grok Build](docs/zh-CN/guide/grok.md)
- [语音助手](docs/zh-CN/guide/voice-assistant.md)
- [为什么选择 HAPI Nexus](docs/zh-CN/guide/why-hapi.md)
- [FAQ](docs/zh-CN/guide/faq.md)
- [参与贡献](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [更新日志](CHANGELOG.md)

## 从源码构建

```bash
bun install
bun run build:single-exe
```

## 许可证与归属

HAPI Nexus 按 [GNU Affero General Public License v3.0](LICENSE) 发布。由于这是基于 AGPL 项目的修改版本，请保留许可证、保留上游声明，并向通过网络服务使用部署版本的用户提供对应源码。

上游归属和修改说明见 [NOTICE.md](NOTICE.md) 以及 [许可证与归属](docs/zh-CN/guide/license.md)。
