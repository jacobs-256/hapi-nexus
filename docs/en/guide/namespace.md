# Namespace (Advanced)

**Language:** English | [简体中文](../../zh-CN/guide/namespace.md)

Namespaces are intended for isolating separate teams on a single public HAPI hub. They are not the normal way to create users inside one team.

This is not a default setup path for most users.

For collaboration inside one namespace, use [Projects and Sharing](./projects.md). Projects share sessions and runner workspaces between users; namespaces keep different teams fully isolated from each other.

## How it works

- The hub uses a single base `CLI_API_TOKEN`.
- CLI, runner, API, and Telegram-binding clients append `:<namespace>` to the token for isolation.
- Local username/password users are unique inside their namespace; normal browser login targets the default namespace.
- Project invites are valid only inside the namespace where they were created.

## Setup

1. On the hub, configure only the base token:

```
CLI_API_TOKEN="your-base-token"
```

2. For each isolated team, append a namespace in the CLI/runner/Telegram-binding token:

```
CLI_API_TOKEN="your-base-token:team-a"
```

3. Start that team's runner with the same token suffix.
4. For browser users in the default private-deployment flow, create local accounts in **Settings -> Users** instead of giving users the base token.

## Limitations and gotchas

- Hub-side `CLI_API_TOKEN` must not include `:<namespace>`. If it does, the hub will strip the suffix and log a warning.
- Namespaces are isolated: sessions, machines, and users are not visible across namespaces.
- One machine ID cannot be reused across namespaces.
  - To run multiple namespaces on one machine, use a separate `HAPI_HOME` per namespace, or clear the machine ID with `hapi auth logout` before switching.
- Remote spawn is namespace-scoped. If you need remote spawning for multiple namespaces on the same machine, run a separate runner per namespace (use separate `HAPI_HOME`).
