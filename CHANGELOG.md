# Changelog

本记录来自私人归档中保存的 V1—V8 源码与随附说明。V1—V7 的完整原始源码不进入公开仓库；日期仅在归档或项目背景能够证明时列出。

## Unreleased

- 将项目定位改为不绑定单一 AI 的外置 MCP 记忆系统：一个 AI 可独立使用，多个客户端可选共用，并说明 key 前缀是分类而不是权限隔离。
- 新增独立 `v8` Deploy to Cloudflare 包，声明自动创建 KV、D1、Vectorize、Workers AI，部署时执行 D1 migration 并请求建立三项 metadata indexes。
- 新 V8 部署使用同一个 `MEMORY_TOKEN` 支持 Bearer 与单 URL，管理员接口继续使用独立的 `ADMIN_TOKEN`；旧 `AUTH_TOKEN` / `MCP_URL_TOKEN` 配置保持兼容。
- README 增加基于 Cloudflare 当前 1 GB KV 免费存储的条数估算，并列明每日请求、读取、写入和列表额度。
- 新增首页默认 Lite：独立的 `lite` 一键部署目录、自动 KV provisioning、单一普通权限 `MEMORY_TOKEN` 和 `workers.dev` 落地页。
- README 改为 Lite 优先的四步流程，明确无需本机 Git、Node 或域名，但 Cloudflare 部署按钮会连接使用者的 GitHub/GitLab 并在其账号创建代码副本。
- 增加 Lite 与索引版 AI 部署提示词、Cloudflare 资源、最小权限、交付清单和秘密禁区文档。
- 明确数据由使用者自己的 Cloudflare 账号控制，但 Cloudflare、AI 客户端与模型仍会在服务或调用过程中处理相关内容。
- 在保留 `/mcp` + Bearer 默认模式的同时，为三种公开 Worker 增加可选 `/mcp/<MCP_URL_TOKEN>` 便捷模式。
- `MCP_URL_TOKEN` 只从 Cloudflare Secret 读取；未配置、格式无效、路径错误或多余层级均返回 `404`，且不能访问 `/admin/*`。
- 将配置检查拆分为“模板结构有效”和“实际配置可部署”，实际模式拒绝占位符、空 ID 和明显无效的资源标识。
- 重排 README 的首次部署流程，增加客户端连接说明、跨平台 Token 生成、metadata index 确认、示例导入和部署后 smoke test。

## V8 — 2026-09-04

### Added

- 引入 D1 `memory_chunks`，用 chunk 原文支持精确短语检索。
- 引入 D1 `memory_index_state`，记录内容哈希、向量 ID、chunk 数、索引版本以及 `ok`、`pending`、`skipped` 状态。
- 使用 `@cf/qwen/qwen3-embedding-0.6b` 的 1024 维 embedding，并通过 Vectorize 查询中文语义候选。
- 合并 D1 精确候选与 Vectorize 语义候选；精确正文、key 命中和精确来源分别获得代码中明确的加分。
- 新增 `save_daily`，对 owner、日期、同日冲突和显式覆盖做约束。
- 新增 `find_memory_keys`，要求至少一个过滤条件，默认排除历史与 obsolete 项，最多返回 20 个 key。
- 新增基于 SHA-256 的稳定向量 ID、内容哈希和按 key 保存的向量 ID 清单。
- 新增独立 `ADMIN_TOKEN` 保护的 key 游标分页、逐 key 重建和索引状态查询。

### Changed

- KV 继续作为原文数据源，D1 和 Vectorize 作为可重建索引。
- 切片从固定 300/步长 200 调整为以段落和中文标点为基础、目标 650、最大 850、重叠 100 的策略。
- 搜索固定返回最多 5 个 chunk，同一 key 最多 2 个。
- 普通工具集移除无条件 `list_memories`、`get_all_memories` 和全库 `reindex_all_memories`。
- embedding 写入使用 Vectorize `upsert`，D1 更新后清理旧的多余向量 ID。

### Safety

- 删除必须提供与 key 完全一致的 `confirmKey`。
- 历史和 obsolete key 默认进入冷范围并跳过索引。
- KV 成功而索引失败时返回 `pending`，避免把原文已保存误报为整体失败。

### Public edition changes

以下变化只存在于本公开版，用于脱敏和安全发布，不反向修改生产 Worker：

- 当时移除 `/mcp/<token>` 路径 Token 兼容，只保留 `Authorization: Bearer`；后续公开版在更严格的 Secret、路径和权限约束下重新加入可选便捷模式，见 Unreleased。
- 将个人化 owner 和人物前缀改为通用 owner 规则与 `person_` 前缀。
- 同时识别 `project_` 和 `proj_`，修复归档 V8 只识别后者的问题。
- 增加 key、value、query、owner、note 和管理分页长度或数量上限。
- CORS 改为使用显式 `ALLOWED_ORIGIN`，不再默认 `*`。
- 补充公开 D1 schema、虚构样例、配置校验、纯函数测试和静态安全测试。
- 增加安全的 KV-only 与 KV+Vectorize 部署档，分别覆盖早期基础能力和中期语义检索能力；两者不是历史源码的逐字发布。
- README 增加完全虚构的保存、混合检索与 `pending` 状态返回示例。

## V7 — 2026-08

- 将 `reindex_all_memories.confirm` 从 V5 的必填字段改为可选字段。
- 归档注释明确该变化用于同时兼容会发送旧字段的客户端与发送空参数的客户端。
- 归档注释明确其余七个工具逻辑与 V6 保持一致。

## V6 — 2026-08-05

- 移除 V5 中重建工具的必填 `confirm` 字段，以绕开客户端缓存旧 schema 时的参数错误。
- embedding 模型由 `bge-base-en-v1.5` 改为 `bge-large-en-v1.5`；归档标注为 1024 维。
- 保存时 Vectorize 写入失败记录错误但不再抛出，从而保留已经成功的 KV 写入。
- 保留重叠切片、按 key 去重搜索、删除时清理向量和重建条目间等待。

## V5 — 2026-08-05

- `reindex_all_memories` 新增必填布尔 `confirm` 字段。
- 删除单条记忆时尝试清理该 key 的一组旧 chunk ID。
- 重建每个 key 前尝试清理旧向量 ID，并在条目之间等待一秒。
- 归档说明记录了部分客户端因缓存旧 MCP schema 而出现 `invalid_arguments` 的问题。

## V4 — 日期未单独记录

- Vectorize metadata 从 100 字符预览改为保存完整 chunk 文本。
- 搜索时获取两倍候选，并对同一 `sourceKey` 只保留分数最高的 chunk。
- 最终搜索结果返回 chunk 正文而非仅预览。
- 切片由无重叠的固定 300 字符改为 300 字符窗口、200 字符步长，即 100 字符重叠。
- 保存阶段 Vectorize 写入失败会继续向上抛出。

## V3 — 日期未单独记录

- 在 KV 之外接入 Workers AI 与 Vectorize。
- 保存时按 300 字符固定窗口切片并生成 embedding。
- 新增 `search_memories`，按 `topK` 返回向量相似结果。
- 新增 `reindex_all_memories`，遍历 KV 为旧数据生成索引。
- 使用 `@cf/baai/bge-base-en-v1.5`。

## V2 — 日期未单独记录

- 重写为统一的 JSON-RPC 方法分发，并为 GET 返回 SSE 初始化事件。
- 将 KV key 遍历改为游标分页，而不只读取第一页。
- 新增 `get_recent_dailies`，按 `daily_YYYYMMDD` 约定返回最近若干日期内容。
- 移除 V1 的伪 OAuth 路由和 `/export` 下载路由。
- 仍保留请求头 Token 与 `/mcp/<token>` 两种认证、全量 key/内容读取和无确认删除。

## V1 — 2026-06-22

- 以 Cloudflare Worker、KV 和 MCP 建立原型。
- 提供 `save_memory`、`get_memory`、`list_memories`、`delete_memory` 和 `get_all_memories`。
- 包含一个不校验客户端与授权码的伪 OAuth 流程，Token 端点直接返回 `AUTH_TOKEN`。
- `/export?token=...` 通过 URL 查询参数鉴权并导出当页列出的全部 KV 内容。
- 删除不要求二次确认；列表、全量读取和导出只调用一次 KV `list()`，未处理分页。
