# Storage Development Guide

This guide describes how storage code should be organized and reviewed.

## Storage domains

HAPI Nexus has two independent storage domains:

| Domain | Data | Supported backends |
| --- | --- | --- |
| Conversation store | messages, message epochs, message counters, queues, conversation metadata | SQLite, Elasticsearch |
| Core store | users, permissions, projects, machines, app settings, import jobs, push devices | SQLite, MySQL |

The selected backend is authoritative for its domain. Do not write to SQLite first and then mirror to Elasticsearch/MySQL for normal runtime traffic.

SQLite remains the default local backend and can be used as an explicit migration source or snapshot target when switching storage.

## Source layout

```text
hub/src/store/
  index.ts                         public barrel only
  store.ts                         Store facade and SQLite schema version
  storeFactories.ts                backend selection and adapter registration
  storeBackendRegistry.ts          registry for conversation/core backend factories
  storeRuntimeBuilder.ts           runtime wiring for selected backends
  storageConfig.ts                 parsed storage settings
  storageMigration.ts              background migration job orchestration
  ports/                           backend-neutral contracts
  sqlite/                          SQLite lifecycle, schema, runtime initialization
  mysql/                           MySQL schema and core adapters
  elasticsearch/                   Elasticsearch client, codec, queries, message adapter
  external/                        snapshot import/export and backend-to-backend sync helpers
  migrations/                      versioned SQLite migrations and tests
```

Backend-specific code should stay inside the matching backend directory. Root files should be facades, registry/bootstrap code, or domain stores shared by the default SQLite path.

## Interface rules

Prefer explicit interfaces over type assertions:

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

Backend implementations should conform to the same contract so route and sync code does not need backend-specific branches.

## Migration rules

- Migrations must be resumable.
- Migrations must be idempotent.
- Long-running migrations should run in the background.
- UI blocking should end after the initial usable data window is available.
- Restarted hubs should resume pending migration work from recorded state.
- Elasticsearch bulk writes should use bounded batches by document count and byte size.
- Data stream writes must include `@timestamp`.
- Do not bump `SCHEMA_VERSION` unless the persisted SQLite schema or stored JSON shape changes.

## Tests

Storage backends should share contract tests where practical. Add focused tests for:

- backend-neutral port behavior;
- direct runtime writes to the selected backend;
- migration/snapshot import/export;
- Elasticsearch data-stream and bulk-write behavior;
- MySQL schema setup and core-store behavior.
