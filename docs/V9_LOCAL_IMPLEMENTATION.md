# V9 第一阶段实现说明（开发分支）

> 当前状态：V9-Infra 是开发中的公开功能分支，已通过合成测试，但尚未准备好作为正式版本部署。Infra 生命周期扩展见 [V9_INFRA.md](V9_INFRA.md)。

V9 的目标是让多个 AI 各自只能访问明确分配给自己的记忆区域，而不是让所有 AI 共用同一把全库钥匙。它在 V8 的 KV 原文、D1 chunk 和 Vectorize 索引之上增加独立客户端与 access space；Lite 不支持这些能力。普通用户目前不用迁移，继续使用 Lite 或 V8 即可。

这个分支已经提供默认关闭的服务端基础召回工具 `recall_memory` 和 `report_recall_feedback`，AI 必须主动调用。客户端侧在每轮对话前自动检索并注入旧内容的 Hook 或 gateway 仍在调试，尚未放进仓库；它计划随完整 V9 一起公开。V9 全部完成后计划合并进 `main`，替代 V8，不设承诺日期。

`owner` 仍然只是由 key 推导的语义元数据，不作为权限边界；权限由 `client_id`、space grant 和 capability 共同决定。

本地构建和测试要求 Node.js 22 或更高版本；Worker 的生产运行环境仍由 Cloudflare compatibility 配置决定。

## 术语

| 术语 | 含义 |
| --- | --- |
| 分区（access space） | 服务端保存的记忆区域；授权按 space 判断，而不是按 key 前缀猜测 |
| 授权（grant） | 指定 client 在一个 space 上获得 `read`、`recall`、`write` 或 `delete` 能力 |
| 借阅（borrow） | 在额外白名单和额度约束下，临时读取另一个 space 的一个 key 或少量搜索结果 |
| 回收站（recycle） | 独立客户端软删除后的可恢复记录；正文暂留在原 KV key，但普通读取不可见 |
| 兼容模式（shadow） | 旧钥匙保持 V8 全库行为，只有独立 client Token 按 space 隔离 |
| fail-closed | 状态不完整、锁冲突或审计不确定时拒绝继续，而不是放宽访问 |

## Feature flags

- `V9_AUTH_MODE=off`：保持 V8 工具、认证、搜索输出和失败语义；不会查询 V9 表。除精确值 `shadow` 外，任何其他值都会回落为 `off`。
- `V9_AUTH_MODE=shadow`：旧 `MEMORY_TOKEN` Bearer 与秘密 URL 继续保持完整 V8 行为；独立客户端 Token 才执行 space 隔离。
- `V9_RECALL_ENABLED=false`：独立客户端不暴露 `recall_memory` 与 `report_recall_feedback`。
- `V9_RECALL_ENABLED=true`：在 `shadow` 下为具有 `recall` grant 的独立客户端开放两个工具。
- `V9_INFRA_ENABLED=false`：保持此前 V9 基线行为，不查询 Infra 新表。
- `V9_INFRA_ENABLED=true`：在 `shadow` 下开放通用软删除/恢复、元数据回收站、借阅策略与审计基础；启用前必须先应用 `0003_v9_infra.sql`。

本阶段没有实现 `enforce`。独立 Token 不代表旧共享 Token 已被隔离；旧通道仍是兼容通道。

## 旧钥匙与删除行为

开启 Infra 后，两类客户端的删除语义不同：

- 旧共享 Bearer 或秘密 URL 仍走 V8 兼容通道；`delete_memory` 会彻底删除正文和派生索引，不进入回收站。
- 旧通道不能删除已经处于回收站中的 key，也看不到 `restore_memory`、`list_recycle_bin`、`borrow_memory`、`recall_memory` 或反馈工具。
- 独立客户端在具有 `delete` grant 时使用软删除，但目标 key 必须先有显式 access-space 映射；`legacy-unclassified` key 不能直接进入回收站。
- 独立客户端的软删除、恢复和借阅以及管理员永久清除都会进入逐操作审计；旧通道调用只记录按日期、入口和工具聚合的次数。两类记录都不保存记忆正文。

因此，创建独立 client Token 不会收回旧 `MEMORY_TOKEN` 的全库能力。若需要互不信任的租户隔离，当前 `shadow` 模式还不满足要求。

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

`0003_v9_infra.sql` 继续以增量方式增加客户端策略、借阅白名单、回收站、mutation/borrow/recycle-list 审计和 legacy aggregate observation 表。它不修改 KV 正文，也不自动把旧 key 分配到某个 space。

## MCP 行为

独立客户端由 Bearer Token 认证。`tools/list` 只列出它至少具有一项对应 capability 的工具，`tools/call` 再做一次最终校验。读取完整 key、精确检索、D1 当前 chunk 校验和 Vectorize 候选都会按服务端保存的 space 映射过滤；模型传入的 `owner`、`category` 或 `spaceKey` 不能替代 grant。

独立客户端写入新 key 时，`save_memory` 和 `save_daily` 必须明确提供 `spaceKey`。覆盖已有 key 时必须保留原 space；space 转移只能通过管理员接口进行。

`recall_memory` 最多返回两个完整 V8 chunk。模型根据当前上下文决定是否提及候选。它只读取 D1 当前 chunk，不读取或拼接整篇 KV 原文，也不拼接相邻 chunk。事件使用单次 D1 batch 写入；任一写入失败时仍返回候选，但所有 `eventId` 均为 `null`，顶层 `tracking` 为 `degraded`。精确或语义单路失败时返回 `retrieval.status=partial`；双路都失败时为 `error`。

`report_recall_feedback` 只接受同一 client 收到的 event，并要求该 client 仍具有该 space 的 `recall` capability。`wrong` 等信号只记录，不改原文、元数据或排序。当前 chunk 的内容哈希或 index version 改变后，旧 event 的反馈会标记为 `stale`。

## 固定限制

- 回收站记录的默认保留期是 30 天；`purge_after` 只是元数据，本分支不会自动清理。
- 借阅默认每个 client 每天 20 次，管理员可设置为 1–100 次。
- 一次借阅搜索最多返回 2 个 chunk；精确 key 借阅最多返回 1 条。
- 同一 key 的 mutation lock 租期为 10 分钟；锁未释放时保持 fail-closed。
- pending mutation audit 在至少 10 分钟后才会进入管理员 reconcile 候选。

## 管理接口

以下接口均为 `POST`，继续使用现有 `ADMIN_TOKEN` Bearer 保护，并且不会返回记忆正文：

| 路径 | 用途 |
| --- | --- |
| `/admin/v9/clients/create` | 创建客户端，要求 `confirmCreate=true`；仅本次响应返回明文 Token |
| `/admin/v9/clients/list` | 列出客户端，不返回 Token 或哈希 |
| `/admin/v9/clients/revoke` | 撤销客户端，要求 `confirmClientId` |
| `/admin/v9/client-policy/set` | 设置借阅开关、每日额度和独立 URL 鉴权策略 |
| `/admin/v9/borrow-spaces/grant` | 把一个目标 space 加入 client 的借阅白名单 |
| `/admin/v9/borrow-spaces/revoke` | 撤销一个目标 space 的借阅白名单 |
| `/admin/v9/spaces/create` | 创建 `private` 或 `custom` space，要求 `confirmSpaceKey` |
| `/admin/v9/spaces/list` | 列出 space |
| `/admin/v9/spaces/disable` | 禁用非保留 space，要求 `confirmSpaceKey` |
| `/admin/v9/grants/create` | 授予 capability，要求 `confirmGrant=clientId:spaceKey:capability` |
| `/admin/v9/grants/list` | 列出 grant，可按 client 过滤 |
| `/admin/v9/grants/revoke` | 撤销 grant，要求 `confirmGrant=clientId:spaceKey:capability` |
| `/admin/v9/key-space/get` | 查询一个 key 的映射；未映射时报告 `legacy-unclassified` |
| `/admin/v9/key-space/assign` | 显式分配或转移，要求 `confirmKey`，转移还要求 `confirmFromSpaceKey` |
| `/admin/v9/key-space/dry-run-prefix` | 只返回前缀命中数量，不返回 key 或正文，不执行批量写入 |
| `/admin/v9/audit/reconcile-pending` | 对至少 10 分钟的 pending mutation audit 做有界分类 |
| `/admin/v9/recycle/repair-active` | 有界修复 active recycle 记录残留的派生索引 |
| `/admin/v9/recycle/purge-one` | 精确确认后永久清除一个回收站记录及其正文 |

第一阶段有意没有实现批量物化映射。管理员必须逐 key 显式分配；前缀接口仅用于 dry-run 评估。

## 启用步骤（仅供开发者参考）

当前分支暂不能作为正式版本部署。未来完成发布准备后，启用顺序应为：

1. 先运行 D1 migration，保持 flags 为 `off`。
2. 核验 migration 后切到 `shadow`；此时旧 Bearer 与秘密 URL 仍走 V8 兼容通道，且尚无独立 client 可以登录。
3. 使用 `ADMIN_TOKEN` 创建 space、client 和 grant，只把一次性返回的 client Token 配给测试客户端。
4. 只根据已确认规则物化 `memory_key_spaces`；歧义 key 保持 `legacy-unclassified`。
5. 对已确认映射的 key 调用现有单 key reindex，使 Vectorize metadata 写入 `space`。这不会改变 KV 原文、切片算法、index version 或 vector ID。
6. 核对 D1 映射、当前 chunk 与向量 metadata 后，再让测试 client 发起只读请求。

即使旧向量尚未补 `space` metadata，独立客户端的 D1 当前 chunk 校验仍会阻止跨 space 返回；代价是这部分旧记忆在完成 reindex 前可能缺少语义命中。不要直接批量猜测归属。

## 回退

将 `V9_AUTH_MODE=off`、`V9_INFRA_ENABLED=false` 且 `V9_RECALL_ENABLED=false` 即恢复 V8 请求路径。V9 表和新增列可以保留，不需要删除数据；本阶段没有提供或要求破坏性 down migration。
