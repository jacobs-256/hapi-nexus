# Projects and Sharing

**Language:** English | [简体中文](../../zh-CN/guide/projects.md)

Projects are the sharing boundary inside one HAPI namespace. A namespace still isolates teams from each other; projects decide which users inside that namespace can see sessions and use shared workspace roots.

## Concepts

- **User** - A local username/password account created in the hub. Telegram users become separate users after binding.
- **Project** - A named container for sessions, members, invites, and shared workspaces.
- **Workspace** - A machine + root path attached to a project. Shared users can browse and spawn only inside attached workspaces.
- **Machine owner** - The user who registered the runner machine. Only the owner can attach that machine's workspace roots to a project.

## Runner Workspace Roots

`--workspace-root` is an allow-list on the machine that runs the runner. It should point to a directory that already exists on that machine and contains projects you want HAPI to browse or spawn from.

Use one runner per namespace/machine, with repeated roots when needed:

```bash
hapi runner start \
  --workspace-root /Users/alice/src \
  --workspace-root /Volumes/work
```

You do not need to run multiple runners for multiple directories in the same namespace. Run separate runners only when you need separate namespaces or separate machines.

Remote users do not need the source code on their own computers. The runner machine needs the source and agent CLIs; remote users control sessions through the hub.

## Create and Share a Project

1. Start the hub.
   - First login defaults to `admin` / `admin`; change it in **Settings -> Account**.
   - Admins can create more users in **Settings -> Users**.
2. Start a runner on the machine that has the source code:

```bash
hapi runner start --workspace-root /path/to/projects
```

3. Open the web app and go to **Settings -> Projects**.
4. Create a project and optionally attach an initial workspace under one of the runner roots.
5. Create an invite link for `viewer`, `editor`, `admin`, or `owner`.
6. Send the invite link to a user who can log in to the same hub/namespace.

Invite links are reusable until they expire. Accepting the same invite again is idempotent and does not downgrade an existing higher role.

## Roles

| Role | Access |
| --- | --- |
| `viewer` | View project sessions and browse shared workspaces. |
| `editor` | Viewer access plus send messages, resume/reopen sessions, and spawn sessions inside project workspaces. |
| `admin` | Editor access plus manage project members, workspaces, and invites. |
| `owner` | Admin access plus grant/change/remove owner roles. Every project must keep at least one owner. |

## Access Rules

- Users see only projects where they are members.
- Users see only sessions assigned to projects they can access.
- Machine owners can use their full runner workspace roots.
- Shared users see a machine only when a project workspace grants access, and the machine metadata is masked to those shared roots.
- Creating project workspaces requires ownership of the target machine.
- Spawning on a shared machine requires `editor` or higher and a directory inside a project workspace.
- Direct member changes by user ID require an already-bound user in the same namespace. Invite links are the recommended way to add new users.

## Namespace Boundary

Projects do not cross namespaces. Users, machines, sessions, and project invites are scoped to the namespace where they were created. Normal private deployments use the default namespace; advanced CLI/runner/Telegram setups can use `CLI_API_TOKEN:<namespace>` for isolation.
