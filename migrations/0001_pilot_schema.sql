PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  initials TEXT NOT NULL,
  track TEXT NOT NULL CHECK (track IN ('Teacher', 'Non-teaching')),
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  subject_display TEXT NOT NULL DEFAULT '',
  grades_display TEXT NOT NULL DEFAULT '',
  boards_display TEXT NOT NULL DEFAULT '',
  languages_display TEXT NOT NULL DEFAULT '',
  education TEXT NOT NULL DEFAULT '',
  college TEXT NOT NULL DEFAULT '',
  experience_months INTEGER NOT NULL DEFAULT 0,
  work_mode TEXT NOT NULL DEFAULT '',
  applied_at TEXT NOT NULL,
  source_sheet TEXT NOT NULL DEFAULT '',
  resume_url TEXT NOT NULL DEFAULT '',
  resume_summary TEXT NOT NULL DEFAULT '',
  interviewer_count INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  call_count INTEGER NOT NULL DEFAULT 0,
  resume_open_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  employment_status TEXT NOT NULL DEFAULT 'No employment match',
  employment_times_hired INTEGER NOT NULL DEFAULT 0,
  search_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS candidates_applied_idx ON candidates(applied_at DESC);
CREATE INDEX IF NOT EXISTS candidates_track_idx ON candidates(track);
CREATE INDEX IF NOT EXISTS candidates_city_idx ON candidates(city);
CREATE INDEX IF NOT EXISTS candidates_work_mode_idx ON candidates(work_mode);

CREATE VIRTUAL TABLE IF NOT EXISTS candidates_fts USING fts5(
  candidate_id UNINDEXED,
  search_text,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS candidates_fts_insert AFTER INSERT ON candidates BEGIN
  INSERT INTO candidates_fts(candidate_id, search_text) VALUES (new.id, new.search_text);
END;

CREATE TRIGGER IF NOT EXISTS candidates_fts_update AFTER UPDATE OF search_text ON candidates BEGIN
  DELETE FROM candidates_fts WHERE candidate_id = old.id;
  INSERT INTO candidates_fts(candidate_id, search_text) VALUES (new.id, new.search_text);
END;

CREATE TRIGGER IF NOT EXISTS candidates_fts_delete AFTER DELETE ON candidates BEGIN
  DELETE FROM candidates_fts WHERE candidate_id = old.id;
END;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'Google Sheet',
  connected INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Connected',
  total_rows INTEGER NOT NULL DEFAULT 0,
  synced_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  last_sync TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  candidate_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS activity_candidate_idx ON activity_logs(candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_created_idx ON activity_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  recruiter TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL CHECK (outcome IN ('DNP', 'Interested', 'Not Interested', 'Call Back')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS calls_candidate_idx ON calls(candidate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  total_rows INTEGER NOT NULL DEFAULT 0,
  eta_seconds INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS access_users (
  email TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Admin', 'Recruiter')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
