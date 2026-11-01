# V9-Infra public feature branch

This document describes the generic V9-Infra implementation on `codex/v9-infra`. It is a verified public feature branch, not a release or deployment guide.

## 中文摘要

V9-Infra 的目标是让不同 AI 使用独立 client Token，并只访问得到 grant 的 access space。当前分支还不能作为正式版本部署：它只提供兼容模式 `shadow`，旧钥匙仍保留 V8 全库能力；独立客户端才执行分区授权。

这个分支包含默认关闭的服务端基础召回工具，AI 需要主动调用。每轮对话前自动检索和注入旧内容的客户端 Hook 或 gateway 仍在调试，尚未放进仓库，计划随完整 V9 一起公开。V9 完成后计划合并进 `main` 并替代 V8；当前不设承诺日期。软删除只适用于已有显式 space 映射的独立客户端；旧钥匙的删除仍是永久删除。面向普通用户的说明、术语和完整接口清单见 [V9 第一阶段实现说明](V9_LOCAL_IMPLEMENTATION.md)。

## Scope

With `V9_AUTH_MODE=shadow` and `V9_INFRA_ENABLED=true`, isolated clients can use access-space grants and generic lifecycle controls:

- soft delete keeps the source body at its existing KV key while D1 stores recycle metadata and a content hash;
- active recycle records hide keys from reads, listings, recent entries, exact search, semantic search, and reindex;
- restore verifies the stored hash, rebuilds derived D1 and Vectorize state, and only then marks the recycle record restored;
- recycle listing returns metadata only and is limited to spaces where the caller currently has `delete` capability;
- cross-space borrowing requires both a per-client policy and an explicit target-space allowlist, has a daily cap, and is audited;
- mutation, borrow, recycle-list, and aggregate legacy observations are recorded without memory bodies;
- pending mutation audits and interrupted recycle cleanup have explicit administrator reconciliation operations;
- permanent deletion is an exact, confirmed single-record administrator action. `purge_after` is retention metadata only; this branch does not schedule automatic purge.
- `rename_memory` changes one ordinary key without changing its body or access space. It requires an explicit source mapping, same-space `write` and `delete` grants, an initialized protected-key list, an unused target, two mutation locks, and a durable rename journal. Daily, event, non-archive history, recycled, protected-prefix, and protected exact keys fail closed.

Isolated URL authentication is default-off per client and requires both the Infra flag and an explicit policy allow. Bearer authentication remains the preferred isolated-client route.

## Data and migration

`migrations/0003_v9_infra.sql` is additive and follows the public `0002` baseline. It creates generic policy, borrow-scope, recycle, audit, and aggregate-observation tables. `migrations/0004_v9_memory_rename.sql` adds only generic rename policy, protected-key, and journal state and starts with rename protection disabled. Neither migration replays environment-specific history or contains deployment-specific client roles or resource identifiers.

The feature flag must remain off until the migration is applied. With `V9_INFRA_ENABLED=false`, the Worker uses the earlier V9 authentication query and does not require the new tables, preserving the existing V8/V9-baseline contract. The V8 deploy script applies every bundled migration, including `0002` and `0003`; creating those tables does not enable V9 while all V9 flags remain off.

## Consistency boundary

KV, D1, and Vectorize do not provide a shared transaction. The implementation therefore uses a fail-closed state machine:

1. D1 records a pending mutation and active recycle marker.
2. The active marker immediately hides the key across all read paths.
3. Derived index removal or rebuilding runs while the key stays hidden.
4. D1 records success only after the required derived work completes.
5. Pending reconciliation and recycle repair classify or repair interrupted work.

Rename follows the same boundary: it creates and indexes the target before committing the authoritative D1 mapping change, then removes the old KV/vector artifacts. Interrupted pre-commit work is rolled back; interrupted post-commit cleanup remains hidden behind an unresolved journal record until the confirmed administrator reconcile operation finishes it.

This prevents a half-restored key from becoming visible, but it is not distributed atomicity. Administrators must use the explicit repair, rename reconcile, or exact purge endpoint when an interrupted operation needs attention.

## Deliberate exclusions

This branch does not include deployment-specific identities or configuration, credentials, resource bindings, real memory data, or automatic retention purge. Client-side per-turn recall and injection, V9.2 surfacing, and V9.3 installation and release packaging are not yet in the repository; they remain under development for the complete V9 release path.
