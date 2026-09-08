# Security

## Lite authentication

首页默认部署的 Lite 只使用一个 Cloudflare Secret：`MEMORY_TOKEN`。同一个普通权限 Token 可通过两种载体使用：精确路径 `/mcp` 的 `Authorization: Bearer <MEMORY_TOKEN>`，或只支持 URL 的客户端使用精确路径 `/mcp/<MEMORY_TOKEN>`。Lite 没有管理员端点，因此不存在普通权限与管理员权限混用。

`MEMORY_TOKEN` 必须来自至少 32 字节安全随机数，运行时要求不少于 43 个 URL-safe 字符，且只允许 ASCII 字母、数字、`-` 和 `_`。64 位十六进制值符合要求。错误、过短、未配置或多余路径均不会通过鉴权。

Lite 的 Worker 与 KV 位于部署者自己的 Cloudflare 账号中，但 Cloudflare 仍承载服务和数据；调用工具时，AI 客户端及模型也会看到所请求和返回的记忆。本项目不提供端到端加密、客户端侧加密、OAuth、多租户隔离、审计日志或内置速率限制。

以下章节中的 `AUTH_TOKEN`、`MCP_URL_TOKEN` 和 `ADMIN_TOKEN` 适用于索引版与 Hybrid V8。

## Supported authentication

普通 MCP 提供两种连接方式：

- 默认安全模式：精确路径 `/mcp` 只接受 `Authorization: Bearer <AUTH_TOKEN>`；
- 可选便捷模式：精确路径 `/mcp/<MCP_URL_TOKEN>`，仅在配置了有效 `MCP_URL_TOKEN` Secret 时启用。

管理员端点 `/admin/*` 始终只接受独立的 `Authorization: Bearer <ADMIN_TOKEN>`。`AUTH_TOKEN`、`MCP_URL_TOKEN` 都不能访问管理员接口。三个 Token 必须分别生成且互不相同；`AUTH_TOKEN` 与 `ADMIN_TOKEN` 至少 24 个字符，文档提供的默认做法是为每个 Token 分别生成 32 字节安全随机数。

`MCP_URL_TOKEN` 必须来自至少 32 字节的安全随机数，并编码为单个 URL-safe 路径段。运行时要求至少 43 个字符，且只允许 ASCII 字母、数字、`-` 和 `_`；43 字符 base64url 或 64 字符十六进制值都符合路径格式。`/mcp/`、错误 Token、未配置 Token、额外路径层级和非 URL-safe Token 都返回 `404`。`/mcp` 缺少或使用错误 Bearer 时返回 `401`。

本项目不支持 query parameter Token。仅把 `?token=...` 附加到 `/mcp` 不会通过鉴权。

完整秘密 URL 等同于密码，而且风险高于请求头：它可能进入 Cloudflare 平台或代理的请求日志、客户端配置、浏览历史、监控系统、错误报告、截图、剪贴板和复制记录。应用代码不会主动记录请求 URL 或 Token，也不会在响应和错误信息中回显它们，但无法阻止 Cloudflare 平台、上游代理或客户端自身记录完整路径。能配置请求头时，应优先使用 Bearer 模式。

## Secret storage

凭据必须通过 Cloudflare Secrets 配置，例如 `wrangler secret put AUTH_TOKEN`、`wrangler secret put ADMIN_TOKEN` 和可选的 `wrangler secret put MCP_URL_TOKEN`。不得把 Token 写入 `wrangler.jsonc`、源码、示例数据、CI 文件、Issue、应用日志或备份。本仓库的 `wrangler.example.jsonc` 只包含资源 ID 占位符和非敏感示例值。

## Data isolation

生产数据与示例数据必须使用不同的 KV、D1 和 Vectorize 资源。公开源码不等于公开 KV、D1 或 Vectorize 数据；这些资源不会因为 GitHub 仓库公开而自动公开。部署者仍应检查 Worker 路由、Cloudflare Access、绑定和账号权限，确保没有把生产资源误绑定到示例部署。

仓库只提供虚构样例。不要提交真实记忆、导出文件、数据库、日志、备份、`.env`、`.dev.vars` 或真实 Wrangler 配置。

## Permission separation

普通 MCP 权限可以通过 Bearer 或秘密 URL 认证，权限相同：保存、读取、受限查找、检索和确认删除单个 key。它不能无条件列出全部 key，也不能全量读取全部内容。

管理员权限可以分页查看 key、查看索引状态并逐 key 重建。管理员 Token 的泄露影响范围更大，不应配置到普通 MCP 客户端。删除仍位于普通工具集中，是为了保持 V8 的使用方式，但必须提供与目标 key 完全一致的 `confirmKey`。

## Limits and abuse controls

应用层限制包括：key 200 字符、value 100,000 字符、query 500 字符、key 查找 20 条、最近日记 30 天、混合结果 5 个 chunk。它们用于控制意外的大请求和过宽读取，不构成完整的拒绝服务防护。

部署者必须自行配置访问控制和速率限制。建议至少配置 Cloudflare Access 或等效身份边界、WAF/Rate Limiting、请求体大小限制、资源配额监控和异常告警。公开版不提供多租户隔离，也不应在互不信任的用户之间共享同一套绑定。

## Failure model

KV、D1 和 Vectorize 不能组成单一事务。KV 写入成功而索引失败时，工具返回 `pending`。管理员应检查 `/admin/index-status` 并逐 key 重建。检索只接受 D1 当前索引表中的向量 ID，从而降低陈旧 Vectorize 项进入结果的风险。

## Reporting a vulnerability

在仓库公开后，应通过 GitHub Security Advisories 或维护者指定的私密渠道报告漏洞。不要在公开 Issue 中附带真实 Token、资源 ID、记忆内容、日志或生产 URL。
