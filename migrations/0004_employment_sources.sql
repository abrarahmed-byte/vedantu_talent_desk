ALTER TABLE sources ADD COLUMN matched_rows INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS employment_records (
  source_id TEXT NOT NULL,
  source_row_key TEXT NOT NULL,
  employee_id TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '',
  work_email TEXT NOT NULL DEFAULT '',
  personal_email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  joining_date TEXT NOT NULL DEFAULT '',
  leaving_date TEXT NOT NULL DEFAULT '',
  leaving_reason TEXT NOT NULL DEFAULT '',
  designation TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  business_unit TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  employee_type TEXT NOT NULL DEFAULT '',
  employee_subtype TEXT NOT NULL DEFAULT '',
  contract_end_date TEXT NOT NULL DEFAULT '',
  employment_status TEXT NOT NULL CHECK (employment_status IN ('Active employee', 'Former employee')),
  candidate_id TEXT,
  row_fingerprint TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  sync_token TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(source_id, source_row_key),
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE,
  FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS employment_records_work_email_idx ON employment_records(work_email);
CREATE INDEX IF NOT EXISTS employment_records_personal_email_idx ON employment_records(personal_email);
CREATE INDEX IF NOT EXISTS employment_records_phone_idx ON employment_records(phone);
CREATE INDEX IF NOT EXISTS employment_records_candidate_idx ON employment_records(candidate_id);
CREATE INDEX IF NOT EXISTS employment_records_sync_idx ON employment_records(source_id, sync_token);
