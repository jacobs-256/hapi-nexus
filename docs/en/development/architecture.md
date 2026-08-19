# Architecture

HAPI Nexus has three main runtime surfaces:

- **CLI**: wraps local agent processes, owns local terminal/tool execution, and connects to the hub.
- **Hub**: provides HTTP APIs, Socket.IO endpoints, SSE events, authentication, persistence, notifications, and background jobs.
- **Web**: a React PWA that controls sessions through hub REST APIs and receives live updates through SSE.

## Runtime flow

```text
Agent process -> CLI -> Socket.IO -> Hub -> store
                                      |
                                      +-> SSE -> Web

Web -> REST API -> Hub -> RPC -> CLI -> Agent process
```

The CLI remains the trusted local executor. The hub persists shared state and routes remote actions. The web app should not directly depend on local machine state.

## Package boundaries

```text
cli/      local agent wrappers, runner daemon, CLI commands
hub/      server API, socket handlers, sync engine, storage
web/      React PWA, routes, UI, API client
shared/   shared types, schemas, socket contracts
docs/     user and developer documentation
```

Rules:

- Put cross-package contracts in `shared`.
- Keep server-only storage and migration code in `hub`.
- Keep browser-only code in `web`.
- Keep agent process and local filesystem control in `cli`.

## Hub structure

Important hub folders:

```text
hub/src/web/routes/       REST route handlers
hub/src/socket/           Socket.IO setup and CLI handlers
hub/src/sync/             session cache, message service, RPC gateway
hub/src/store/            persistence backends and migrations
hub/src/config/           settings and startup configuration
hub/src/sse/              server-sent event fan-out
```

Recommended direction:

- Route files should stay thin and delegate business logic to `sync/` or service modules.
- Storage files should expose backend-neutral interfaces.
- Migration code should be separate from runtime read/write paths.
- Background jobs should be resumable and observable through API status endpoints.

## Storage model

HAPI Nexus separates storage into two domains:

- **Conversation store**: session messages and related conversation metadata. Backends: SQLite or Elasticsearch.
- **Core store**: users, permissions, projects, machines, settings, and other non-message data. Backends: SQLite or MySQL.

When Elasticsearch or MySQL is selected, it is the active runtime database for that domain. SQLite is not used as a mirror-first staging database for that same domain.

## Realtime model

- CLI to hub: Socket.IO.
- Web live updates: SSE from `/api/events`.
- User actions: REST API to hub, then RPC to the connected CLI when local execution is required.

## Testing expectations

Before merging:

```bash
bun typecheck
bun run test
```

Storage changes should include focused tests for:

- runtime backend behavior;
- migration behavior;
- restart/resume behavior for long-running jobs;
- no duplicate imports or writes.
