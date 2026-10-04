# V9 第一阶段本地实现说明

> 当前状态：仅完成本地实现和合成数据测试，尚未迁移生产数据库、回填真实 key、部署或启用生产流量。

V9 第一阶段在 V8 的 KV 原文、D1 chunk 和 Vectorize 索引之上增加独立客户端与 access space。`owner` 仍然只是由 key 推导的语义元数据，不作为权限边界；权限由 `client_id`、space grant 和 capability 共同决定。

本地构建和测试要求 Node.js 22 或更高版本；Worker 的生产运行环境仍由 Cloudflare compatibility 配置决定。

## Feature flags

- `V9_AUTH_MODE=off`：保持 V8 工具、认证、搜索输出和失败语义；不会查询 V9 表。
- `V9_AUTH_MODE=shadow`：旧 `MEMORY_TOKEN` Bearer 与秘密 URL 继续保持完整 V8 行为；独立客户端 Token 才执行 space 隔离。
- `V9_RECALL_ENABLED=false`：独立客户端不暴露 `recall_memory` 与 `report_recall_feedback`。
- `V9_RECALL_ENABLED=true`：在 `shadow` 下为具有 `recall` grant 的独立客户端开放两个工具。

本阶段没有实现 `enforce`。独立 Token 不代表旧共享 Token 已被隔离；旧通道仍是兼容通道。

## 数据模型

`0002_v9_access_spaces.sql` 只做增量修改：

- `memory_spaces`：可配置的授权空间；migration 只预置 `shared`、`admin`、`legacy-unclassified` 三个通用 space。
- `api_clients`：调用主体，只保存 Token 的 SHA-256 哈希。
- `api_client_space_grants`：一个 client 在一个 space 上的一项 `read`、`recall`、`write` 或 `delete` capability。
- `memory_key_spaces`：不修改 KV key 或正文的显式 key-to-space 映射。
- `recall_events`：服务端实际返回候选的事件，绑定 client、space 和内容版本。
- `recall_feedback`：按 `(event_id, signal, evidence)` 幂等记录；第一阶段不参与排序。

创建新 key 时先以 insert-only 方式确定 space，再写 KV，避免两个 space 并发抢占同一个 key。若 KV 写入失败，映射会作为 fail-closed 的名称保留：原 space 可直接重试，管理员也可用带原 space 确认值的单 key 转移接口恢复；系统不会自动删除它，以免和同 space 的并发写入发生竞态。

shadow 模式下的独立客户端写入/删除、legacy 写入/删除、管理员 reindex 和单 key 转移共用 D1 短租约；同一 key 的这些操作不会并行执行。异常退出遗留的租约十分钟后可被下一次操作替换，期间保持 fail-closed。日记同日冲突只在目标 space 内计算，不向一个 isolated client 暴露其他 space 的条目；但 KV key 仍是全局命名空间。若两个 space 生成完全相同的 daily key（同 owner、日期和 note），后写入会安全拒绝，第一阶段不会通过改写 KV key 来制造第二个副本。
- `memory_chunks.space_id`、`memory_index_state.space_id`：供新索引写入携带 space 元数据，不改变切片算法、`INDEX_VERSION` 或 vector ID。

没有显式映射的旧 key 在授权判断中视为 `legacy-unclassified`，但 migration 不自动猜测或物化真实归属。

## MCP 行为

独立客户端由 Bearer Token 认证。`tools/list` 只列出它至少具有一项对应 capability 的工具，`tools/call` 再做一次最终校验。读取完整 key、精确检索、D1 当前 chunk 校验和 Vectorize 候选都会按服务端保存的 space 映射过滤；模型传入的 `owner`、`category` 或 `spaceKey` 不能替代 grant。

独立客户端写入新 key 时，`save_memory` 和 `save_daily` 必须明确提供 `spaceKey`。覆盖已有 key 时必须保留原 space；space 转移只能通过管理员接口进行。

`recall_memory` 最多返回两个完整 V8 chunk。模型根据当前上下文决定是否提及候选。它只读取 D1 当前 chunk，不读取或拼接整篇 KV 原文，也不拼接相邻 chunk。事件使用单次 D1 batch 写入；任一写入失败时仍返回候选，但所有 `eventId` 均为 `null`，顶层 `tracking` 为 `degraded`。精确或语义单路失败时返回 `retrieval.status=partial`；双路都失败时为 `error`。

`report_recall_feedback` 只接受同一 client 收到的 event，并要求该 client 仍具有该 space 的 `recall` capability。`wrong` 等信号只记录，不改原文、元数据或排序。当前 chunk 的内容哈希或 index version 改变后，旧 event 的反馈会标记为 `stale`。

## 最小管理接口

以下接口均为 `POST`，继续使用现有 `ADMIN_TOKEN` Bearer 保护，并且不会返回记忆正文：

| 路径 | 用途 |
| --- | --- |
| `/admin/v9/clients/create` | 创建客户端，要求 `confirmCreate=true`；仅本次响应返回明文 Token |
| `/admin/v9/clients/list` | 列出客户端，不返回 Token 或哈希 |
| `/admin/v9/clients/revoke` | 撤销客户端，要求 `confirmClientId` |
| `/admin/v9/spaces/create` | 创建 `private` 或 `custom` space，要求 `confirmSpaceKey` |
| `/admin/v9/spaces/list` | 列出 space |
| `/admin/v9/spaces/disable` | 禁用非保留 space，要求 `confirmSpaceKey` |
| `/admin/v9/grants/create` | 授予 capability，要求 `confirmGrant=clientId:spaceKey:capability` |
| `/admin/v9/grants/list` | 列出 grant，可按 client 过滤 |
| `/admin/v9/grants/revoke` | 撤销 grant，要求 `confirmGrant=clientId:spaceKey:capability` |
| `/admin/v9/key-space/get` | 查询一个 key 的映射；未映射时报告 `legacy-unclassified` |
| `/admin/v9/key-space/assign` | 显式分配或转移，要求 `confirmKey`，转移还要求 `confirmFromSpaceKey` |
| `/admin/v9/key-space/dry-run-prefix` | 只返回前缀命中数量，不返回 key 或正文，不执行批量写入 |

第一阶段有意没有实现批量物化映射。管理员必须逐 key 显式分配；前缀接口仅用于 dry-run 评估。

## 旧索引迁移计划

本轮不连接生产。未来启用前应按以下顺序在单独审批下执行：

1. 先运行 D1 migration，保持 flags 为 `off`。
2. 核验 migration 后切到 `shadow`；此时旧 Bearer 与秘密 URL 仍走 V8 兼容通道，且尚无独立 client 可以登录。
3. 使用 `ADMIN_TOKEN` 创建 space、client 和 grant，只把一次性返回的 client Token 配给测试客户端。
4. 只根据已确认规则物化 `memory_key_spaces`；歧义 key 保持 `legacy-unclassified`。
5. 对已确认映射的 key 调用现有单 key reindex，使 Vectorize metadata 写入 `space`。这不会改变 KV 原文、切片算法、index version 或 vector ID。
6. 核对 D1 映射、当前 chunk 与向量 metadata 后，再让测试 client 发起只读请求。

即使旧向量尚未补 `space` metadata，独立客户端的 D1 当前 chunk 校验仍会阻止跨 space 返回；代价是这部分旧记忆在完成 reindex 前可能缺少语义命中。不要直接批量猜测归属。

## 回退

将 `V9_AUTH_MODE` 设回 `off` 且 `V9_RECALL_ENABLED=false` 即恢复 V8 请求路径。V9 表和新增列可以保留，不需要删除数据；本阶段没有提供或要求破坏性 down migration。
