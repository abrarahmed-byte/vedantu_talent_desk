INSERT OR IGNORE INTO candidate_identities(identity_type, identity_value, candidate_id)
SELECT 'email', lower(trim(email)), id FROM candidates WHERE trim(email) <> '';

INSERT OR IGNORE INTO candidate_identities(identity_type, identity_value, candidate_id)
SELECT 'phone', replace(replace(replace(replace(replace(trim(phone), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), id
FROM candidates WHERE trim(phone) <> '';

CREATE TRIGGER IF NOT EXISTS candidate_identity_insert AFTER INSERT ON candidates BEGIN
  INSERT OR IGNORE INTO candidate_identities(identity_type, identity_value, candidate_id)
  SELECT 'email', lower(trim(new.email)), new.id WHERE trim(new.email) <> '';
  INSERT OR IGNORE INTO candidate_identities(identity_type, identity_value, candidate_id)
  SELECT 'phone', replace(replace(replace(replace(replace(trim(new.phone), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), new.id
  WHERE trim(new.phone) <> '';
END;

CREATE TRIGGER IF NOT EXISTS candidate_identity_update AFTER UPDATE OF email, phone ON candidates BEGIN
  DELETE FROM candidate_identities WHERE candidate_id = old.id AND identity_type IN ('email', 'phone');
  INSERT OR IGNORE INTO candidate_identities(identity_type, identity_value, candidate_id)
  SELECT 'email', lower(trim(new.email)), new.id WHERE trim(new.email) <> '';
  INSERT OR IGNORE INTO candidate_identities(identity_type, identity_value, candidate_id)
  SELECT 'phone', replace(replace(replace(replace(replace(trim(new.phone), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), new.id
  WHERE trim(new.phone) <> '';
END;
