CREATE TABLE IF NOT EXISTS ai_batches (
  id TEXT PRIMARY KEY,
  openai_batch_id TEXT NOT NULL UNIQUE,
  input_file_id TEXT NOT NULL,
  output_file_id TEXT NOT NULL DEFAULT '',
  error_file_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'validating',
  request_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS ai_batches_status_idx
  ON ai_batches(status, updated_at);

CREATE TABLE IF NOT EXISTS ai_extraction_jobs (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL DEFAULT 'batch',
  status TEXT NOT NULL DEFAULT 'queued',
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  resume_url TEXT NOT NULL,
  resume_fingerprint TEXT NOT NULL DEFAULT '',
  resume_file_id TEXT NOT NULL DEFAULT '',
  resume_filename TEXT NOT NULL DEFAULT '',
  resume_mime_type TEXT NOT NULL DEFAULT '',
  claims_json TEXT NOT NULL DEFAULT '{}',
  batch_id TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_jobs_status_idx
  ON ai_extraction_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS ai_jobs_candidate_idx
  ON ai_extraction_jobs(candidate_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_jobs_batch_idx
  ON ai_extraction_jobs(batch_id);

CREATE TABLE IF NOT EXISTS candidate_ai_profiles (
  candidate_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'completed',
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  resume_fingerprint TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  canonical_json TEXT NOT NULL DEFAULT '{}',
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS candidate_ai_facts (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  category TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  display_value TEXT NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('supported', 'claim_only', 'contradicted')),
  form_claimed INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_facts_lookup_idx
  ON candidate_ai_facts(category, normalized_value, verification_status, candidate_id);
CREATE INDEX IF NOT EXISTS ai_facts_candidate_idx
  ON candidate_ai_facts(candidate_id, category);
