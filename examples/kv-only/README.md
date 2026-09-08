# KV only profile

> 新用户请使用仓库首页的 [`lite`](../../lite) 一键部署入口。这个目录保留旧的双 Token KV-only 公开实现，主要用于版本对照和回归测试，不再是默认部署路径。

这是 V1 功能范围的安全重写版，不是历史 V1 源码。它只需要 Workers 与 KV，适合只想按 key 保存和读取少量长期记忆的部署者。

提供 `save_memory`、`get_memory`、受限的 `find_memory_keys` 和带 `confirmKey` 的 `delete_memory`。它不提供全库内容读取、URL Token、OAuth、语义搜索或管理员接口。

创建独立 KV 后，复制本目录的 `wrangler.example.jsonc` 为 `wrangler.jsonc`，替换占位 ID，并设置 Secret：

```bash
npx wrangler secret put AUTH_TOKEN --config wrangler.jsonc
npx wrangler deploy --config wrangler.jsonc
```

默认使用 `/mcp` + `Authorization: Bearer <AUTH_TOKEN>`。需要只粘贴一条 URL 时，可额外设置 `MCP_URL_TOKEN` Secret，并使用精确路径 `/mcp/<MCP_URL_TOKEN>`；生成方法、风险和严格路由规则见仓库根目录的 [README](../../README.md) 与 [SECURITY](../../SECURITY.md)。
