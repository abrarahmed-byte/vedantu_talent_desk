CREATE TABLE IF NOT EXISTS candidate_identities (
  identity_type TEXT NOT NULL,
  identity_value TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(identity_type, identity_value),
  FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS candidate_identities_candidate_idx
  ON candidate_identities(candidate_id);

CREATE TABLE IF NOT EXISTS candidate_profiles (
  candidate_id TEXT PRIMARY KEY,
  standardized_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_connections (
  source_id TEXT PRIMARY KEY,
  spreadsheet_id TEXT NOT NULL,
  sheet_url TEXT NOT NULL,
  tab_name TEXT NOT NULL DEFAULT '',
  mapping_json TEXT NOT NULL DEFAULT '{}',
  last_cursor INTEGER NOT NULL DEFAULT 2,
  last_row_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS source_connections_sheet_idx
  ON source_connections(spreadsheet_id, tab_name);

CREATE TABLE IF NOT EXISTS source_records (
  source_id TEXT NOT NULL,
  source_row_key TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  row_fingerprint TEXT NOT NULL,
  duplicate_kind TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(source_id, source_row_key),
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE,
  FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS source_records_candidate_idx
  ON source_records(candidate_id, source_id);

CREATE TABLE IF NOT EXISTS sync_job_stats (
  job_id TEXT PRIMARY KEY,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  updated_rows INTEGER NOT NULL DEFAULT 0,
  merged_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  duplicates_within_source INTEGER NOT NULL DEFAULT 0,
  duplicates_central INTEGER NOT NULL DEFAULT 0,
  skipped_rows INTEGER NOT NULL DEFAULT 0,
  error_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(job_id) REFERENCES sync_jobs(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO candidate_identities(identity_type, identity_value, candidate_id)
SELECT 'email', lower(trim(email)), id FROM candidates WHERE trim(email) <> '';

INSERT OR IGNORE INTO candidate_identities(identity_type, identity_value, candidate_id)
SELECT 'phone', replace(replace(replace(replace(replace(trim(phone), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), id
FROM candidates WHERE trim(phone) <> '';

INSERT OR IGNORE INTO access_users(email, display_name, role, active)
VALUES ('abrar.ahmed@vedantu.com', 'Abrar Ahmed', 'Admin', 1);
