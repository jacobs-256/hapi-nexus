# Mermaid lightbox dogfood（Playwright）

**语言：** [English](../../en/tooling/mermaid-lightbox-dogfood.md) | 简体中文

两个 Playwright 目标：

| 目标 | 覆盖内容 | 命令 |
|--------|-------------------|---------|
| **Component (Vite)** | 在 dev server 中隔离测试 `MermaidDiagram` | `npm run test:mermaid-lightbox:playwright` |
| **Live session (hub)** | 真实聊天线程，点击放大 | `npm run test:mermaid-lightbox:live` |

## Live session（接近生产形态）

**Session URL（seed 后）：**

`{HAPI_URL}/sessions/a7370000-0000-4000-8000-000000000737`

Live 测试默认 `HAPI_URL`：`http://127.0.0.1:3006`（日常 driver）。  
Tailnet 示例：`HAPI_URL=https://hapi.tail9944ee.ts.net`（先 seed **那个** hub 的 DB）。

### 1. Seed fixtures（hub DB）

在拥有 `HAPI_DB_PATH` 的机器上执行（通常是 `~/.hapi/hapi.db`）：

```bash
bun run seed:mermaid-lightbox:session
```

插入 15 条 assistant 消息（每种图类型一条）。重复运行会替换该会话中的消息。

### 2. 用当前分支部署 Web

```bash
hapi-driver-rebuild --build-web
# activate soup when ready (restarts hub)
```

Web 改动后请 hard-refresh 浏览器。

### 3. 运行 live Playwright

```bash
HAPI_LIVE=1 HAPI_URL=http://127.0.0.1:3006 npm run test:mermaid-lightbox:live
```

需要一个 `/api/auth` 接受的 access token：默认读取 `~/.hapi/settings.json` 的 `cliApiToken`，也可以将 `HAPI_ACCESS_TOKEN` 设置为目标 hub 的 CLI/个人 access token。

**通过标准：** dialog 打开；SVG 位于 **shadow root**（`[data-mermaid-lightbox]`）；lightbox 比 inline 更大；sequence 图有多个 actors/lines。

如果测试报告 `legacy` 或 `empty` lightbox，说明当前服务的 Web bundle 早于 shadow-DOM 修复，请重新构建 driver。

## 隔离页面（不是聊天）

只用于组件回归测试；**不是**聊天页面：

`http://127.0.0.1:5173/mermaid-lightbox-e2e.html?case=sequence`（Vite dev；tailnet dist 中不可用，除非你把 HTML 加入构建）

图源文件：`web/src/dev/mermaid-lightbox-cases.ts`
