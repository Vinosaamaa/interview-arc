CREATE TABLE practice_drawing_additions (
  owner_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(owner_id, activity_id, revision),
  UNIQUE(owner_id, operation_id)
);
