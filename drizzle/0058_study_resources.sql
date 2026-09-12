CREATE TABLE study_resources (
 owner_id TEXT NOT NULL, resource_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL, title TEXT NOT NULL, filename TEXT NOT NULL,
 byte_size INTEGER NOT NULL, source_sha256 TEXT NOT NULL, object_key TEXT NOT NULL,
 extraction_sha256 TEXT NOT NULL, extraction_method TEXT NOT NULL, warnings TEXT NOT NULL,
 chunk_count INTEGER NOT NULL, text_characters INTEGER NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id, resource_id), UNIQUE(owner_id, operation_id)
);
CREATE TABLE study_resource_chunks (
 owner_id TEXT NOT NULL, resource_id TEXT NOT NULL, extraction_sha256 TEXT NOT NULL,
 ordinal INTEGER NOT NULL, location TEXT NOT NULL, text_offset INTEGER NOT NULL, body TEXT NOT NULL,
 PRIMARY KEY(owner_id, resource_id, extraction_sha256, ordinal)
);
CREATE TABLE study_resource_links (
 owner_id TEXT NOT NULL, resource_id TEXT NOT NULL, target TEXT NOT NULL,
 target_id TEXT NOT NULL, specialty TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id, resource_id, target, target_id, specialty, revision)
);
CREATE INDEX study_resource_target ON study_resource_links(owner_id,target,target_id);
CREATE INDEX study_resources_created ON study_resources(owner_id,created_at,resource_id);
