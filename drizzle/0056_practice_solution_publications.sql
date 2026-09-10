CREATE TABLE practice_solution_publications (
  owner_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, activity_id, revision)
);
CREATE UNIQUE INDEX practice_solution_publications_operation_idx
  ON practice_solution_publications(owner_id, operation_id);
