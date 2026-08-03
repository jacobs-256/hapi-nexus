# Grok Build

**语言：** [English](../../en/guide/grok.md) | 简体中文

HAPI 可以在本地运行官方 Grok Build CLI，并从 Web/PWA 远程控制同一个编程会话。

## 安装

使用官方安装器安装 Grok Build：

### macOS / Linux / WSL

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
```

### Windows PowerShell

```powershell
irm https://x.ai/cli/install.ps1 | iex
```

验证安装：

```bash
grok version
```

## 认证

HAPI 复用 Grok CLI 的本地认证。在无界面的 runner 机器上，先用设备码登录一次：

```bash
grok login --device-auth
```

也可以在 runner 环境中配置 xAI API key：

```bash
export XAI_API_KEY="xai-..."
```

不要把 API key 放进 HAPI 配置文件、日志或仓库。

## 启动会话

启动原生 Grok Build TUI：

```bash
hapi grok
```

使用显式启动参数：

```bash
hapi grok --model grok-4.5 --effort low --permission-mode default
```

由 HAPI runner 创建的会话会自动进入远程模式。从终端创建的会话会先进入原生 Grok TUI，并可在不解析终端输出的情况下切换到远程控制。

## 权限模式

首个集成版本中，HAPI 暴露一组保守模式：

- `default` - 工具请求会在 HAPI 中显示，等待批准或拒绝。
- `plan` - HAPI 要求 Grok 只做计划，并拒绝工具执行请求。
- `bypassPermissions` - 当前会话中的工具请求会被自动批准。

只应在可信 workspace 中使用 `bypassPermissions`。

## 恢复与切换

远程模式使用 Grok 的 ACP stdio agent（`grok agent stdio`）。HAPI 保存原生 Grok session ID，并用于：

- 重启后的 ACP `session/load`。
- 切回原生 TUI 时的 `grok --resume <session-id>`。
- 终端中的 `hapi resume <hapi-session-id>`。

对于新的本地会话，HAPI 会通过 `grok --session-id` 提供 UUID，因此无需抓取全屏 TUI 输出也能恢复会话。

## 模型与 effort 控制

创建页面会发现 Grok 的 ACP 模型目录，以及每个模型声明的 reasoning effort 选项。远程会话可以在轮次之间切换模型和 effort；HAPI 通过 ACP `session/set_model` 和 `session/set_mode` 应用这些设置。

HAPI 也暴露 Grok 的常用 slash commands，从 `.grok/skills`、`~/.grok/skills` 和共享 `.agents/skills` 发现技能，并在第一次正常提示后请求 Grok 设置简洁的 HAPI 会话标题。

## 当前限制

- OAuth/设备码登录必须在 HAPI Web UI 之外完成。
- Grok 订阅、额度和模型可用性由 xAI 控制。

如果远程会话报告认证失败，请在 runner 机器上运行 `grok login --device-auth` 后重试。
