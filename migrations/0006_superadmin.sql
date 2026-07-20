PRAGMA foreign_keys = OFF;

CREATE TABLE access_users_v2 (
  email TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Superadmin', 'Admin', 'Recruiter')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO access_users_v2(email, display_name, role, active, created_at)
SELECT email, display_name, role, active, created_at FROM access_users;

DROP TABLE access_users;
ALTER TABLE access_users_v2 RENAME TO access_users;

UPDATE access_users SET role = 'Superadmin'
WHERE lower(email) = 'abrar.ahmed@vedantu.com';

ALTER TABLE activity_logs ADD COLUMN actor_email TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS activity_actor_idx
  ON activity_logs(actor_email, actor, created_at DESC);

PRAGMA foreign_keys = ON;
