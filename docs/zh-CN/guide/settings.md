# 设置控制台

**语言：** [English](../../en/guide/settings.md) | 简体中文

Web 设置区域面向私有部署的管理控制台设计。它把个人偏好、账号安全、用户管理、项目共享和机器控制集中在一个地方。

## 布局

- 桌面端使用主从布局：左侧导航列出设置分类，右侧面板显示当前页面。
- 移动端使用聚焦页面布局：顶部返回按钮，一次只显示一个设置分类。
- 顶部应用标题栏和底部状态栏仍属于主应用 shell；设置页只替换中间内容区域。

## 账号

打开 **Settings -> Account** 管理当前登录用户：

- 查看资料、用户名、角色、命名空间和个人 access token
- 复制或重新生成个人 access token
- 修改用户名
- 修改密码
- 退出登录

只有本地用户名/密码用户可以修改自己的用户名和密码。用户名在命名空间内必须唯一。

## 用户

管理员打开 **Settings -> Users** 管理本地账号：

- 创建用户名/密码用户
- 设置显示名称
- 分配 `user` 或 `admin` 角色
- 禁用或重新启用账号
- 重置密码
- 重新生成个人 access token

第一次启动 hub 时会创建本地管理员，默认用户名为 `admin`、密码为 `admin`，除非在初始化前设置了 `HAPI_ADMIN_USERNAME` 和 `HAPI_ADMIN_PASSWORD`。请立即在 **Settings -> Account** 中修改默认凭据。

## 项目

打开 **Settings -> Projects** 管理协作边界：

- 创建或重命名项目
- 挂载自己机器拥有的 runner workspace
- 按用户 ID 添加成员
- 创建邀请链接
- 移除成员或 workspace

项目角色包括 `viewer`、`editor`、`admin` 和 `owner`。共享用户只能看到同一命名空间内通过项目授予的会话和 workspace。

## 机器

打开 **Settings -> Machines** 修改已连接机器的显示名称。机器访问仍取决于 runner 配置的 workspace roots 和项目 workspace 授权。

## 存储

打开 **Settings -> Storage** 查看本地存储使用情况。会话、消息、用户、项目和机器数据存储在 hub 的 SQLite 数据库中，位置位于 `~/.hapi/` 或配置的 `HAPI_HOME` 下。

## 个人偏好

其他设置页用于用户偏好：

- **General** - 语言和全局行为
- **Display** - 外观、字体、颜色和会话列表密度
- **Chat** - 输入框和会话行为
- **Voice** - 语音助手默认设置、音色选择和高级调优
- **About** - 应用链接和版本信息
