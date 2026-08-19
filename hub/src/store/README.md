# Store Module Notes

This directory contains persistence adapters, backend selection, and storage migration logic for the hub.

## Domains

HAPI Nexus splits hub persistence into two independent domains:

- **Conversation storage**: session messages and message-related metadata.
  - SQLite implementation: root message stores (`messageStore.ts`, `messages.ts`) with SQLite helpers under `sqlite/`.
  - Elasticsearch implementation: `elasticsearch/messageStore.ts` plus focused helpers under `elasticsearch/`.
- **Core storage**: users, permissions, projects, machines, app settings, import jobs, push devices, and other non-message data.
  - SQLite implementation: root domain stores (`sessions.ts`, `machines.ts`, `users.ts`, `projects.ts`, etc.) with lifecycle/schema helpers under `sqlite/`.
  - MySQL implementation: `mysql/` adapters.

The configured backend is authoritative for its domain. When Elasticsearch is selected for conversations, runtime conversation writes go directly to Elasticsearch. When MySQL is selected for core data, runtime core writes go directly to MySQL.

SQLite may still be used as a migration source/snapshot target when the operator explicitly switches storage, but external runtime backends must not mirror every write back to SQLite.

## Ports and backend adapters

Storage-facing system logic should depend on ports, not concrete databases:

- `ports/conversationStore.ts` defines `ConversationStore` for message/session-history operations.
- `ports/coreStores.ts` defines the grouped core store ports returned by the store factory. Small stores (`appSettings`, `codexImportJobs`, `push`, `fcm`, `scratchlist`) and core domain stores (`sessions`, `machines`, `users`, `projects`) expose concrete port interfaces with `MaybePromise` return values so SQLite and MySQL can share the same contract.
- SQLite, Elasticsearch, and MySQL implementations adapt those ports behind `storeFactories.ts` and are registered through `storeBackendRegistry.ts`.

When adding a new backend:

1. Add or reuse a domain port; do not expose generic table CRUD to business logic.
2. Implement the port in a backend-specific adapter directory.
3. Register the adapter in the `StoreBackendRegistry` setup in `storeFactories.ts`.
4. Keep migration/snapshot logic separate from runtime writes.
5. Add focused tests around backend-specific semantics.

Future conversation backends, such as MySQL conversation storage, should implement `ConversationStore` and be selected by `createConversationStore` without changing `MessageService` or `SyncEngine` call sites.

## Store facade and runtime construction

- `index.ts` is a public barrel only.
- `store.ts` owns the `Store` facade and `SCHEMA_VERSION`. It exposes `coreStores` as the port-typed core store group; the legacy top-level fields (`store.sessions`, `store.users`, etc.) remain sync-compatible aliases for existing SQLite-heavy tests and older call sites. Prefer `coreStores` or injected ports for new runtime code.
- `storeRuntimeBuilder.ts` wires SQLite handles, direct backends, and store classes.
- `storeFactories.ts` registers backend adapters through `storeBackendRegistry.ts` and chooses concrete core/conversation stores based on storage config.
- `sqlite/` owns SQLite opening, initialization, current schema, migration ledger, and compatibility wiring for versioned steps under `migrations/`.
- `mysql/` owns MySQL schema setup and core-store adapters.
- `elasticsearch/` owns Elasticsearch conversation-store helpers.
- `external/` keeps external migration/snapshot/sync concerns outside the runtime facade (`storageSync.ts`, `initializer.ts`, `snapshotExporter.ts`, `syncFactory.ts`).
- `migrations/` owns versioned SQLite migration steps and focused migration tests.

## Elasticsearch conversation store layout

`elasticsearch/messageStore.ts` should stay a thin `MessageStoreLike` facade. Put implementation details in sibling `elasticsearch/` helpers:

```text
elasticsearch/
  messageStore.ts        # ConversationStore adapter facade
  client.ts              # fetch client, auth headers, index setup, bulk request error handling
  writer.ts              # append-only bulk writes; data-stream-compatible create ops
  reader.ts              # latest-row materialization from append-only documents
  codec.ts               # StoredMessage <-> ES row conversion, positions, limits, row keys
  queries.ts             # reusable ES bool/range query builders
  messageBuilder.ts      # add/copy message construction and localId collision handling
  messageReadWindows.ts  # async seq/position window pagination helpers
  messageQueue.ts        # queued/invoked/scheduled message filters and write ops
  messageLifecycle.ts    # merge/delete planning and lifecycle write ops
  sequenceLock.ts        # per-session async sequence reservation lock
  constants.ts           # bulk/search/timeouts
  types.ts               # ES document/table/operation types
```

Rules for Elasticsearch helpers:

- Writes are append-only ES documents; use `writer.ts` rather than direct fetch calls.
- Data stream writes must include `@timestamp` and use bulk `create` semantics.
- Keep bulk batches bounded by both document count and byte size.
- Avoid synchronous ES reads/writes on web-login or session-list paths; use async APIs.
- Put query shape changes in `queries.ts`; put pagination/window changes in `messageReadWindows.ts`.
- Keep `elasticsearch/messageStore.ts` focused on satisfying `MessageStoreLike`.

## Migration rules

- Keep runtime store paths separate from migration paths.
- Migrations must be idempotent and resumable.
- Background migrations must expose status through web APIs.
- UI blocking should end after the initial usable data window is available; the backend can continue migrating older data.
- Elasticsearch data stream writes must include `@timestamp`.
- Bulk write sizes must stay bounded.
- Do not bump `SCHEMA_VERSION` unless persisted SQLite schema or stored JSON shape changes.

## Source layout

```text
store/
  index.ts               # public barrel only
  store.ts               # Store facade and schema version
  storeFactories.ts      # runtime store construction for SQLite/MySQL/Elasticsearch
  storeBackendRegistry.ts# backend adapter registry
  storeRuntimeBuilder.ts # SQLite handles + selected runtime stores
  storageConfig.ts       # parsed storage settings
  storageMigration.ts    # background migration orchestration
  ports/                 # backend-neutral contracts
  sqlite/                # SQLite file/open/schema/runtime initialization helpers
  mysql/                 # runtime MySQL core-store adapters
  elasticsearch/         # runtime Elasticsearch message-store helpers
  external/              # external storage sync and snapshot helpers
  migrations/            # versioned SQLite migration steps and tests
```

Avoid adding unrelated responsibilities to root files. Put backend-specific code under the matching backend directory and migration/snapshot code under `external/` or `migrations/`.
