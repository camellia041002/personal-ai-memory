# personal-ai-memory V8

V8 是带混合搜索和索引恢复能力的完整版本。它仍是一个部署在你自己 Cloudflare 账号里的外置 MCP 记忆系统；一个 AI 可以使用，也可以让多个支持远程 MCP 的客户端连接同一份记忆。

[![Deploy V8 to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/camellia041002/personal-ai-memory/tree/main/v8)

部署页会自动准备 Worker、KV、D1、Vectorize 和 Workers AI。你需要完成三项输入：

1. `MEMORY_TOKEN`：至少 43 位的随机字母数字串，是普通保存和读取的钥匙。
2. `ADMIN_TOKEN`：另一条不同的随机串，只用于索引检查和恢复。
3. Vectorize：填写 `Dimensions = 1024`、`Metric = cosine`。

部署命令会自动执行 D1 migration，并请求创建 `cat`、`owner`、`date` 三个 Vectorize metadata index。Cloudflare 的 metadata index 创建是异步的；部署后应等它们在控制台中显示，再测试带筛选的语义搜索。

连接方式与 Lite 相同：

```text
Bearer: https://你的项目名.你的子域名.workers.dev/mcp
单 URL: https://你的项目名.你的子域名.workers.dev/mcp/你的MEMORY_TOKEN
```

当前这个 V8 按钮已完成本地配置、打包和 dry-run 检查，但还没有使用全新 Cloudflare 资源做端到端验证，因此不能把它宣传成“已验证的一键部署”。
