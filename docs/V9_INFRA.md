# V9-Infra public feature branch

This document describes the generic V9-Infra implementation on `codex/v9-infra`. It is a verified public feature branch, not a release or deployment guide.

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

Isolated URL authentication is default-off per client and requires both the Infra flag and an explicit policy allow. Bearer authentication remains the preferred isolated-client route.

## Data and migration

`migrations/0003_v9_infra.sql` is additive and follows the public `0002` baseline. It creates generic policy, borrow-scope, recycle, audit, and aggregate-observation tables. It does not replay any private migration history and contains no private client roles or production identifiers.

The feature flag must remain off until the migration is applied. With `V9_INFRA_ENABLED=false`, the Worker uses the earlier V9 authentication query and does not require the new tables, preserving the existing V8/V9-baseline contract.

## Consistency boundary

KV, D1, and Vectorize do not provide a shared transaction. The implementation therefore uses a fail-closed state machine:

1. D1 records a pending mutation and active recycle marker.
2. The active marker immediately hides the key across all read paths.
3. Derived index removal or rebuilding runs while the key stays hidden.
4. D1 records success only after the required derived work completes.
5. Pending reconciliation and recycle repair classify or repair interrupted work.

This prevents a half-restored key from becoming visible, but it is not distributed atomicity. Operators must keep the explicit repair and exact purge procedures available.

## Deliberate exclusions

This branch does not include private identities, production configuration, credentials, deployment bindings, real memory data, automatic retention purge, V9.1 recall tuning, V9.2 surfacing, or V9.3 installation and release packaging.
