# Accounts and Access

**Language:** English | [简体中文](../../zh-CN/guide/accounts.md)

HAPI's browser UI uses local username/password accounts for private deployments. Access tokens still exist, but they are for CLI, runner, Telegram binding, and companion flows, not normal browser sign-in.

## Initial admin

On first hub start, HAPI creates a local administrator if no active local admin exists:

| Field | Default |
| --- | --- |
| Username | `admin` |
| Password | `admin` |

Change the default credentials immediately after first sign-in:

1. Open the Web UI.
2. Sign in with `admin` / `admin`.
3. Go to **Settings -> Account**.
4. Change the username and password.

For unattended deployments, set environment variables before the first hub start:

```bash
export HAPI_ADMIN_USERNAME="admin"
export HAPI_ADMIN_PASSWORD="change-this-password"
hapi hub
```

If a local admin already exists, these environment variables do not replace it.

## Browser login

Normal browser/PWA login accepts only:

- username
- password

The Web UI stores the returned short-lived web session token in the browser. It intentionally does not accept `?token=` links or saved `CLI_API_TOKEN` values for browser login.

## Account settings

Every local user can open **Settings -> Account** to:

- view profile, namespace, and role
- view and copy their personal access token
- regenerate their personal access token
- change their own username
- change their own password
- sign out of the browser

Usernames are unique inside a namespace. Renaming to an existing username is rejected.

## User administration

Administrators can open **Settings -> Users** to:

- create local username/password users
- assign `user` or `admin` roles
- disable accounts
- reset local user passwords
- regenerate personal access tokens

The built-in hub owner identity is still backed by `CLI_API_TOKEN`; local admin accounts are the recommended way to administer the browser UI.

## What each credential is for

| Credential | Used by | Notes |
| --- | --- | --- |
| Username/password | Browser and PWA login | Default admin is `admin` / `admin` on first start. |
| Personal access token | Companion/CLI-style user access | Shown in **Settings -> Account** and regeneratable by the user. |
| `CLI_API_TOKEN` | CLI, runner, owner access, Telegram binding | Generated on first start and stored in `~/.hapi/settings.json` unless configured. |
| Web session JWT | Browser API/SSE calls | Short-lived token returned after username/password login. |

## Telegram binding

Telegram Mini App authentication uses Telegram initData. A Telegram account must still be bound with a hub access token before it can access the hub. Use the base `CLI_API_TOKEN` for the default namespace, a personal access token for a local user, or `CLI_API_TOKEN:<namespace>` for advanced namespace setups.

## Namespaces

Local usernames are unique within a namespace. The browser login UI targets the default namespace for normal private deployments. Advanced namespace setups are mainly for CLI/runner/Telegram token suffixes and full team isolation; see [Namespace](./namespace.md).
