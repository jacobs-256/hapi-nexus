# 项目与共享

**语言：** [English](../../en/guide/projects.md) | 简体中文

项目是一个 HAPI 命名空间内的共享边界。命名空间仍然用于隔离不同团队；项目决定该命名空间内哪些用户可以看到会话并使用共享 workspace roots。

## 概念

- **用户** - 在 hub 中创建的本地用户名/密码账号。Telegram 用户绑定后会成为独立用户。
- **项目** - 会话、成员、邀请和共享 workspace 的命名容器。
- **Workspace** - 挂载到项目的机器 + 根路径。共享用户只能浏览和启动挂载 workspace 内的内容。
- **机器所有者** - 注册 runner 机器的用户。只有所有者可以把该机器的 workspace roots 挂载到项目。

## Runner Workspace Roots

`--workspace-root` 是 runner 所在机器上的访问白名单。它应指向该机器上已存在的目录，并包含你希望 HAPI 浏览或启动会话的项目。

同一命名空间/机器通常只需要一个 runner，需要多个目录时重复传入 root：

```bash
hapi runner start \
  --workspace-root /Users/alice/src \
  --workspace-root /Volumes/work
```

同一命名空间中有多个目录时不需要运行多个 runner。只有需要不同命名空间或不同机器时才运行单独 runner。

远程用户不需要在自己的电脑上保存源码。runner 机器需要源码和 agent CLI；远程用户通过 hub 控制会话。

## 创建并共享项目

1. 启动 hub。
   - 首次登录默认是 `admin` / `admin`；请在 **Settings -> Account** 中修改。
   - 管理员可以在 **Settings -> Users** 创建更多用户。
2. 在有源码的机器上启动 runner：

```bash
hapi runner start --workspace-root /path/to/projects
```

3. 打开 Web 应用，进入 **Settings -> Projects**。
4. 创建项目，并可选择挂载 runner root 下的初始 workspace。
5. 创建 `viewer`、`editor`、`admin` 或 `owner` 邀请链接。
6. 把邀请链接发送给能登录同一 hub/命名空间的用户。

邀请链接在过期前可重复使用。再次接受同一个邀请是幂等操作，不会把已有的更高角色降级。

## 角色

| 角色 | 权限 |
| --- | --- |
| `viewer` | 查看项目会话并浏览共享 workspace。 |
| `editor` | 在 viewer 基础上可发送消息、恢复/重开会话，并在项目 workspace 内启动会话。 |
| `admin` | 在 editor 基础上可管理项目成员、workspace 和邀请。 |
| `owner` | 在 admin 基础上可授予、变更或移除 owner 角色。每个项目必须至少保留一个 owner。 |

## 访问规则

- 用户只能看到自己是成员的项目。
- 用户只能看到自己有权访问的项目会话。
- 机器所有者可以使用完整 runner workspace roots。
- 共享用户只有在项目 workspace 授权时才能看到机器，机器元数据会被限制到这些共享 roots。
- 创建项目 workspace 需要拥有目标机器。
- 在共享机器上启动会话需要 `editor` 或更高角色，并且目录必须位于项目 workspace 内。
- 通过用户 ID 直接变更成员要求该用户已绑定且位于同一命名空间。邀请链接是添加新用户的推荐方式。

## 命名空间边界

项目不会跨命名空间。用户、机器、会话和项目邀请都限定在创建它们的命名空间内。普通私有部署使用默认命名空间；高级 CLI/runner/Telegram 设置可以使用 `CLI_API_TOKEN:<namespace>` 做隔离。
