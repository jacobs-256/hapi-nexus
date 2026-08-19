# Settings Console

**Language:** English | [简体中文](../../zh-CN/guide/settings.md)

The Web settings area is designed as a private-deployment administration console. It keeps personal preferences, account security, user management, project sharing, and machine controls in one place.

## Layout

- Desktop uses a master-detail layout: the left navigation lists settings categories and the right panel shows the selected page.
- Mobile uses a focused page layout with a top back button and one settings category at a time.
- The top application title bar and bottom status bar remain part of the main app shell; settings pages only replace the inner content area.

## Account

Open **Settings -> Account** to manage the signed-in user:

- view profile, username, role, namespace, and personal access token
- copy or regenerate the personal access token
- change username
- change password
- sign out

Only local username/password users can change their own username and password. Usernames must be unique inside the namespace.

## Users

Open **Settings -> Users** as an administrator to manage local accounts:

- create username/password users
- set display names
- assign `user` or `admin` roles
- disable or re-enable accounts
- reset passwords
- regenerate personal access tokens

The first local administrator is created on first hub start with username `admin` and password `admin` unless `HAPI_ADMIN_USERNAME` and `HAPI_ADMIN_PASSWORD` are set before bootstrap. Change the default credentials immediately from **Settings -> Account**.

## Projects

Open **Settings -> Projects** to manage collaboration boundaries:

- create or rename projects
- attach runner workspaces owned by your machines
- add members by user ID
- create invite links
- remove members or workspaces

Project roles are `viewer`, `editor`, `admin`, and `owner`. Shared users can only see sessions and workspaces granted through projects in the same namespace.

## Machines

Open **Settings -> Machines** to rename connected machines for display. Machine access still depends on the runner's configured workspace roots and project workspace grants.

## Storage

Open **Settings -> Storage** to inspect and configure storage.

- Conversation history can use SQLite or Elasticsearch.
- Core hub data can use SQLite or MySQL, including users, permissions, projects, and machines.
- When Elasticsearch/MySQL is selected, it becomes the direct runtime database; the hub does not write SQLite first and mirror asynchronously.
- If data migration is enabled, the hub copies existing data into the new target storage.
- Large migrations continue in the background. The web app is blocked only during the initial phase and can be used after that.

If Elasticsearch uses a data stream, create the index template and data stream first. See [Elasticsearch storage template](../storage/elasticsearch.md).

## Personal Preferences

The remaining settings pages are user-facing preferences:

- **General** - language and global behavior
- **Display** - appearance, typography, colors, and session list density
- **Chat** - composer and conversation behavior
- **Voice** - voice assistant defaults, voice selection, and advanced tuning
- **About** - application links and version information
