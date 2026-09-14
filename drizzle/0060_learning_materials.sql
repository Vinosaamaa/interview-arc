CREATE TABLE learning_materials (
  owner_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('youtube','article','upload')),
  source_url TEXT,
  resource_id TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  coverage TEXT NOT NULL CHECK(coverage IN ('complete','partial')),
  limitations TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(owner_id,material_id),
  UNIQUE(owner_id,operation_id),
  FOREIGN KEY(owner_id,resource_id) REFERENCES study_resources(owner_id,resource_id)
);
CREATE INDEX learning_materials_recent ON learning_materials(owner_id,created_at DESC,material_id);
