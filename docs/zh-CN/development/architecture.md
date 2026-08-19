# 架构说明

HAPI Nexus 主要包含三个运行端：

- **CLI**：封装本地 agent 进程，负责本地终端和工具执行，并连接到 hub。
- **Hub**：提供 HTTP API、Socket.IO、SSE、认证、存储、通知和后台任务。
- **Web**：React PWA，通过 REST API 控制会话，并通过 SSE 接收实时更新。

## 运行链路

```text
Agent 进程 -> CLI -> Socket.IO -> Hub -> 存储
                                      |
                                      +-> SSE -> Web

Web -> REST API -> Hub -> RPC -> CLI -> Agent 进程
```

CLI 是可信的本地执行端。Hub 负责共享状态持久化和远程操作路由。Web 不应该直接依赖本机状态。

## 包边界

```text
cli/      本地 agent 封装、runner 守护进程、CLI 命令
hub/      服务端 API、socket handler、同步引擎、存储
web/      React PWA、路由、UI、API client
shared/   共享类型、schema、socket contract
docs/     用户和开发文档
```

规则：

- 跨包共享的协议和类型放到 `shared`。
- 服务端存储和迁移逻辑放到 `hub`。
- 浏览器专用逻辑放到 `web`。
- agent 进程、本地文件系统和终端控制放到 `cli`。

## Hub 结构

重要目录：

```text
hub/src/web/routes/       REST route handler
hub/src/socket/           Socket.IO 设置和 CLI handler
hub/src/sync/             会话缓存、消息服务、RPC 网关
hub/src/store/            存储后端和迁移逻辑
hub/src/config/           设置和启动配置
hub/src/sse/              SSE 事件分发
```

建议方向：

- Route 文件保持轻量，将业务逻辑下沉到 `sync/` 或 service 模块。
- Store 文件暴露后端无关接口。
- 迁移逻辑和运行时读写路径分离。
- 后台任务需要可恢复，并通过 API 暴露状态。

## 存储模型

HAPI Nexus 将存储拆成两个领域：

- **对话存储**：会话消息和相关对话元数据。后端：SQLite 或 Elasticsearch。
- **核心数据存储**：用户、权限、项目、机器、设置和其他非消息数据。后端：SQLite 或 MySQL。

当选择 Elasticsearch 或 MySQL 时，它就是对应领域的直接运行时数据库。SQLite 不再作为该领域的先写入中转库。

## 实时模型

- CLI 到 Hub：Socket.IO。
- Web 实时更新：`/api/events` SSE。
- 用户操作：Web 调用 Hub REST API，需要本地执行时再由 Hub RPC 到 CLI。

## 测试要求

合并前执行：

```bash
bun typecheck
bun run test
```

存储相关修改应重点覆盖：

- 运行时后端行为；
- 数据迁移行为；
- 长任务重启恢复；
- 不重复导入或重复写入。
