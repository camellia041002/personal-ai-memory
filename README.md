# personal-ai-memory

一个运行在 Cloudflare Workers 上的个人长期记忆参考实现。当前公开代码以 2026 年 9 月 4 日部署的 V8 为依据，使用 KV 保存原文、D1 保存可核验的文本切片与索引状态、Vectorize 提供语义候选，并通过 MCP 暴露受限的读写工具。

本仓库只包含脱敏后的参考实现和完全虚构的示例数据。私人归档中的 V1—V7 原始源码、生产配置、真实数据、日志与备份均不在仓库中。

## 项目背景

本项目源于个人跨会话长期记忆需求。V1由Claude协助完成原型代码，此后根据真实使用、数据增长、异常恢复、检索质量和权限安全问题，借助Claude与Codex持续迭代至V8。需求判断、方案取舍、测试验收、部署与运行维护由本人持续推进。

在一次有记录的 V8 迁移中，系统处理了 100+ 个 KV key，并分批重建为 300+ 个检索 chunk；这里采用区间描述，仅用于说明真实数据规模与可恢复重建需求，不代表性能基准。

AI 在项目中承担原型生成、代码修改建议和实现辅助。功能需求、版本取舍、测试验收、线上部署与日常维护并非由模型自主完成。仓库不宣称未经源码或记录证明的性能数据。

## 选择适合你的版本

公开仓库提供三个能力档位。它们对应项目演进中的三个主要阶段，但都按当前安全要求重新整理；前两档不是历史源码的原样副本。

| 版本 | 依赖 | 适合场景 | 入口 |
| --- | --- | --- | --- |
| KV only | Workers + KV | 只需要按 key 保存、读取、受限查找和确认删除 | [`examples/kv-only`](examples/kv-only) |
| Vector search | Workers + KV + Workers AI + Vectorize | 需要文本切片和语义检索，但不需要 D1 精确检索与索引状态表 | [`examples/vector-search`](examples/vector-search) |
| Hybrid V8 | Workers + KV + D1 + Workers AI + Vectorize | 需要精确短语与中文语义混合检索、分类过滤、索引状态和管理员恢复能力 | [`src`](src) |

三档都只接受 `Authorization: Bearer`，都限制输入与返回规模，都不公开无条件全库读取，并要求确认后才能删除。完整 V8 是默认推荐版本；资源和维护成本较低的使用者可以选择前两档。

## V1 到 V8

| 版本 | 源码或归档可证明的主要变化 |
| --- | --- |
| V1 | 建立基于 KV 的 MCP 原型，提供保存、读取、列出、删除和全量读取；同时存在伪 OAuth、查询参数 Token、全量导出和无确认删除等不安全设计。 |
| V2 | 重写 MCP 请求分发与 SSE 初始化，增加 KV 游标分页和最近日记读取；移除 V1 的伪 OAuth/导出路由，但仍保留路径 Token、全量读取和无确认删除。 |
| V3 | 接入 Workers AI 与 Vectorize；保存时按固定长度切片并生成 embedding，增加语义检索和全库重建。 |
| V4 | 保存完整 chunk 文本，改为带重叠的切片；语义结果按原始 key 去重，并在索引写入失败时抛错。 |
| V5 | 重建工具增加必填 `confirm`；删除和重建前清理一组旧向量 ID，重建条目间加入等待。 |
| V6 | 为兼容客户端 schema 缓存移除重建 `confirm`，将 embedding 模型改为 `bge-large-en-v1.5`；KV 成功后 Vectorize 失败不再让保存整体失败。 |
| V7 | 将重建 `confirm` 改为可选，兼容会发送旧字段和发送空参数的客户端；其余工具逻辑按归档注释保持 V6 行为。 |
| V8 | KV 继续作为原文数据源；新增 D1 精确短语检索和索引状态、Qwen 中文 embedding、混合排序、稳定向量 ID、分类与冷热范围、受限 key 查找、日记写入约束、管理员端点、逐 key 重建和删除确认。 |

完整且带公开安全修订说明的版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## 当前能力

- 通过 MCP 保存、按完整 key 读取和确认删除记忆。
- 为普通记忆和按日期组织的日记维护 KV、D1 与 Vectorize 索引。
- 以受限条件查找少量 key，不向普通 MCP 客户端开放无条件全库枚举。
- 组合 D1 精确短语候选与 Vectorize 语义候选，执行简单可解释的加权排序。
- 每个 key 最多返回两个 chunk，总结果最多五条。
- 记录索引的 `ok`、`pending` 或 `skipped` 状态；KV 写入成功而索引失败时明确返回 `pending`。
- 将管理员 key 分页、逐 key 重建和索引状态查询放在独立管理员 Token 后。管理员可用游标分页加逐 key 重建来编排分批恢复；代码没有隐藏的自动全库重建任务。
- 同时识别 `proj_` 和实际使用过的 `project_` 项目前缀。

## 组件职责

- **KV**：原始记忆的唯一内容源。公开源码不会让 KV 数据随代码公开。
- **D1**：保存切片正文、分类字段、内容哈希、向量 ID 清单和索引状态；也执行精确短语查询。
- **Vectorize**：保存 embedding 与少量元数据，返回语义相似候选。
- **MCP**：向客户端暴露边界明确的工具；普通工具与管理员维护端点使用不同凭据。

## 精确短语与中文语义混合检索

1. 校验 query 长度和可选分类、owner、日期过滤器。
2. D1 使用原始 query 在 chunk 文本中查找精确短语。
3. Workers AI 使用 Qwen embedding 模型生成中文查询向量，Vectorize 返回语义候选。
4. 只接受仍存在于 D1 当前索引表中的向量 ID，过滤可能的陈旧向量。
5. 合并两路候选。语义分数作为基础分，chunk 精确命中加 `2.0`，key 命中加 `0.6`，D1 精确来源再加 `0.1`。
6. 按分数排序，并限制每个 key 与最终结果数量。

这些分值是 V8 代码中的启发式规则，不是经过基准测试证明的通用最优参数。

## 脱敏运行示例

以下是使用虚构记忆时的简化返回示例。哈希、分数和错误文本用占位符表示，不是性能测试结果，也不来自生产数据。

保存成功后，KV 与检索索引都会明确返回状态：

```json
{
  "key": "project_garden-planner",
  "kv": "ok",
  "index": "ok",
  "chunks": 1,
  "model": "@cf/qwen/qwen3-embedding-0.6b",
  "contentHash": "<sha256>"
}
```

混合检索会合并 D1 精确短语候选与 Vectorize 语义候选。下面省略了仅用于排序的具体分值：

```json
{
  "query": "薄荷浇水",
  "count": 1,
  "results": [
    {
      "key": "project_garden-planner",
      "chunkIndex": 0,
      "category": "project",
      "exactMatch": true,
      "chunk": "阳台种植计划使用三个花盆。下次检查薄荷和罗勒的浇水频率，并记录日照时长。"
    }
  ]
}
```

如果 KV 已写入但 D1 或 Vectorize 索引失败，调用不会把原文保存误报为失败，而是返回待恢复状态：

```json
{
  "key": "project_garden-planner",
  "kv": "ok",
  "index": "pending",
  "error": "<sanitized index error>"
}
```

## 本地检查

需要 Node.js 20 或更高版本。本仓库的测试和配置检查不依赖第三方 npm 包。

```bash
npm test
npm run check:config
npm run check
```

## 部署一个仅含假数据的实例

以下命令只用于创建新的示例资源，不应指向现有生产资源。

1. 安装并登录 Cloudflare Wrangler。
2. 创建一个新的 KV namespace、D1 database 和 1024 维 cosine Vectorize index。
3. 复制 `wrangler.example.jsonc` 为被 `.gitignore` 排除的 `wrangler.jsonc`，并将占位 ID 替换为新建的示例资源 ID。
4. 初始化 D1 schema。
5. 分别写入普通 MCP Token 与管理员 Token。两者必须不同，且至少 24 个字符。
6. 部署后再写入仓库提供的虚构样例。

```bash
npx wrangler kv namespace create MEMORY
npx wrangler d1 create personal-ai-memory-example-db
npx wrangler vectorize create personal-ai-memory-example-index --dimensions=1024 --metric=cosine
npx wrangler vectorize create-metadata-index personal-ai-memory-example-index --property-name=cat --type=string
npx wrangler vectorize create-metadata-index personal-ai-memory-example-index --property-name=owner --type=string
npx wrangler vectorize create-metadata-index personal-ai-memory-example-index --property-name=date --type=string
npx wrangler d1 execute personal-ai-memory-example-db --remote --file=./migrations/0001_schema.sql
npx wrangler secret put AUTH_TOKEN
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

Vectorize 的 metadata index 创建是异步操作，应在写入示例向量之前确认 `cat`、`owner` 和 `date` 三个索引已经可用。日期按 `YYYY-MM-DD` 保存，因此字符串范围过滤与时间顺序一致。

PowerShell 示例：

```powershell
$env:SAMPLE_AUTH_TOKEN = "replace-with-the-same-development-token"
npm run seed:sample -- https://your-new-worker.example.workers.dev/mcp
Remove-Item Env:SAMPLE_AUTH_TOKEN
```

`seed:sample` 只从环境变量读取 Token，并通过 `Authorization: Bearer` 请求头发送。它不会把 Token 写入 URL 或仓库文件。示例数据位于 [examples/sample-data.json](examples/sample-data.json)，内容均为虚构。

## 安全边界

- `key` 最长 200 字符，`value` 最长 100,000 字符，`query` 最长 500 字符。
- 普通 key 查找最多返回 20 条，混合检索最多返回 5 个 chunk，最近日记最多 30 天。
- 服务拒绝 `/mcp/<token>`；唯一支持的 MCP 鉴权方式是 `Authorization: Bearer`。
- `AUTH_TOKEN` 与 `ADMIN_TOKEN` 必须通过 Cloudflare Secrets 配置，不能写入 JSONC 或源码。
- 本实现没有内置速率限制、配额、审计日志、OAuth 授权服务器或多租户隔离。部署者必须自行配置 Cloudflare Access、WAF/Rate Limiting 或等效控制。

更多说明见 [SECURITY.md](SECURITY.md)。

## 已知限制

- KV 与 D1/Vectorize 之间不是跨服务事务；索引失败会标记 `pending`，需要管理员后续逐 key 重建。
- 向量先写入、D1 后提交时，极端失败可能留下 D1 不再引用的孤立向量；检索会用 D1 当前记录过滤它们，但仍需维护性清理。
- D1 的 `lower()` 对非 ASCII 大小写折叠能力有限；中文精确短语不受此问题影响。
- 分类依赖 key 命名约定，不是独立的内容理解模型。
- 管理员端点提供游标分页与逐 key 重建原语，没有队列、定时器或自动批处理执行器。
- CORS 只回显配置中的单一 `ALLOWED_ORIGIN`；非浏览器 MCP 客户端通常不依赖 CORS。
- 代码以 Cloudflare 绑定 API 为运行环境，仓库测试主要覆盖纯函数与公开安全约束，不模拟完整云服务。

## 许可

归档审计未发现第三方源码声明、仓库链接、作者署名或上游许可证头。公开版采用 MIT License，版权主体使用 GitHub 用户名 `camellia041002`。Cloudflare 产品名和模型名仅用于描述运行依赖，不表示相关服务代码包含在本仓库中。
