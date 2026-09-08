# personal-ai-memory

一个运行在 Cloudflare Workers 上的个人长期记忆参考实现。它适合希望让 ChatGPT、Claude、Codex 或其他 MCP 客户端跨会话保存、读取和检索个人信息，并愿意自己管理 Cloudflare 资源的人。

默认的 Hybrid V8 使用 KV 保存原文、D1 保存可核验的文本切片与索引状态、Vectorize 提供语义候选，并通过 MCP 暴露边界明确的工具。最简单的部署路线是：克隆仓库，创建一套新的 Cloudflare 资源，填写配置、设置 Secret，然后部署到自动获得的 `workers.dev` 地址；自定义域名不是必需条件。

本仓库只包含脱敏后的实现和完全虚构的示例数据。私人 V1—V7 源码、生产配置、真实数据、日志与备份均不在仓库中。

## 不懂 Cloudflare，也可以从这里开始

你不需要先理解 KV、D1、Vectorize 或 MCP。可以把这个仓库交给你信任的 AI 编程助手，并把下面这段话一起发给它：

> 请完整阅读这个仓库的 README、SECURITY、ARCHITECTURE、测试和 Worker 代码，然后帮我按 Quick Start 部署一个全新的 Hybrid V8 实例。只能创建和使用新的 Cloudflare 资源，不要连接、修改或删除我已有的 Worker、KV、D1、Vectorize、域名和数据。不要把任何 Token 写入源码、配置文件、聊天回复或日志；让我在 Wrangler 的 Secret 提示中自己输入。部署前运行测试和实际配置检查，部署后只用仓库里的虚构数据执行 smoke test。如果某一步需要我的 Cloudflare 登录或选择账号，请停下来明确告诉我。

AI 应该能够按后面的步骤完成大部分工作。你通常只需要登录 Cloudflare、确认使用哪个账号，并在安全提示中输入随机 Token。遇到错误时可以把错误信息交给 AI，但不要发送 Token、完整秘密 URL、真实记忆内容或生产资源配置。

部署完成后，你会得到一个类似 `https://<name>.<subdomain>.workers.dev` 的地址。它可以直接连接支持远程 MCP 的客户端，不要求你购买或绑定域名。

## Quick Start：从零部署 Hybrid V8

下面部署的是功能完整的 Hybrid V8。只需要基础 KV 或 KV + 语义检索时，可改用后文的轻量档位。

### 1. 准备环境并克隆

需要 Git、Node.js 20 或更高版本、Wrangler 3.71.0 或更高版本，以及一个可创建 Workers、KV、D1、Vectorize 和 Workers AI 绑定的 Cloudflare 账号。Vectorize V2 的 metadata index 命令要求 Wrangler 3.71.0+；下面统一使用 `npx wrangler@latest`，不要求全局安装 Wrangler。

```bash
git clone https://github.com/camellia041002/personal-ai-memory.git
cd personal-ai-memory
node --version
npx wrangler@latest --version
npm run check
```

`npm run check` 会运行测试和三份示例模板的结构检查，不会把仍含占位符的模板称为“可部署配置”。

### 2. 登录 Cloudflare

```bash
npx wrangler@latest login
npx wrangler@latest whoami
```

`whoami` 应显示当前账号信息。远程终端无法完成本地浏览器回调时，可使用 `npx wrangler@latest login --device`。当前命令说明见 [Wrangler authentication](https://developers.cloudflare.com/workers/wrangler/commands/general/)。

### 3. 创建全新的资源

不要把下面的示例部署绑定到已有生产资源。

这几个名字可以先简单理解为：

- **KV**：保存完整记忆原文的“主笔记本”；
- **D1**：记录文本切片和搜索状态，方便核对和恢复；
- **Vectorize**：按“意思相近”寻找内容；
- **Workers AI**：把文本转换为 Vectorize 能搜索的数字表示。

不需要手动进入 Cloudflare 网页逐项创建，下面的命令会完成创建并告诉你应复制哪些值。

```bash
npx wrangler@latest kv namespace create MEMORY
npx wrangler@latest d1 create personal-ai-memory-example-db
npx wrangler@latest vectorize create personal-ai-memory-example-index --dimensions=1024 --metric=cosine
npx wrangler@latest vectorize create-metadata-index personal-ai-memory-example-index --property-name=cat --type=string
npx wrangler@latest vectorize create-metadata-index personal-ai-memory-example-index --property-name=owner --type=string
npx wrangler@latest vectorize create-metadata-index personal-ai-memory-example-index --property-name=date --type=string
```

把命令输出对应到配置：

| 命令输出 | `wrangler.jsonc` 字段 |
| --- | --- |
| KV 创建结果中的 namespace `id` | `kv_namespaces[0].id`；`binding` 保持 `MEMORY` |
| D1 输出中的数据库名称 | `d1_databases[0].database_name` |
| D1 输出中的 UUID | `d1_databases[0].database_id`；`binding` 保持 `DB` |
| Vectorize 创建时使用的名称 | `vectorize[0].index_name`；`binding` 保持 `VECTORIZE_INDEX` |
| Workers AI | 不需要先创建资源；`ai.binding` 保持 `AI` |

Vectorize metadata index 是异步创建的。反复运行下面的准确命令，直到结果中同时出现 `cat`、`owner` 和 `date`，再导入数据：

```bash
npx wrangler@latest vectorize list-metadata-index personal-ai-memory-example-index
```

Cloudflare 说明该操作通常需要几秒，但实际应以列表结果为准：[Vectorize metadata indexes](https://developers.cloudflare.com/vectorize/get-started/intro/#4-optional-create-metadata-indexes)。

### 4. 创建并检查实际配置

Bash/macOS：

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

PowerShell：

```powershell
Copy-Item .\wrangler.example.jsonc .\wrangler.jsonc
```

编辑被 `.gitignore` 排除的 `wrangler.jsonc`，替换 KV 和 D1 占位符，并确认 Vectorize 名称与刚创建的索引一致。然后检查实际配置：

```bash
npm run check:config -- wrangler.jsonc
```

成功输出应包含 `deployable configuration valid`。占位符、空 ID、格式明显错误的 KV/D1 ID、空资源名或缺失绑定都会使命令失败。

模板维护者可以单独运行：

```bash
npm run check:config:templates
```

它只证明示例模板结构有效，不证明模板已经可以部署。

### 5. 生成 Token 并写入 Cloudflare Secrets

每个 Token 都应由至少 32 字节安全随机数生成。下面生成 64 字符十六进制值。不要把输出提交到仓库、Issue 或聊天记录。

Bash/macOS：

```bash
openssl rand -hex 32
```

PowerShell：

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
[BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
```

分别生成不同的普通 Bearer Token 和管理员 Token，通过交互提示写入；如果启用秘密 URL，它也必须使用第三个不同的随机值。不要把 Token 直接放在命令参数中：

```bash
npx wrangler@latest secret put AUTH_TOKEN --config wrangler.jsonc
npx wrangler@latest secret put ADMIN_TOKEN --config wrangler.jsonc
```

默认推荐的连接方式是：

```text
URL: https://<your-worker>.workers.dev/mcp
Authorization: Bearer <AUTH_TOKEN>
```

如果客户端只能粘贴一条 URL，可以再生成一个不同的 32 字节随机值并启用可选模式：

```bash
npx wrangler@latest secret put MCP_URL_TOKEN --config wrangler.jsonc
```

连接地址为：

```text
https://<your-worker>.workers.dev/mcp/<MCP_URL_TOKEN>
```

未设置 `MCP_URL_TOKEN` 时，这种模式完全关闭。完整秘密 URL 等同于密码，可能被 Cloudflare 请求日志、客户端配置、浏览历史、截图、报错和复制记录保存；安全性低于 Bearer 请求头。项目不支持 query parameter Token。详细边界见 [SECURITY.md](SECURITY.md)。

### 6. 初始化 D1 并部署

```bash
npx wrangler@latest d1 execute personal-ai-memory-example-db --remote --file=./migrations/0001_schema.sql --config wrangler.jsonc
npx wrangler@latest deploy --config wrangler.jsonc
```

部署成功后，Wrangler 会输出一个 `https://<name>.<subdomain>.workers.dev` 地址。自定义域名只是可选入口；以后再次运行 deploy 即可更新同一个 Worker。

### 7. 导入完全虚构的示例数据

导入脚本只使用 Bearer 请求头，不会把 Token 放进 URL。运行前把下面保留域名 `example.invalid` 替换为 Wrangler 输出的地址。

Bash/macOS：

```bash
export SAMPLE_AUTH_TOKEN='<AUTH_TOKEN>'
npm run seed:sample -- https://example.invalid/mcp
unset SAMPLE_AUTH_TOKEN
```

PowerShell：

```powershell
$env:SAMPLE_AUTH_TOKEN = '<AUTH_TOKEN>'
npm run seed:sample -- https://example.invalid/mcp
Remove-Item Env:SAMPLE_AUTH_TOKEN
```

成功时会逐条看到 `Seeded <key>`。示例源文件是 [examples/sample-data.json](examples/sample-data.json)，内容均为虚构。

### 8. 部署后 smoke test

脚本会依次初始化 MCP、列出工具、保存一条带唯一 key 的虚构记忆、精确读取、检索、确认删除，并验证删除后不可读取。运行前同样替换 `example.invalid`。

Bearer 模式，Bash/macOS：

```bash
export SMOKE_AUTH_TOKEN='<AUTH_TOKEN>'
npm run smoke -- https://example.invalid/mcp
unset SMOKE_AUTH_TOKEN
```

Bearer 模式，PowerShell：

```powershell
$env:SMOKE_AUTH_TOKEN = '<AUTH_TOKEN>'
npm run smoke -- https://example.invalid/mcp
Remove-Item Env:SMOKE_AUTH_TOKEN
```

秘密 URL 模式不需要请求头环境变量：

```bash
npm run smoke -- https://example.invalid/mcp/MCP_URL_TOKEN_VALUE
```

关键成功输出应类似：

```text
initialize: personal-ai-memory 8.0.0-public.1
tools/list: 7 tools
save_memory: kv=ok, index=ok, key=project_smoke-...
get_memory: exact content matched
search_memories: saved key found
delete_memory: deleted=true
verification: deleted key is not found
```

如果中途失败，脚本会尝试删除已经写入的虚构 key；自动清理也失败时会输出需要手动删除的 key，但不会输出连接 URL 或 Token。

### 常见错误

| 现象 | 先检查什么 |
| --- | --- |
| `/mcp` 返回 `401` | `AUTH_TOKEN` 是否已设置、客户端是否发送完全一致的 Bearer 请求头；短于 24 字符的配置会被拒绝 |
| 秘密 URL 返回 `404` | 是否已设置 `MCP_URL_TOKEN`；是否为至少 43 个 URL-safe 字符；路径不能是 `/mcp/`、不能多一层，也不能带 query Token |
| 配置检查提示 placeholder | 实际 `wrangler.jsonc` 中仍有 `<KV_NAMESPACE_ID>`、`<D1_DATABASE_ID>` 或其他占位符 |
| metadata 过滤或检索失败 | `list-metadata-index` 是否已列出 `cat`、`owner`、`date`；不要只根据创建命令已入队判断完成 |
| 向量维度不一致 | Vectorize 必须以 `--dimensions=1024` 创建，并与代码中的 Qwen embedding 模型一致；建错后应新建正确索引并更新配置 |
| 保存返回 `index: pending` | KV 原文已保存，但 D1、Workers AI 或 Vectorize 的索引阶段失败；检查绑定和 metadata indexes，再通过管理员接口逐 key 重建 |
| 索引创建仍是 pending | 等待后再次运行 `list-metadata-index`；只有三个字段都出现在列表中才继续导入和 smoke test |

## 连接客户端

Bearer、单 URL、Codex 官方配置和其他客户端的 JSON 示例集中在 [CLIENTS.md](CLIENTS.md)。文档会区分作者私人部署中的实际使用记录、官方文档确认的配置方式，以及尚未对本公开版云端部署逐一复验的示例。

## 选择适合你的版本

公开仓库提供三个能力档位。它们对应项目演进中的三个主要阶段，但都按当前安全要求重新整理；前两档不是历史源码的原样副本。

| 版本 | 依赖 | 适合场景 | 入口 |
| --- | --- | --- | --- |
| KV only | Workers + KV | 只需要按 key 保存、读取、受限查找和确认删除 | [`examples/kv-only`](examples/kv-only) |
| Vector search | Workers + KV + Workers AI + Vectorize | 需要文本切片和语义检索，但不需要 D1 精确检索与索引状态表 | [`examples/vector-search`](examples/vector-search) |
| Hybrid V8 | Workers + KV + D1 + Workers AI + Vectorize | 需要精确短语与中文语义混合检索、分类过滤、索引状态和管理员恢复能力 | [`src`](src) |

三档都支持默认 Bearer 模式和可选秘密 URL 模式，都限制输入与返回规模，都不公开无条件全库读取，并要求确认后才能删除。完整 V8 是默认推荐版本。

## 项目背景

项目源于我自己的跨会话长期记忆需求。V1 由 Claude 协助完成原型，此后在持续使用、数据增长、误修改恢复、检索准确性和权限安全问题中，借助 Claude 与 Codex 逐步迭代至 V8。需求判断、版本取舍、测试验收、部署和运行维护由我完成。

在一次有记录的 V8 迁移中，系统处理了 100+ 个 KV key，并分批重建为 300+ 个检索 chunk。这里采用区间描述，只用于解释数据增长与可恢复重建需求，不是性能基准，也不代表用户规模。

公开这个仓库，是希望给有类似需求的人一个可以理解、部署和继续修改的参考实现。它同时保留了真实项目中数据治理、异常恢复、需求拆解和技术协作的过程，但不把个人工具包装成未经验证的商业产品。

AI 在项目中承担原型生成、代码修改建议和实现辅助；功能需求、方案取舍、测试验收、线上部署与日常维护并非由模型自主完成。仓库不宣称未经源码或记录证明的性能、节省时间、用户量或招聘价值数据。

## 当前能力

- 通过 MCP 保存、按完整 key 读取和确认删除记忆。
- 为普通记忆和按日期组织的日记维护 KV、D1 与 Vectorize 索引。
- 以受限条件查找少量 key，不向普通 MCP 客户端开放无条件全库枚举。
- 组合 D1 精确短语候选与 Vectorize 语义候选，执行简单、可解释的加权排序。
- 每个 key 最多返回两个 chunk，总结果最多五条。
- 记录索引的 `ok`、`pending` 或 `skipped` 状态；KV 写入成功而索引失败时明确返回 `pending`。
- 将管理员 key 分页、逐 key 重建和索引状态查询放在独立管理员 Token 后。
- 同时识别 `proj_` 和实际使用过的 `project_` 项目前缀。

## 组件与检索流程

- **KV**：原始记忆的唯一内容源。
- **D1**：保存切片正文、分类字段、内容哈希、向量 ID 清单和索引状态，也执行精确短语查询。
- **Vectorize**：保存 embedding 与少量元数据，返回语义相似候选。
- **MCP**：向客户端暴露受限工具；普通工具与管理员维护端点使用不同权限。

搜索时，D1 精确短语查询与 Workers AI/Vectorize 语义查询并行运行。Vectorize 候选必须仍存在于 D1 当前 chunk 表中才能进入排序；合并后应用代码中明确的启发式加分、每 key 上限和最终 Top 5 上限。这些分值不是经过基准测试证明的通用最优参数。完整流程见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## V1 到 V8

| 版本 | 源码或归档可证明的主要变化 |
| --- | --- |
| V1 | 建立 KV MCP 原型，同时存在伪 OAuth、查询参数 Token、全量导出和无确认删除等不安全设计。 |
| V2 | 整理 JSON-RPC/SSE、增加 KV 游标分页和最近日记；仍保留路径 Token、全量读取和无确认删除。 |
| V3 | 接入 Workers AI 与 Vectorize，增加文本切片、语义检索和全库重建。 |
| V4 | 使用重叠切片和完整 chunk，语义结果按 key 去重。 |
| V5 | 重建增加确认字段，并在删除和重建前清理旧向量。 |
| V6 | 调整 schema 兼容性与 embedding 模型；索引失败不再让 KV 保存整体失败。 |
| V7 | 重建确认改为可选，以兼容发送旧字段或空参数的客户端。 |
| V8 | 新增 D1 精确检索与索引状态、中文 embedding、混合排序、稳定向量 ID、分类过滤、权限分离和逐 key 恢复。 |

完整且带公开安全修订说明的记录见 [CHANGELOG.md](CHANGELOG.md)，来源审计见 [AUDIT_REPORT.md](AUDIT_REPORT.md)。

## 安全边界与已知限制

- 普通 Bearer 和秘密 URL Token 都只能访问普通 MCP 工具；`/admin/*` 始终只接受独立的 `ADMIN_TOKEN` Bearer。
- `key` 最长 200 字符，`value` 最长 100,000 字符，`query` 最长 500 字符。
- 普通 key 查找最多返回 20 条，混合检索最多返回 5 个 chunk，最近日记最多 30 天。
- 本实现没有内置速率限制、配额、审计日志、OAuth 授权服务器或多租户隔离。
- KV 与 D1/Vectorize 不是跨服务事务；索引失败会标记 `pending`，需要管理员逐 key 重建。
- CORS 只回显配置中的单一 `ALLOWED_ORIGIN`；非浏览器 MCP 客户端通常不依赖 CORS。
- 仓库测试覆盖纯函数、路由鉴权、配置校验和公开安全约束，但不能替代真实 Cloudflare 账号上的端到端验证。

更多说明见 [SECURITY.md](SECURITY.md)。

## 许可

归档审计未发现第三方源码声明、仓库链接、作者署名或上游许可证头。公开版采用 MIT License，版权主体使用 GitHub 用户名 `camellia041002`。Cloudflare 产品名和模型名仅用于描述运行依赖，不表示相关服务代码包含在本仓库中。
