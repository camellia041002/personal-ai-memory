# Security

## Supported authentication

MCP 端点只接受 `Authorization: Bearer <AUTH_TOKEN>`。管理员端点只接受独立的 `Authorization: Bearer <ADMIN_TOKEN>`。两个 Token 必须不同、随机生成并至少 24 个字符；生产部署建议使用更长的高熵值。

不要把 Token 放入 URL。URL 会进入浏览历史、代理记录、访问日志、监控系统和截图。公开版明确拒绝旧归档曾支持的 `/mcp/<token>` 路径，也不实现查询参数 Token。

## Secret storage

凭据必须通过 Cloudflare Secrets 配置，例如 `wrangler secret put AUTH_TOKEN`。不得把 Token 写入 `wrangler.jsonc`、源码、示例数据、CI 文件、Issue、日志或备份。本仓库的 `wrangler.example.jsonc` 只包含资源 ID 占位符和非敏感示例值。

## Data isolation

生产数据与示例数据必须使用不同的 KV、D1 和 Vectorize 资源。公开源码不等于公开 KV、D1 或 Vectorize 数据；这些资源不会因为 GitHub 仓库公开而自动公开。部署者仍应检查 Worker 路由、Cloudflare Access、绑定和账号权限，确保没有把生产资源误绑定到示例部署。

仓库只提供虚构样例。不要提交真实记忆、导出文件、数据库、日志、备份、`.env`、`.dev.vars` 或真实 Wrangler 配置。

## Permission separation

普通 MCP 权限可以保存、读取、受限查找、检索和确认删除单个 key。它不能无条件列出全部 key，也不能全量读取全部内容。

管理员权限可以分页查看 key、查看索引状态并逐 key 重建。管理员 Token 的泄露影响范围更大，不应配置到普通 MCP 客户端。删除仍位于普通工具集中，是为了保持 V8 的使用方式，但必须提供与目标 key 完全一致的 `confirmKey`。

## Limits and abuse controls

应用层限制包括：key 200 字符、value 100,000 字符、query 500 字符、key 查找 20 条、最近日记 30 天、混合结果 5 个 chunk。它们用于控制意外的大请求和过宽读取，不构成完整的拒绝服务防护。

部署者必须自行配置访问控制和速率限制。建议至少配置 Cloudflare Access 或等效身份边界、WAF/Rate Limiting、请求体大小限制、资源配额监控和异常告警。公开版不提供多租户隔离，也不应在互不信任的用户之间共享同一套绑定。

## Failure model

KV、D1 和 Vectorize 不能组成单一事务。KV 写入成功而索引失败时，工具返回 `pending`。管理员应检查 `/admin/index-status` 并逐 key 重建。检索只接受 D1 当前索引表中的向量 ID，从而降低陈旧 Vectorize 项进入结果的风险。

## Reporting a vulnerability

在仓库公开后，应通过 GitHub Security Advisories 或维护者指定的私密渠道报告漏洞。不要在公开 Issue 中附带真实 Token、资源 ID、记忆内容、日志或生产 URL。
