CREATE TABLE chatgpt_question_operations (
  owner_id TEXT NOT NULL, operation_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
  receipt TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, operation_id)
);
