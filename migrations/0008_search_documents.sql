ALTER TABLE candidates ADD COLUMN row_text TEXT NOT NULL DEFAULT '';
ALTER TABLE candidates ADD COLUMN resume_text TEXT NOT NULL DEFAULT '';

-- Preserve every application attached to a merged candidate, not only the
-- latest canonical row. JSON punctuation is harmless to FTS5 tokenization.
UPDATE candidates
SET row_text = substr(
  COALESCE(
    (SELECT group_concat(sr.raw_json, ' ')
     FROM source_records sr
     WHERE sr.candidate_id = candidates.id),
    search_text
  ),
  1,
  30000
);

-- Updating search_text also refreshes candidates_fts through the existing
-- candidates_fts_update trigger.
UPDATE candidates
SET search_text = substr(trim(row_text || ' ' || resume_text), 1, 50000);
