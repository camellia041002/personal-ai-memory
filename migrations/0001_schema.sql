CREATE TABLE IF NOT EXISTS memory_chunks (
  vector_id TEXT PRIMARY KEY,
  memory_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  category TEXT NOT NULL,
  owner TEXT NOT NULL,
  memory_date TEXT,
  content_hash TEXT NOT NULL,
  index_version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_key
  ON memory_chunks(memory_key);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_filters
  ON memory_chunks(category, owner, memory_date);

CREATE TABLE IF NOT EXISTS memory_index_state (
  memory_key TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  owner TEXT NOT NULL,
  memory_date TEXT,
  content_hash TEXT,
  vector_ids_json TEXT NOT NULL DEFAULT '[]',
  chunk_count INTEGER NOT NULL DEFAULT 0,
  index_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'pending', 'skipped')),
  error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memory_index_state_status
  ON memory_index_state(status, updated_at);
