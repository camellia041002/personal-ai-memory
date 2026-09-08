# 给 AI 部署索引版或 Hybrid V8 的提示词

索引版比 Lite 多出 Workers AI 与 Vectorize；Hybrid V8 还需要 D1 和数据库迁移。第一次使用建议先部署 Lite。确定需要按语义搜索后，再把下面提示词交给 AI，并把“目标档位”改成你选择的版本。

```text
请帮我把 personal-ai-memory 部署到我自己的 Cloudflare 账号。

目标档位：索引版（examples/vector-search）。如果我明确改成 Hybrid V8，优先使用独立的 v8 目录和其中的 Deploy to Cloudflare 配置；不要自行升级档位。

开始前：
1. 完整阅读 README、SECURITY.md、ARCHITECTURE.md、CLIENTS.md、目标档位代码、配置模板、测试和 scripts/validate-config.mjs。
2. 先运行 npm run check。失败时停止部署并解释失败项。
3. 只创建带有 personal-ai-memory-test 或我确认的前缀的新资源；不得绑定、读取、修改、迁移、重建或删除任何已有 Worker、KV、D1、Vectorize、域名和数据。

秘密规则：
1. 不要要求我把 Cloudflare API Token、AUTH_TOKEN、ADMIN_TOKEN 或 MCP_URL_TOKEN 粘贴到聊天里。
2. 优先用 Wrangler 浏览器登录；若确实必须使用 API Token，先列出目标档位所需的最小账号权限、资源范围、有效期和撤销方法，等我自行创建并放入本机环境。
3. 索引版的普通和秘密 URL Token 分别随机生成；新的 V8 部署用一个 `MEMORY_TOKEN` 兼容 Bearer 与单 URL，再单独生成不同的 `ADMIN_TOKEN`。让我在 Wrangler 或 Cloudflare 的 Secret 提示中亲自输入。
4. 不得读取、打印、回显、提交或记录 Token、完整秘密 URL、真实资源 ID、真实记忆、日志、备份、.env、.dev.vars 或实际 wrangler 配置。

索引版资源：一个新 Worker、一个新 KV、一个 1024 维 cosine Vectorize index、一个 Workers AI binding。确认代码模型与向量维度一致。

Hybrid V8 资源：在索引版基础上增加一个新 D1；使用 `v8/wrangler.jsonc`，确认部署页中的 Vectorize 为 1024 维、cosine；执行 `v8/migrations/0001_schema.sql`；创建 cat、owner、date metadata indexes，并等待列表真正显示三个字段后再测试。

部署后只使用完全虚构的数据执行 smoke test。任何测试写入都要删除；清理失败时只报告虚构 key，不输出连接秘密。

最终只交付：不含秘密的 Worker/资源名称、workers.dev 根地址、绑定清单、客户端连接模板（密钥用占位符）、测试结果、已知限制、回滚和删除位置。不要输出真实 Token 或完整秘密 URL。
```
