# Public project status

- Last verified: 2026-10-30
- Branch: `codex/v9-infra`
- Module: V9-Infra only
- Status: development public feature branch verified; not ready for deployment and not merged or released
- Base: public V9 access-space checkpoint `d28f70c`
- Scope: generic access-space authorization, soft delete and restore, mutation and borrow audits, pending reconciliation, metadata-only recycle listing, explicit permanent purge, and additive migration `0003_v9_infra.sql`
- Excluded from this branch: deployment-specific identities and configuration, credentials, resource identifiers, real memory data, and automatic retention purge; client-side per-turn recall/injection, V9.2 surfacing, and V9.3 release packaging are still in development for the complete V9 path
- Verification: `npm run check`, Worker syntax, migration foreign-key tests, configuration validation, public-safety scans, and `git diff --check`
- Recall boundary: default-off server tools `recall_memory` and `report_recall_feedback` are present; automatic per-turn client recall and injection are still being tuned and are planned to ship with complete V9 before V9 replaces V8 on `main`
