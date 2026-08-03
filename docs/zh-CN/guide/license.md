# 许可证与归属

**语言：** [English](../../en/guide/license.md) | 简体中文

HAPI Nexus 是基于 HAPI 的独立二次开发版本。

## 许可证

本项目按 GNU Affero General Public License v3.0 only（`AGPL-3.0-only`）发布。完整许可证文本见 [LICENSE](../../../LICENSE)。

AGPL-3.0 是面向网络服务场景的强 copyleft 许可证。对本项目来说，实际需要注意：

- 保留仓库中的 AGPL-3.0 许可证文本
- 保留上游版权和许可证声明
- 明确说明本仓库是基于 HAPI 修改而来
- 将修改后的项目整体继续按 AGPL-3.0 发布
- 分发二进制时，提供对应源码
- 以网络服务形式运行修改版本时，向使用该服务的用户提供其交互版本的对应源码

本文是项目合规说明，不构成法律意见。

## 上游归属

本项目派生自 HAPI：

- 本次二开的上游来源：https://github.com/jacobs-256/hapi
- 上游 fork 引用的原 HAPI 项目：https://github.com/tiann/hapi

HAPI 本身包含来自 Happy 和 happy-cli 的项目血缘：

- Happy：https://github.com/slopus/happy
- happy-cli 声明：[cli/NOTICE](../../../cli/NOTICE)

项目级修改说明见 [NOTICE.md](../../../NOTICE.md)。

## 项目身份

HAPI Nexus 不是上游 HAPI 项目，也不代表上游官方发布版本。为了兼容现有代码，本项目仍保留 `hapi` CLI 命令。

如果后续要用新的命名空间发布包，请同步更新 package metadata、release scripts 和安装文档中的包名/仓库名。
