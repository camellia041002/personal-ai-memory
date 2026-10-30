# personal-ai-memory V8

V8 是带混合搜索和索引恢复能力的完整版本。它仍是一个部署在你自己 Cloudflare 账号里的外置 MCP 记忆系统；一个 AI 可以使用，也可以让多个支持远程 MCP 的客户端连接同一份记忆。

> [!WARNING]
> **已经在用 Lite 的朋友，不要直接点击下面的 V8 部署按钮。** 按钮会新建一个空的 KV，因此刚部署好的 V8 暂时看不到旧记忆。原来的记忆没有丢，只是新 Worker 的 `MEMORY` 还没有接到原来的 KV。请先阅读[《从 Lite 升级到 V8》](../README.md#从-lite-升级到-v8)：部署后把 `MEMORY` 绑定回原来的 KV，再为旧记忆补建索引。

[![Deploy V8 to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/camellia041002/personal-ai-memory/tree/main/v8)

部署页会自动准备 Worker、KV、D1、Vectorize 和 Workers AI。你需要完成三项输入：

1. `MEMORY_TOKEN`：至少 43 位的随机字母数字串，是普通保存和读取的钥匙。
2. `ADMIN_TOKEN`：另一条不同的随机串，只用于索引检查和恢复。
3. Vectorize：填写 `Dimensions = 1024`、`Metric = cosine`。

部署命令会自动执行 D1 migration，并请求创建 `cat`、`owner`、`date`、`space` 四个 Vectorize metadata index。`space` 为默认关闭的 V9 shadow 功能预留；V8 默认行为不依赖它。Cloudflare 的 metadata index 创建是异步的；部署后应等它们在控制台中显示，再测试带筛选的语义搜索。

当前构建会把根目录中的全部 migration 复制到 `v8/migrations`，所以部署 V8 时也会创建默认关闭的 V9 access-space 和 lifecycle 表。创建这些空表不会启用 V9：模板中的 `V9_AUTH_MODE=off`、`V9_INFRA_ENABLED=false` 和 `V9_RECALL_ENABLED=false` 会继续保持 V8 行为。这个 V9 分支尚未准备好作为正式部署版本；合并前必须重新核对迁移、升级和回退说明。

连接方式与 Lite 相同：

```text
Bearer: https://你的项目名.你的子域名.workers.dev/mcp
单 URL: https://你的项目名.你的子域名.workers.dev/mcp/你的MEMORY_TOKEN
```

当前这个 V8 按钮已完成本地配置、打包和 dry-run 检查，但还没有使用全新 Cloudflare 资源做端到端验证，因此不能把它宣传成“已验证的一键部署”。
