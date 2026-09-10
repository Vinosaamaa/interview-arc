CREATE TABLE chatgpt_import_packets (
  owner_id TEXT NOT NULL, packet_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
  payload TEXT NOT NULL, receipt TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, packet_id)
);
CREATE TABLE chatgpt_import_sources (
  owner_id TEXT NOT NULL, source_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
  payload TEXT NOT NULL, PRIMARY KEY (owner_id, source_key)
);
CREATE TABLE chatgpt_import_sessions (
  owner_id TEXT NOT NULL, session_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
  payload TEXT NOT NULL, PRIMARY KEY (owner_id, session_key)
);
CREATE TRIGGER chatgpt_import_source_identity_insert BEFORE INSERT ON chatgpt_import_sources
WHEN EXISTS (SELECT 1 FROM chatgpt_import_sources s, json_each(s.payload) old_turn, json_each(NEW.payload) new_turn
  WHERE s.owner_id = NEW.owner_id AND s.source_key != NEW.source_key
    AND json_extract(old_turn.value, '$.turnKey') = json_extract(new_turn.value, '$.turnKey'))
BEGIN SELECT RAISE(ABORT, 'import_source_identity_conflict'); END;
CREATE TRIGGER chatgpt_import_source_identity_update BEFORE UPDATE OF payload ON chatgpt_import_sources
WHEN EXISTS (SELECT 1 FROM chatgpt_import_sources s, json_each(s.payload) old_turn, json_each(NEW.payload) new_turn
  WHERE s.owner_id = NEW.owner_id AND s.source_key != NEW.source_key
    AND json_extract(old_turn.value, '$.turnKey') = json_extract(new_turn.value, '$.turnKey'))
BEGIN SELECT RAISE(ABORT, 'import_source_identity_conflict'); END;
CREATE TABLE chatgpt_import_records (
  owner_id TEXT NOT NULL, attempt_key TEXT NOT NULL, activity_id TEXT NOT NULL,
  revision INTEGER NOT NULL, fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed','pending')),
  specialty TEXT NOT NULL, question_id TEXT, practice_date TEXT,
  payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, attempt_key), UNIQUE (owner_id, activity_id)
);
CREATE UNIQUE INDEX chatgpt_import_completed_question_day
  ON chatgpt_import_records(owner_id, specialty, question_id, practice_date)
  WHERE status = 'completed';
CREATE INDEX chatgpt_import_past ON chatgpt_import_records(owner_id, status, practice_date, activity_id);
CREATE TABLE chatgpt_import_revisions (
  owner_id TEXT NOT NULL, attempt_key TEXT NOT NULL, revision INTEGER NOT NULL,
  fingerprint TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, attempt_key, revision)
);
-- Historical imports reserve a question/day without creating a live activity.
-- Enforce this at the shared persistence boundary for every planner.
CREATE TRIGGER chatgpt_import_planning_insert BEFORE INSERT ON extra_activities
WHEN EXISTS (SELECT 1 FROM chatgpt_import_records r WHERE r.owner_id = NEW.owner_id
  AND r.status = 'completed' AND r.specialty = json_extract(NEW.payload, '$.type')
  AND r.question_id = json_extract(NEW.payload, '$.questionId') AND r.practice_date = NEW.date)
BEGIN SELECT RAISE(ABORT, 'question_already_imported_for_day'); END;
CREATE TRIGGER chatgpt_import_planning_update BEFORE UPDATE OF payload, date ON extra_activities
WHEN EXISTS (SELECT 1 FROM chatgpt_import_records r WHERE r.owner_id = NEW.owner_id
  AND r.status = 'completed' AND r.specialty = json_extract(NEW.payload, '$.type')
  AND r.question_id = json_extract(NEW.payload, '$.questionId') AND r.practice_date = NEW.date)
BEGIN SELECT RAISE(ABORT, 'question_already_imported_for_day'); END;
