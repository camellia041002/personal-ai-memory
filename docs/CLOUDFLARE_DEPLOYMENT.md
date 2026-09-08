# Cloudflare 部署边界

## 三个档位需要的资源

| 档位 | 必需资源 | Secret |
| --- | --- | --- |
| Lite | Worker、KV binding `MEMORY` | `MEMORY_TOKEN` |
| 索引版 | Worker、KV `MEMORY`、Vectorize `VECTORIZE_INDEX`、Workers AI `AI` | `AUTH_TOKEN`；可选 `MCP_URL_TOKEN` |
| Hybrid V8 | 索引版全部资源、D1 `DB`、三项 Vectorize metadata indexes | `AUTH_TOKEN`、`ADMIN_TOKEN`；可选 `MCP_URL_TOKEN` |

Lite 的 Deploy to Cloudflare 按钮会读取 `lite/wrangler.jsonc`，在使用者自己的 Cloudflare 账号中自动创建并绑定 KV。部署页会根据 `lite/.dev.vars.example` 收集 `MEMORY_TOKEN`。按钮路线不需要把 Cloudflare API Token 交给 AI。

索引版与 Hybrid V8 目前保留为 AI/CLI 辅助部署路线，尚未在全新账号上把它们标记为“一键已验证”。

## CLI/API 自动化的最小权限

能用 `wrangler login` 的本机交互流程时，优先使用浏览器授权，不额外创建长期 API Token。

如果自动化环境必须使用 Cloudflare API Token，只给目标账号、必要有效期和对应档位所需权限：

| 权限 | Lite | 索引版 | Hybrid V8 | 用途 |
| --- | --- | --- | --- | --- |
| Account / Workers Scripts / Edit | 必需 | 必需 | 必需 | 部署 Worker 与 Secret |
| Account / Workers KV Storage / Edit | 必需 | 必需 | 必需 | 创建、绑定和测试 KV |
| Account / Vectorize / Edit | 不需要 | 必需 | 必需 | 创建和维护向量索引 |
| Account / D1 / Edit | 不需要 | 不需要 | 必需 | 创建数据库、执行迁移 |

Workers AI binding 本身写在 Wrangler 配置里，由 Worker 运行时调用；上表不把 Workers AI REST 权限列为普通部署必需项。如果部署助手还要在 Worker 外直接调用 Workers AI REST API，Cloudflare 当前文档要求 `Workers AI Read` 与 `Workers AI Edit`，但这不是本项目正常部署所需动作。

若 Cloudflare/Wrangler 当前部署流程提示还需要 `Account Settings Read`、`User Details Read` 或 `Memberships Read` 来识别账号，可在核对官方说明后追加只读权限。Cloudflare 自动创建的 Workers Builds Token 当前还可能包含 Workers Routes Edit；仅使用 `workers.dev` 的手工最小权限设计不需要 DNS 权限，也不应添加与目标资源无关的编辑权限。

Cloudflare 权限名称和部署流程可能变化。创建 Token 前应以当前 [API Token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) 和 [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) 为准。

## 部署完成后的交付清单

部署者或协助部署的 AI 应交付：

- 选择的档位；
- Worker 名称与**不含密钥**的 `workers.dev` 根地址；
- 新建资源的名称和 binding 对照；
- Bearer 与单 URL 的连接模板，所有真实 Secret 用占位符代替；
- 使用虚构数据的初始化、工具列表、保存、读取、查找/搜索和确认删除结果；
- 当前限制、费用边界以及资源回滚/删除入口；
- 若测试失败，说明失败阶段和未清理的虚构 key。

## 绝对不能读取、打印或提交

- Cloudflare 登录密码、API Token、浏览器会话或 Cookie；
- `MEMORY_TOKEN`、`AUTH_TOKEN`、`ADMIN_TOKEN`、`MCP_URL_TOKEN`；
- 包含真实 Token 的完整 MCP URL 或 `Authorization` 请求头；
- `.env`、`.dev.vars`、实际生产 `wrangler.jsonc`、CI Secret；
- 真实 KV/D1/Vectorize 数据、导出、数据库、日志和备份；
- 个人记忆、聊天记录、账号资料、生产资源 ID 和完整错误日志。

资源名称和不含 Secret 的 `workers.dev` 根地址可以用于交付，但公开发布前仍应由使用者确认。完整秘密 URL 必须始终按密码处理。
