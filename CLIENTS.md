# Client connections

## Lite（首页默认）

Lite 只需要一个 `MEMORY_TOKEN`：

- 推荐：`https://<worker>.workers.dev/mcp` + `Authorization: Bearer <MEMORY_TOKEN>`；
- 只支持单 URL：`https://<worker>.workers.dev/mcp/<MEMORY_TOKEN>`。

下面各客户端示例中的 `AUTH_TOKEN` 或 `MCP_URL_TOKEN`，在 Lite 中都替换为同一个 `MEMORY_TOKEN`。不要把 Cloudflare API Token 配置到 MCP 客户端。

## 索引版与 Hybrid V8

本项目提供两种普通 MCP 连接方式：

- 默认推荐：`https://<worker>.workers.dev/mcp` + `Authorization: Bearer <AUTH_TOKEN>`；
- 可选便捷模式：`https://<worker>.workers.dev/mcp/<MCP_URL_TOKEN>`，只粘贴一条 URL。

自定义域名不是必需条件。使用 Cloudflare 部署产生的 `workers.dev` 地址即可。

## 已验证范围

项目作者曾在私人部署中实际将同类 Worker MCP 接入 ChatGPT、Claude 系列客户端、Kelivo 和 Codex，并长期使用过 Bearer 请求头与单 URL 路径 Token 两种方式。

本公开仓库新增的三档统一路由已经通过本地自动化测试，但目前没有把这份未提交代码部署到新的 Cloudflare 测试账号后，再对每个客户端逐一执行端到端复验。因此下面应理解为：

- “作者实际使用过”描述私人部署中的真实经历；
- Codex 配置字段来自当前 OpenAI 官方文档；
- Claude 的单 URL 操作来自当前 Anthropic 官方说明；
- 通用 JSON 是协议配置示例，不能代表所有客户端已经验证。

客户端可能缓存工具 schema。作者的私人使用中，Worker 更新后多数客户端会重新读取变化，但 ChatGPT 连接器曾需要手动更新。这个行为取决于客户端版本，不能作为本项目保证。

## ChatGPT 和只提供 URL 输入框的客户端

如果界面只允许填写一条远程 MCP URL，先为 Worker 设置 `MCP_URL_TOKEN` Secret，再粘贴：

```text
https://<worker>.workers.dev/mcp/<MCP_URL_TOKEN>
```

不要使用：

```text
https://<worker>.workers.dev/mcp?token=<TOKEN>
```

完整秘密 URL 就是密码。它可能留在连接器配置、浏览历史、请求日志、截图、报错和剪贴板记录中。只在无法发送请求头且你接受这些风险时使用。

## Claude 和 Claude Desktop 的远程连接器

Anthropic 当前说明是进入 Settings → Connectors，添加自定义连接器并填写远程 MCP URL。对于本项目，填写秘密 URL：

```text
https://<worker>.workers.dev/mcp/<MCP_URL_TOKEN>
```

Anthropic 同时明确说明：Claude Desktop 的远程 MCP 应通过 Connectors 添加，而不是直接写进 `claude_desktop_config.json`。参见 [Getting Started with Custom Connectors Using Remote MCP](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp) 和 [Building Custom Connectors via Remote MCP Servers](https://support.anthropic.com/en/articles/11503834-building-custom-integrations-via-remote-mcp-servers)。

这个项目没有实现 OAuth。客户端看到的是一个无需额外 OAuth 流程的远程 URL，但 URL 路径本身携带秘密，因此必须按密码保护。

## Codex：推荐使用 Bearer 环境变量

OpenAI 官方文档说明，Codex 的 Streamable HTTP MCP 支持 `url` 和 `bearer_token_env_var`；同一主机上的 ChatGPT 桌面端、Codex CLI 和 IDE 扩展共享 MCP 配置。编辑用户级 `~/.codex/config.toml`，或可信项目内的 `.codex/config.toml`：

```toml
[mcp_servers.personal_ai_memory]
url = "https://<worker>.workers.dev/mcp"
bearer_token_env_var = "PERSONAL_AI_MEMORY_TOKEN"
```

Bash/macOS 在启动 Codex 的同一环境中设置：

```bash
export PERSONAL_AI_MEMORY_TOKEN='<AUTH_TOKEN>'
```

PowerShell：

```powershell
$env:PERSONAL_AI_MEMORY_TOKEN = '<AUTH_TOKEN>'
```

保存配置后重启相应 Codex 客户端，再用 MCP 列表确认服务器已初始化。详细字段见 [OpenAI Model Context Protocol documentation](https://learn.chatgpt.com/docs/extend/mcp)。

Codex 也可以把秘密 URL 直接放入 `url` 且不配置 Bearer，但不推荐，因为 Token 会以明文出现在 `config.toml`：

```toml
[mcp_servers.personal_ai_memory]
url = "https://<worker>.workers.dev/mcp/<MCP_URL_TOKEN>"
```

## 需要 JSON 的其他客户端

不同客户端对远程 HTTP MCP、环境变量替换和字段名的支持并不完全一致。下面只是无真实凭据的通用模板，使用前应查看对应客户端文档。

Bearer 示例：

```json
{
  "mcpServers": {
    "personal-ai-memory": {
      "type": "http",
      "url": "https://<worker>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <AUTH_TOKEN>"
      }
    }
  }
}
```

单 URL 示例：

```json
{
  "mcpServers": {
    "personal-ai-memory": {
      "type": "http",
      "url": "https://<worker>.workers.dev/mcp/<MCP_URL_TOKEN>"
    }
  }
}
```

如果客户端支持从环境变量读取 header，应优先使用环境变量，不要把真实 Bearer Token 写进长期保存的 JSON 文件。
