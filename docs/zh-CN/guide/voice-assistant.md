# 语音助手

**语言：** [English](../../en/guide/voice-assistant.md) | 简体中文

使用内置语音助手通过语音控制 AI 编程代理。语音能力由 ElevenLabs Conversational AI 提供。

## 概览

语音助手可以：

- **和 agent 对话** - 免手动输入地提问、下达指令和请求代码修改
- **用语音批准权限** - 说 “yes” 或 “no” 来批准或拒绝权限请求
- **监控进度** - 任务完成或出错时接收语音更新

助手会把语音沟通与你当前活跃的编程代理（Claude Code、Codex、Cursor Agent、Grok Build 或 OpenCode）连接起来，转发请求并用自然语音总结响应。

## 前置条件

一个拥有 API 访问权限的 [ElevenLabs](https://elevenlabs.io) 账号。

## 设置

### 1. 获取 API Key

1. 在 [elevenlabs.io](https://elevenlabs.io) 注册或登录
2. 进入账号设置中的 [API Keys](https://elevenlabs.io/app/settings/api-keys)
3. 创建新的 API key 并复制

### 2. 配置 Hub

启动 hub 前设置环境变量：

```bash
export ELEVENLABS_API_KEY="your-api-key"
hapi-server hub --relay
```

首次使用时，hub 会在你的 ElevenLabs 账号中自动创建一个 “Hapi Voice Assistant” agent。

### 3. （可选）自定义 Agent

如果你想使用自己的 ElevenLabs agent，而不是自动创建的 agent：

```bash
export ELEVENLABS_AGENT_ID="your-agent-id"
```

## 使用

### 启动语音会话

1. 在 Web 应用中打开一个会话
2. 点击输入框中的 **麦克风按钮**（或输入为空时的发送按钮）
3. 在提示时授予麦克风权限
4. 开始说话

### 语音命令

| 你说 | 结果 |
|----------|--------------|
| "Ask Claude to..." / "Have it..." | 把请求发送给编程 agent |
| "Refactor the auth module" | 编程请求会自动转发 |
| "Yes" / "Allow" / "Go ahead" | 批准待处理权限请求 |
| "No" / "Deny" / "Cancel" | 拒绝待处理权限请求 |
| 直接提问 | 如果语音助手能回答，会自行回答 |

## 工作原理

### 上下文同步

语音助手会在以下场景自动收到更新：

- 你聚焦到某个会话（会加载完整历史）
- agent 发送消息或使用工具
- 权限请求到达
- 任务完成

你不需要主动询问状态；助手会主动总结相关变化。

### 工具

语音助手有两个工具可以与编程 agent 交互：

1. **messageCodingAgent** - 把你的请求转发给活跃 agent
2. **processPermissionRequest** - 处理权限批准和拒绝

### 架构

```
Browser → WebRTC → ElevenLabs ConvAI → Voice Assistant → HAPI Hub → Coding Agent
```

语音连接使用 WebRTC 实现低延迟音频流。HAPI hub 提供 conversation token 并处理认证。

## 使用建议

- **说清楚** - 清晰、完整的请求效果更好
- **等待完成** - agent 工作期间助手会保持安静，完成后总结结果
- **使用自然语言** - 不需要特殊命令语法
- **保持会话聚焦** - 同一时间一个活跃会话，上下文最清晰

## 故障排查

### "ElevenLabs API key not configured"

在环境变量中设置 `ELEVENLABS_API_KEY` 并重启 hub。

### "Failed to get microphone permission"

- 检查浏览器麦克风权限
- 确保没有其他应用占用麦克风
- 尝试刷新页面

### 小米/MIUI 设备上麦克风权限失败

如果小米/MIUI 设备上无法启动语音，或浏览器无法请求麦克风权限，请检查小米钱包等应用的“显示在其他应用上层”权限。悬浮窗、支付或钱包浮层、聊天气泡、录屏、翻译工具、护眼工具和游戏助手都可能干扰浏览器麦克风权限弹窗。禁用活跃浮层，重新打开 HAPI，并再次授予麦克风访问权限。

### 语音无响应

- 确认会话已连接（状态栏绿点）
- 检查语音状态是否显示 “connecting” 或已连接
- 确保网络连接稳定

### "Failed to create ElevenLabs agent automatically"

- 验证 API key 是否有效
- 检查 ElevenLabs 账号是否还有可用额度
- 尝试设置自定义 `ELEVENLABS_AGENT_ID`

### 音频质量差

- 使用耳机避免回声
- 降低背景噪音
- 检查网络连接稳定性
