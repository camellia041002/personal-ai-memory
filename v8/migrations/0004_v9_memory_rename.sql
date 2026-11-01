CREATE TABLE IF NOT EXISTS memory_rename_policy_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  protected_keys_ready INTEGER NOT NULL DEFAULT 0 CHECK (protected_keys_ready IN (0, 1)),
  source_version TEXT,
  source_digest TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO memory_rename_policy_state (singleton, protected_keys_ready) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS memory_rename_protected_keys (
  memory_key TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memory_rename_journal (
  operation_id TEXT PRIMARY KEY,
  old_key TEXT NOT NULL,
  new_key TEXT NOT NULL,
  space_id TEXT NOT NULL,
  client_id TEXT,
  auth_kind TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  old_vector_ids_json TEXT NOT NULL DEFAULT '[]',
  new_vector_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'committed', 'success', 'rolled_back', 'rollback_required', 'reconcile_required')),
  error_class TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  committed_at TEXT,
  completed_at TEXT,
  CHECK (old_key <> new_key),
  FOREIGN KEY (space_id) REFERENCES memory_spaces(space_id),
  FOREIGN KEY (client_id) REFERENCES api_clients(client_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_rename_old_time ON memory_rename_journal(old_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_rename_new_time ON memory_rename_journal(new_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_rename_status_time ON memory_rename_journal(status, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_rename_unresolved_old ON memory_rename_journal(old_key)
  WHERE status IN ('pending', 'committed', 'rollback_required', 'reconcile_required');
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_rename_unresolved_new ON memory_rename_journal(new_key)
  WHERE status IN ('pending', 'committed', 'rollback_required', 'reconcile_required');
