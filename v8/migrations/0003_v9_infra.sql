CREATE TABLE IF NOT EXISTS api_client_policies (
  client_id TEXT PRIMARY KEY,
  borrow_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (borrow_enabled IN (0, 1)),
  borrow_daily_limit INTEGER NOT NULL DEFAULT 20
    CHECK (borrow_daily_limit BETWEEN 1 AND 100),
  isolated_url_auth_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (isolated_url_auth_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES api_clients(client_id)
);

CREATE INDEX IF NOT EXISTS idx_api_client_policies_url_auth
  ON api_client_policies(isolated_url_auth_enabled);

CREATE TABLE IF NOT EXISTS api_client_borrow_spaces (
  client_id TEXT NOT NULL,
  target_space_id TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  revoked_at TEXT,
  PRIMARY KEY (client_id, target_space_id),
  FOREIGN KEY (client_id) REFERENCES api_clients(client_id),
  FOREIGN KEY (target_space_id) REFERENCES memory_spaces(space_id)
);

CREATE TABLE IF NOT EXISTS memory_recycle_bin (
  deletion_id TEXT PRIMARY KEY,
  memory_key TEXT NOT NULL,
  space_id TEXT NOT NULL,
  deleted_by_client_id TEXT,
  deleted_auth_kind TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  purge_after TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  index_version TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'restored', 'purged')),
  restored_by_client_id TEXT,
  restored_at TEXT,
  purged_at TEXT,
  FOREIGN KEY (space_id) REFERENCES memory_spaces(space_id),
  FOREIGN KEY (deleted_by_client_id) REFERENCES api_clients(client_id),
  FOREIGN KEY (restored_by_client_id) REFERENCES api_clients(client_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_recycle_active_key
  ON memory_recycle_bin(memory_key) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_memory_recycle_status_purge
  ON memory_recycle_bin(status, purge_after);

CREATE TABLE IF NOT EXISTS memory_mutation_audit (
  operation_id TEXT PRIMARY KEY,
  client_id TEXT,
  auth_kind TEXT NOT NULL,
  action TEXT NOT NULL
    CHECK (action IN ('create', 'update', 'soft_delete', 'restore', 'permanent_purge')),
  memory_key TEXT NOT NULL,
  space_id TEXT,
  deletion_id TEXT,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'success', 'index_pending', 'uncertain', 'failure')),
  error_class TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (client_id) REFERENCES api_clients(client_id),
  FOREIGN KEY (space_id) REFERENCES memory_spaces(space_id),
  FOREIGN KEY (deletion_id) REFERENCES memory_recycle_bin(deletion_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_mutation_audit_pending
  ON memory_mutation_audit(status, started_at);

CREATE TABLE IF NOT EXISTS memory_borrow_audit (
  borrow_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  target_space_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('key', 'query')),
  target_key TEXT,
  query_hash TEXT,
  result_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'success', 'denied', 'failure')),
  error_class TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (client_id) REFERENCES api_clients(client_id),
  FOREIGN KEY (target_space_id) REFERENCES memory_spaces(space_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_borrow_daily_limit
  ON memory_borrow_audit(client_id, target_space_id, requested_at);

CREATE TABLE IF NOT EXISTS memory_recycle_list_audit (
  access_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  auth_kind TEXT NOT NULL,
  status_filter TEXT NOT NULL
    CHECK (status_filter IN ('active', 'restored', 'purged', 'all')),
  deleted_from TEXT,
  deleted_to TEXT,
  result_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'success', 'failure')),
  error_class TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (client_id) REFERENCES api_clients(client_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_recycle_list_audit_client_time
  ON memory_recycle_list_audit(client_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS legacy_usage_observations (
  route_kind TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  action_date TEXT NOT NULL,
  call_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (route_kind, tool_name, action_date)
);
