CREATE TABLE professor_lectures (
  owner_id TEXT NOT NULL, lecture_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
  title TEXT NOT NULL, script TEXT NOT NULL, chunks TEXT NOT NULL,
  word_count INTEGER NOT NULL, created_at INTEGER NOT NULL,
  cursor_revision INTEGER NOT NULL DEFAULT 0, chunk_index INTEGER NOT NULL DEFAULT 0,
  offset_seconds REAL NOT NULL DEFAULT 0, character_offset INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, lecture_id)
);
CREATE INDEX professor_lectures_owner_created ON professor_lectures(owner_id, created_at DESC);
CREATE TABLE professor_lecture_audio (
  owner_id TEXT NOT NULL, lecture_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('generating','ready','failed')),
  lease_id TEXT NOT NULL, lease_until INTEGER NOT NULL,
  object_key TEXT, size_bytes INTEGER, duration_seconds REAL,
  PRIMARY KEY (owner_id, lecture_id, chunk_index),
  FOREIGN KEY (owner_id, lecture_id) REFERENCES professor_lectures(owner_id, lecture_id)
);
CREATE TABLE professor_lecture_operations (
  owner_id TEXT NOT NULL, operation_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
  receipt TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, operation_id)
);
