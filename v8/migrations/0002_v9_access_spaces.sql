CREATE TABLE IF NOT EXISTS memory_spaces (
  space_id TEXT PRIMARY KEY,
  space_key TEXT NOT NULL UNIQUE,
  space_type TEXT NOT NULL
    CHECK (space_type IN ('shared', 'private', 'admin', 'legacy_unclassified', 'custom')),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disabled_at TEXT
);

INSERT OR IGNORE INTO memory_spaces (space_id, space_key, space_type, display_name)
VALUES
  ('space-shared', 'shared', 'shared', 'Shared'),
  ('space-admin', 'admin', 'admin', 'Administration'),
  ('space-legacy-unclassified', 'legacy-unclassified', 'legacy_unclassified', 'Legacy unclassified');

CREATE TABLE IF NOT EXISTS api_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_clients_active
  ON api_clients(revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS api_client_space_grants (
  client_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  capability TEXT NOT NULL
    CHECK (capability IN ('read', 'recall', 'write', 'delete')),
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  revoked_at TEXT,
  PRIMARY KEY (client_id, space_id, capability),
  FOREIGN KEY (client_id) REFERENCES api_clients(client_id),
  FOREIGN KEY (space_id) REFERENCES memory_spaces(space_id)
);

CREATE INDEX IF NOT EXISTS idx_space_grants_active
  ON api_client_space_grants(client_id, capability, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS memory_key_spaces (
  memory_key TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  assignment_source TEXT NOT NULL
    CHECK (assignment_source IN ('explicit', 'rule', 'fallback')),
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (space_id) REFERENCES memory_spaces(space_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_key_spaces_space
  ON memory_key_spaces(space_id, memory_key);

CREATE TABLE IF NOT EXISTS memory_key_operation_locks (
  memory_key TEXT PRIMARY KEY,
  lock_id TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_key_operation_locks_expiry
  ON memory_key_operation_locks(expires_at);

ALTER TABLE memory_chunks ADD COLUMN space_id TEXT;
ALTER TABLE memory_index_state ADD COLUMN space_id TEXT;

CREATE INDEX IF NOT EXISTS idx_memory_chunks_space
  ON memory_chunks(space_id, category, owner, memory_date);

CREATE INDEX IF NOT EXISTS idx_memory_index_state_space
  ON memory_index_state(space_id, status, updated_at);

CREATE TABLE IF NOT EXISTS recall_events (
  event_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  fragment_id TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  index_version TEXT NOT NULL,
  returned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES api_clients(client_id),
  FOREIGN KEY (space_id) REFERENCES memory_spaces(space_id)
);

CREATE INDEX IF NOT EXISTS idx_recall_events_client
  ON recall_events(client_id, returned_at);

CREATE INDEX IF NOT EXISTS idx_recall_events_fragment
  ON recall_events(fragment_id, returned_at);

CREATE TABLE IF NOT EXISTS recall_feedback (
  event_id TEXT NOT NULL,
  signal TEXT NOT NULL
    CHECK (signal IN ('presented', 'engaged', 'helpful', 'dismissed', 'wrong')),
  evidence TEXT NOT NULL
    CHECK (evidence IN ('model_reported', 'user_explicit')),
  reported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, signal, evidence),
  FOREIGN KEY (event_id) REFERENCES recall_events(event_id)
);
