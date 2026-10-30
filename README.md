# personal-ai-memory

**让想留下的记忆，不再困在某一个应用里。**

一个简单、可自部署的外置记忆库。部署在你自己的 Cloudflare
账号中，供获得授权的 AI 客户端使用。

每条记忆都有一个 key，可以把它理解成文件名。AI 可以在获得授权后保存、读取、查找或删除你指定的记忆。你可以只让一个 AI 使用，也可以让多个支持远程 MCP 的客户端共用同一份记忆。

它不会自动读取聊天记录；只有当 AI 调用记忆工具时，系统才会保存或返回你指定的内容。

基础版部署在**你自己的 Cloudflare 账号**中：不用买服务器，不用买域名，也不用在电脑上安装开发工具。准备一个 GitHub 账号和一个 Cloudflare 账号，跟着下面四步即可。

## 项目概览

- **两个可部署版本：** Lite 面向第一次使用或记忆量较少的用户；Hybrid V8 面向需要语义检索、精确短语检索和索引恢复能力的用户。
- **核心设计原则：** 原文优先保全、索引失败可恢复、精确与语义检索可组合、普通工具与管理权限分离。
- **真实迁移验证：** 已完成 100 余条有效记录迁移，并重建为 300 余个文本切片；通过数量核对、抽样命中与索引状态检查验证迁移结果。
- **当前验证状态：** Lite 已完成真实部署验证；V8 部署配置已通过检查和 `dry-run`，完整端到端验证仍在补充。
- **进一步了解：** [架构说明](ARCHITECTURE.md) · [V1 至 V8 演进](docs/EVOLUTION.md) · [安全说明](SECURITY.md) · [公开审计](AUDIT_REPORT.md)

> 如果只想快速使用，可以直接继续下面的“四步完成”；需要语义检索、恢复机制或了解设计取舍时，再查看 V8 与相关文档。

## 四步完成

### 1. 注册或登录 Cloudflare

打开 [Cloudflare](https://dash.cloudflare.com/sign-up)，使用免费账号即可开始。你还需要登录自己的 GitHub；部署过程中 Cloudflare 会在你的 GitHub 账号里创建一份代码副本。

### 2. 点击部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/camellia041002/personal-ai-memory/tree/main/lite)

按照页面提示授权 Cloudflare 创建新项目和 KV 存储空间即可，不需要自己创建或绑定资源。

### 3. 填入 `MEMORY_TOKEN`

在部署页面找到 `MEMORY_TOKEN`，填入一个专门为这个记忆库生成的 64 个字符的随机字母数字串。可以直接用密码管理器的“生成密码”功能。

> **`MEMORY_TOKEN` 就是你家钥匙。拿到它的人可以读写你的记忆。不要发到群里，不要截图，不要提交到代码，也不要使用 Cloudflare API Token 或账号密码代替它。**

[没有密码管理器时，查看安全生成方法](docs/GENERATE_TOKEN.md)。

### 4. 复制地址，贴进 AI 客户端

部署完成后，Cloudflare 会给你一个类似下面的地址：

```text
https://你的项目名.你的子域名.workers.dev
```

如果 AI 客户端只让你粘贴一个地址，就填：

```text
https://你的项目名.你的子域名.workers.dev/mcp/你的MEMORY_TOKEN
```

如果客户端支持单独填写 Bearer Token，使用根地址加 `/mcp`，并把 `MEMORY_TOKEN` 填到 Bearer Token 输入框。这种方式更不容易把钥匙留在网址记录里。

[查看 ChatGPT、Claude、Codex 和通用客户端连接示例](CLIENTS.md)。并非每个客户端或账号套餐都支持远程 MCP，请以客户端当前功能为准。

## 怎么知道成功了

先在浏览器打开 Cloudflare 给出的、不含 token 的根地址。看到 `personal-ai-memory Lite is running` 就表示服务已启动。

把连接地址添加到 AI 客户端后，可以对 AI 说：

```text
请把“我喜欢用深色模式”保存为一条测试记忆，然后读取它给我看，最后删除这条测试记忆。
```

能完成保存、读取和删除，基本流程就通了。

## 它能做什么

- 保存一条你主动提供的记忆；
- 用完整名称读取记忆；
- 按记忆名称（key）的关键词或前缀查找最多 20 个 key；
- 在再次确认名称后删除记忆；
- 给一个支持远程 MCP 的 AI 增加长期记忆；
- 需要时，让多个 AI 客户端连接同一份记忆。

如果多个 AI 共用，可以用 key 前缀整理来源或用途，例如 `shared_`、`chatgpt_`、`claude_`。前缀只是分类，不是权限隔离：连接同一地址和钥匙的客户端，原则上都能访问这份记忆。需要真正隔离时，应分别部署记忆库或使用不同的访问控制。

> **重要：** 使用相同 key 再次保存会替换原有内容。Lite 没有版本历史或撤销功能；重要内容请使用新 key 保留旧版本，或另行备份。

## 它不是什么

- 不会自动读取所有聊天记录；
- 不会自动理解和整理你的一切；
- 不是聊天记录同步或完整备份工具；
- 没有多人账号、审计日志或端到端加密；
- 基础版不会按“意思相近”搜索正文。

第一次使用先确认“保存和读取”是否真的对你有用。

## Lite 和 V8 怎么选

这是现在真正可以选择部署的两个版本。

| 对比 | Lite | V8 |
| --- | --- | --- |
| Cloudflare 资源 | Worker + KV | Worker + KV + D1 + Vectorize + Workers AI |
| 所需密钥 | 1 个 `MEMORY_TOKEN` | `MEMORY_TOKEN` + `ADMIN_TOKEN` |
| 额外设置 | 基本没有 | 手填 `1024`、`cosine`，等待 metadata indexes 建立 |
| 查找方式 | 完整 key，或 key 的关键词和前缀 | 正文含义、精确短语、日期和分类 |
| 维护难度 | 低，没有索引 | 较高，需要关注索引状态和恢复 |
| 适合谁 | 第一次使用、记忆量较少 | 记忆较多、需要模糊搜索和恢复能力 |
| 部署入口 | 使用上面的默认按钮 | [打开 V8 部署说明](v8/README.md) |

简单来说：**Lite 更容易部署；V8 更容易从较多记忆中找到真正想要的内容。**

V8 现在有独立的 Deploy to Cloudflare 按钮，代码入口就是 [`v8`](v8)。受 Cloudflare 当前部署页限制，它还需要额外填写 Vectorize 的 `1024` 和 `cosine` 两个固定值。该按钮已通过本地配置检查和 dry-run，但尚未完成全新资源的端到端测试。详细资源和操作说明见[进阶版本](docs/ADVANCED.md)。

V9 正在开发中，目标是让多个 AI 各自只能访问明确分配给自己的记忆区域。当前公开功能分支已经包含默认关闭的基础召回工具，但需要 AI 主动调用。每轮对话前自动检索并注入旧内容的机制仍在调试，尚未放进仓库；V9 全部完成后（包括这部分）计划合并进 `main`，替代 V8。在那之前，普通用户继续使用 Lite 或 V8 即可；开发者可查看 [V9 第一阶段实现说明](docs/V9_LOCAL_IMPLEMENTATION.md) 和 [版本管理](docs/VERSIONING.md)。

## 从 Lite 升级到 V8

> [!WARNING]
> **已经在用 Lite 时，不要把 V8 按钮新建的空 KV 当成原来的记忆库。** 刚部署后看不到旧记忆，不代表记忆丢失；新 V8 Worker 只是还没有绑定到原来的 KV。

升级前先确认 Lite 和 V8 位于同一个 Cloudflare 账号，并记下 Lite Worker 的 `MEMORY` 当前绑定的是哪个 KV。不要删除原 Lite Worker 或原 KV。

1. 打开 [`v8` 部署说明](v8/README.md)，完成 V8 部署以及 Vectorize 的 `1024`、`cosine` 设置。部署按钮会先为 V8 创建一个新的空 KV，这是正常现象。
2. 在 Cloudflare 控制台打开新建的 V8 Worker，进入 **Settings → Bindings**，找到名称为 `MEMORY` 的 KV namespace binding，把它改为原 Lite Worker 使用的那个 KV，然后保存并部署。只更换它指向的 KV，不要修改绑定名称 `MEMORY`。

> 如果以后还会从按钮创建的 GitHub 仓库重新部署 V8，不要只改控制台：还应在你自己仓库的 `v8/wrangler.jsonc` 中，为 `MEMORY` 填入原 Lite KV 的 namespace ID。否则后续部署可能重新应用自动创建资源时的绑定。每次重新部署后，都应回到 **Settings → Bindings** 确认 `MEMORY` 仍指向原 KV。

3. 用 V8 的 `ADMIN_TOKEN` 调用 `POST /admin/keys`，列出原 KV 中的 key。一次最多请求 1,000 条；如果返回的 `listComplete` 是 `false`，把响应中的 `cursor` 放进下一次请求，继续读取下一页。

```http
POST https://你的V8地址/admin/keys
Authorization: Bearer 你的ADMIN_TOKEN
Content-Type: application/json

{"limit":1000}
```

下一页的请求体示例：

```json
{"limit":1000,"cursor":"上一页返回的cursor"}
```

4. 返回结果中 `index` 为 `false` 的归档或历史 key 是 V8 有意不索引的内容，不需要处理。对每个 `index` 为 `true` 的 key，逐一调用 `POST /admin/reindex-key`。它会读取原 KV 中的正文，并把 V8 需要的切片和索引补到 D1 与 Vectorize；不会改写原 KV 里的记忆正文。

```http
POST https://你的V8地址/admin/reindex-key
Authorization: Bearer 你的ADMIN_TOKEN
Content-Type: application/json

{"key":"要补索引的完整key"}
```

每个可索引 key 返回 `"index":"ok"` 才表示该条索引完成；空内容返回 `"index":"skipped"` 属于预期结果。某一条失败时可以只重试那一个 key，原 KV 中的正文仍会保留。

5. 全部处理后，用空 JSON 请求体 `{}` 调用 `POST /admin/index-status` 检查索引状态，再用 V8 的读取和搜索工具抽查几条旧记忆。确认旧 key 能读取、正文搜索能命中后，再把 AI 客户端连接地址改为 V8。
6. 客户端切到 V8 后，再执行一遍 `/admin/keys`，并对所有 `index` 为 `true` 的 key 重跑 `/admin/reindex-key`，补上升级期间仍由 Lite 写入或更新的记忆。key 较多时应分批处理；失败的 key 单独重试。

旧 Lite Worker 和按钮新建的空 KV 是否删除，可以等以上检查全部完成后再决定。

`ADMIN_TOKEN` 只能用于 `/admin/*` 管理接口，不要放进 AI 客户端，也不要截图、提交到代码或贴到公开聊天中。

## 从 V1 到 V8

项目最初只是一个使用 Worker 和 KV 的简单原型。在持续使用和迭代中，项目逐步处理了分页遗漏、检索不准、索引失败、误覆盖风险和权限过宽等问题，最后演进到 Hybrid V8。

V8 的变化不是单纯堆技术名词，而是五件用户能感受到的事：

1. 从“必须记得 key”升级为“可以按正文意思查找”。
2. 从只保存和读取全文，升级为重叠切片、精确短语和语义混合检索。
3. 增加专门的日记保存和近期日记读取。
4. 索引失败时优先保住原文，标记为待处理，之后可以检查和修复。
5. 缩小普通 AI 的权限：取消无条件全量读取，限制返回数量，删除需要确认，管理权限单独隔离。

> **V1 只是历史起点。** 它存在明显安全缺陷，源码没有公开，也不是现在可部署的基础版。当前应在 Lite 和 V8 之间选择。

[查看完整的 V1/V8 工具变化和设计演进](docs/EVOLUTION.md)。

## 数据在哪里

服务代码和存储空间位于使用者自己的 Cloudflare 账号中，不在项目作者的服务器里。项目作者不会因为你部署了这个仓库，就自动获得你的地址、密钥或记忆。

但这不代表数据绝不经过第三方：Cloudflare 负责运行和存储；当 AI 调用工具时，AI 客户端和模型会看到本次请求及返回的记忆。请只保存你愿意交给这些服务处理的内容。

## 费用

按 Cloudflare 当前免费额度，Lite 使用的 KV 在一个账号中共有 **1 GB** 存储，每天包含 **100,000 次读取、1,000 次写入和 1,000 次列表请求**；Worker 本身每天包含 **100,000 次请求**。日常个人记忆通常够用，但不是“永久无限免费”的承诺。

粗略换算：如果每条记忆连同 key 平均约 2 KB，1 GB 大约能放 50 万条；平均约 10 KB，大约能放 10 万条。实际数量会受 UTF-8 编码、key、元数据和同账号其他 KV 数据影响，所以这只是量级估算，不是容量保证。

额度会调整，请以 Cloudflare 的 [KV 限制](https://developers.cloudflare.com/kv/platform/limits/)、[KV 定价](https://developers.cloudflare.com/kv/platform/pricing/)和 [Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/)为准。V8 还会使用语义索引和模型额度，具体见[进阶版本](docs/ADVANCED.md)。

## 想让 AI 帮你部署

把[这段 Lite 部署提示词](docs/AI_DEPLOY_LITE.md)交给你信任的 AI 助手。它会要求 AI 只创建新资源、使用虚构内容测试，并且绝不读取或打印你的密钥。

完整安全说明见 [SECURITY.md](SECURITY.md)。项目采用 [MIT License](LICENSE)。
