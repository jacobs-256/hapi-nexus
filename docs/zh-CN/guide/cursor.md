# Cursor Agent

**语言：** [English](../../en/guide/cursor.md) | 简体中文

HAPI 支持 [Cursor Agent CLI](https://cursor.com/docs/cli/using)，可以运行 Cursor 的 AI 编程代理，并通过 Web 和手机远程控制。

## 前置条件

安装 Cursor Agent CLI：

- **macOS/Linux:** `curl https://cursor.com/install -fsS | bash`
- **Windows:** `irm 'https://cursor.com/install?win32=true' | iex`

验证安装：

```bash
agent --version
```

## 使用方式

```bash
hapi cursor                    # 启动 Cursor Agent 会话
hapi cursor resume <chatId>    # 恢复指定聊天
hapi cursor --continue         # 恢复最近的聊天
hapi cursor --mode plan        # 以 Plan 模式启动
hapi cursor --mode ask         # 以 Ask 模式启动
hapi cursor --auto-review      # 使用 Auto-review (Smart Auto) 启动
hapi cursor --yolo             # 绕过审批提示（--force）
hapi cursor --model <model>    # 指定模型
hapi cursor --cursor-worktree feature-x   # Cursor 原生 worktree
hapi cursor --cursor-add-dir ../shared    # 额外 workspace root（可重复）
```

## 权限模式

| 模式 | 说明 |
|------|------|
| `default` | 标准 agent 行为 |
| `plan` | Plan 模式 - 先设计方案再编码 |
| `ask` | Ask 模式 - 只探索代码，不编辑 |
| `debug` | Debug 模式 - 假设 + 插桩 |
| `autoReview` | Auto-review (Smart Auto) - 使用 allowlist/sandbox/classifier，而不是完整 YOLO |
| `yolo` | 绕过审批提示 |

可以通过 `--mode` / `--permission-mode` / `--auto-review` 设置模式，也可以在会话中通过 Web UI 修改。

## Cursor 原生 worktree 与 multi-root

- New Session 中 Cursor 的 **Worktree** 使用 Cursor 的 `--worktree`（`~/.cursor/worktrees/<repo>/<name>`），不是 HAPI 的同级目录 worktree。
- 会话中可以发送 `/worktree`、`/apply-worktree`、`/delete-worktree` 或 `/add-dir <path>`（隔离透传）。
- CLI 示例：`hapi cursor --cursor-worktree feature-x --cursor-add-dir ../shared`

## Slash 命令透传（远程）

这些命令会在队列中隔离，并转发给 agent（ACP prompt 或旧版 `-p`）：

`/compress` `/summarize` `/compact` `/model` `/multitask` `/best-of-n` `/worktree` `/apply-worktree` `/delete-worktree` `/add-dir` `/context` `/fork` `/auto-review`

仅交互式 TUI 支持的命令（`/config`、`/mcp`、`/sandbox`、`/btw`、`/rewind` 等）不支持远程使用。

## 模式

- **本地模式** - 从终端运行 `hapi cursor`，获得完整交互体验。
- **远程模式** - 在没有终端时从 Web/手机启动。新的 Cursor 会话使用 `agent acp`，并获得 HAPI 权限审批、计划/问题 UI 和更丰富的工具更新。ACP 迁移前创建的旧会话暂时仍可通过旧的 `agent -p` stream-json 路径恢复。

## 限制

- **Multitask UI** - `/multitask` 通过 slash 命令驱动；HAPI 尚未提供 Agents Window 风格的 fleet 面板。当 agent 发出 subagent `cursor/task` 通知时，会显示为 CursorTask 卡片。
- **旧会话** - ACP 迁移前创建的 Cursor 会话暂时仍可通过 stream-json 恢复。启动新的 Cursor 会话可获得 ACP 权限、计划、todos 和问题支持。
- **会话恢复** - ACP 会话通过 `session/load` 恢复。旧 stream-json `session_id` 不能通过 ACP 加载；这些会话会继续使用旧路径，直到你新建会话。

### 旧版 stream-json 安全性：AskQuestion 行为

新的 cursor 远程会话通过 ACP 运行，ACP 会用双向 `cursor/ask_question` 扩展方法处理 `AskQuestion`，不受下述问题影响。这里的拦截只适用于通过旧版 `agent -p` stream-json launcher 恢复的旧会话。

当 cursor-agent 以 `--print --output-format stream-json` 运行时，由于没有 IDE 界面渲染问题，Cursor Agent CLI 会为 `AskQuestion` 工具返回合成响应：`Questions skipped by the user, continue with the information you already have`。底层模型可能把它理解为真实用户授权并继续执行。

HAPI 的旧版事件转换器会拦截这个合成响应，并把它改写成显式 `no_input_surface` 错误（`status: failed`），这样下游消费者（Web UI、Telegram、日志阅读器）会把伪造授权显示为错误，而不是静默透传。拦截会扫描原始 `tool_call` payload 中的固定标记文本，并限定在 `AskQuestion` 形态（以及转换器 fallback 的 `name=unknown`）调用上；正常读/写/函数工具不受影响。

随着旧会话逐步消失，这个拦截会自然退出；恢复 ACP 前旧会话是唯一仍会触发该代码的路径。

跟踪 issue：[tiann/hapi#784](https://github.com/tiann/hapi/issues/784)。

## 集成

运行后，Cursor 会话会出现在 HAPI Web 应用和 Telegram Mini App 中。你可以：

- 监控会话活动
- 从手机批准权限
- 在本地模式中发送消息（消息会排队，等你切换时发送）

## 相关

- [Cursor CLI Documentation](https://cursor.com/docs/cli/using)
- [工作原理](./how-it-works.md) - 架构与数据流
