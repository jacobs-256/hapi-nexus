# 存储开发指南

本文说明存储代码的组织和评审规则。

## 存储领域

HAPI Nexus 有两个独立存储领域：

| 领域 | 数据 | 支持后端 |
| --- | --- | --- |
| 对话存储 | messages、message epochs、message counters、队列、对话元数据 | SQLite、Elasticsearch |
| 核心数据存储 | 用户、权限、项目、机器、应用设置、导入任务、推送设备 | SQLite、MySQL |

所选择的后端就是该领域的权威运行时数据库。正常运行时流量不要先写 SQLite 再异步镜像到 Elasticsearch/MySQL。

SQLite 仍然是默认本地后端，也可在显式切换存储时作为迁移来源或快照目标。

## 源码结构

```text
hub/src/store/
  index.ts                         仅作为 public barrel
  store.ts                         Store facade 和 SQLite schema version
  storeFactories.ts                后端选择和 adapter 注册
  storeBackendRegistry.ts          conversation/core backend factory registry
  storeRuntimeBuilder.ts           按所选后端组装运行时 store
  storageConfig.ts                 解析后的存储设置
  storageMigration.ts              后台迁移任务编排
  ports/                           后端无关接口
  sqlite/                          SQLite 生命周期、schema、运行时初始化
  mysql/                           MySQL schema 和 core adapter
  elasticsearch/                   Elasticsearch client、codec、queries、message adapter
  external/                        快照导入导出和后端之间同步 helper
  migrations/                      版本化 SQLite migration 和测试
```

后端相关代码应放在对应后端目录。根目录文件应仅保留 facade、registry/bootstrap 或默认 SQLite 路径共享的领域 store。

## 接口规则

优先使用明确接口，避免类型断言：

```ts
interface ConversationStore {
    addMessage(...): void | Promise<void>
    getMessages(...): Message[] | Promise<Message[]>
}

interface CoreStores {
    users: UserStore
    projects: ProjectStore
    machines: MachineStore
}
```

各后端实现同一份契约，route 和 sync 代码不应出现后端分支。

## 迁移规则

- 迁移必须可恢复。
- 迁移必须幂等。
- 长时间迁移应放到后台执行。
- 前端遮罩应在初始可用数据窗口准备好后结束。
- Hub 重启后应根据记录状态恢复未完成迁移。
- Elasticsearch bulk 写入必须按文档数量和字节大小限制批次。
- Data stream 写入必须包含 `@timestamp`。
- 只有持久化 SQLite schema 或已存 JSON 形状变化时才 bump `SCHEMA_VERSION`。

## 测试

存储后端应尽量复用 contract tests，并补充重点测试：

- 后端无关 port 行为；
- 所选后端的直接运行时写入；
- 迁移、快照导入导出；
- Elasticsearch data stream 和 bulk 写入行为；
- MySQL schema setup 和 core store 行为。
