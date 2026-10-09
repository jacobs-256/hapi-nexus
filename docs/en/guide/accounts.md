# Accounts and Access

**Language:** English | [简体中文](../../zh-CN/guide/accounts.md)

HAPI's browser UI uses local email/password accounts for private deployments. Access tokens still exist, but they are for CLI, runner, Telegram binding, and companion flows, not normal browser sign-in.

## Initial admin

On first hub start, HAPI creates a local administrator if no active local admin exists:

| Field | Default |
| --- | --- |
| Email | `admin@hapi.local` |
| Password | `admin` |

Change the default credentials immediately after first sign-in:

1. Open the Web UI.
2. Sign in with `admin@hapi.local` / `admin`.
3. Go to **Settings -> Account**.
4. Change the email and password.

For unattended deployments, set environment variables before the first hub start:

```bash
export HAPI_ADMIN_EMAIL="admin@hapi.local"
export HAPI_ADMIN_PASSWORD="change-this-password"
hapi-server hub
```

If a local admin already exists, these environment variables do not replace it.

## Browser login

Normal browser/PWA login accepts only:

- email
- password

The Web UI stores the returned short-lived web session token in the browser. It intentionally does not accept `?token=` links or saved `CLI_API_TOKEN` values for browser login.

## Account settings

Every local user can open **Settings -> Account** to:

- view profile, namespace, and role
- view and copy their personal access token
- regenerate their personal access token
- change their own email
- change their own password
- sign out of the browser

Emails are unique inside a namespace. Renaming to an existing email is rejected.

## User administration

Administrators can open **Settings -> Users** to:

- create local email/password users
- assign `user` or `admin` roles
- disable accounts
- reset local user passwords
- regenerate personal access tokens

The built-in hub owner identity is still backed by `CLI_API_TOKEN`; local admin accounts are the recommended way to administer the browser UI.

## What each credential is for

| Credential | Used by | Notes |
| --- | --- | --- |
| Email/password | Browser and PWA login | Default admin is `admin@hapi.local` / `admin` on first start. |
| Personal access token | Companion/CLI-style user access | Shown in **Settings -> Account** and regeneratable by the user. |
| `CLI_API_TOKEN` | CLI, runner, owner access, Telegram binding | Generated on first start and stored in `~/.hapi/settings.json` unless configured. |
| Web session JWT | Browser API/SSE calls | Short-lived token returned after email/password login. |

## Telegram binding

Telegram Mini App authentication uses Telegram initData. A Telegram account must still be bound with a hub access token before it can access the hub. Use the base `CLI_API_TOKEN` for the default namespace, a personal access token for a local user, or `CLI_API_TOKEN:<namespace>` for advanced namespace setups.

## Namespaces

Local emails are unique within a namespace. The browser login UI targets the default namespace for normal private deployments. Advanced namespace setups are mainly for CLI/runner/Telegram token suffixes and full team isolation; see [Namespace](./namespace.md).

## Upgrading username accounts

On startup after replacing `hapi-server`, existing local users are automatically converted to `<username>@hapi.local` in both SQLite and MySQL. For example, `alice` becomes `alice@hapi.local` and `admin` becomes `admin@hapi.local`. Sign in with the new email identifier and the existing password. Every old username receives the suffix exactly once, including usernames that already contained `@`. These local addresses do not require a mail server or email verification.

User IDs, passwords, personal access tokens, roles, disabled state, project membership and session ownership are preserved. Email lookup remains case-insensitive and unique within each namespace. Users can change the generated address to their actual email in **Settings → Account**. New users and email changes require a valid email address.

SQLite upgrades to schema version 21, creates the usual automatic backup, and records the migration in `schema_migrations`. MySQL widens identifier columns and records the data conversion transactionally in the same ledger. Repeated starts do not add another suffix. Before downgrading, stop the hub and restore the complete pre-upgrade database backup; for MySQL, take that backup before upgrading.

For a fresh deployment, use `HAPI_ADMIN_EMAIL` instead of `HAPI_ADMIN_USERNAME`. Existing admins are migrated automatically and are not replaced by this setting. API clients must send `email` for local login and user creation, and use `PATCH /api/me/email` for email changes; local account responses now expose `email`.
