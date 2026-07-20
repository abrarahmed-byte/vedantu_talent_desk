CREATE TABLE IF NOT EXISTS workspace_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO workspace_settings(key, value)
VALUES ('auto_classify_new_profiles', '0');

ALTER TABLE source_records ADD COLUMN applied_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';

CREATE INDEX IF NOT EXISTS source_records_applied_idx
  ON source_records(candidate_id, applied_at DESC);
