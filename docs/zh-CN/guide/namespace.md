# 命名空间（高级）

**语言：** [English](../../en/guide/namespace.md) | 简体中文

命名空间用于在同一个公开 HAPI hub 上隔离不同团队。它不是在同一团队内创建用户的普通方式。

这不是大多数用户的默认设置路径。

同一命名空间内协作请使用[项目与共享](./projects.md)。项目在用户之间共享会话和 runner workspace；命名空间用于让不同团队彼此完全隔离。

## 工作方式

- Hub 使用一个基础 `CLI_API_TOKEN`。
- CLI、runner、API 和 Telegram 绑定客户端通过给 token 追加 `:<namespace>` 实现隔离。
- 本地用户名/密码用户在各自命名空间内唯一；普通浏览器登录指向默认命名空间。
- 项目邀请只在创建它的命名空间内有效。

## 设置

1. 在 hub 侧只配置基础 token：

```
CLI_API_TOKEN="your-base-token"
```

2. 为每个隔离团队，在 CLI/runner/Telegram 绑定 token 中追加命名空间：

```
CLI_API_TOKEN="your-base-token:team-a"
```

3. 用相同 token 后缀启动该团队的 runner。
4. 对默认私有部署中的浏览器用户，请在 **Settings -> Users** 创建本地账号，而不是把基础 token 发给用户。

## 限制与注意事项

- Hub 侧 `CLI_API_TOKEN` 不能包含 `:<namespace>`。如果包含，hub 会剥离后缀并记录警告。
- 命名空间彼此隔离：会话、机器和用户不会跨命名空间可见。
- 一个 machine ID 不能在多个命名空间复用。
  - 如果要在一台机器上运行多个命名空间，请为每个命名空间使用单独的 `HAPI_HOME`，或在切换前用 `hapi auth logout` 清除 machine ID。
- 远程启动是命名空间范围内的。如果同一机器需要服务多个命名空间，请为每个命名空间运行单独 runner（使用单独 `HAPI_HOME`）。
