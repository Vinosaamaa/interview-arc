CREATE TABLE coding_draft_revisions (
  owner_id text NOT NULL, draft_id text NOT NULL, revision integer NOT NULL,
  operation_id text NOT NULL, request_fingerprint text NOT NULL,
  payload text NOT NULL, created_at integer NOT NULL,
  PRIMARY KEY(owner_id,draft_id,revision), UNIQUE(owner_id,operation_id)
);
CREATE TABLE coding_submissions (
  owner_id text NOT NULL, operation_id text NOT NULL, draft_id text NOT NULL,
  draft_revision integer NOT NULL, code_sha256 text NOT NULL,
  status text NOT NULL, submission_id integer, payload text NOT NULL,
  created_at integer NOT NULL, updated_at integer NOT NULL,
  PRIMARY KEY(owner_id,operation_id), UNIQUE(owner_id,draft_id,draft_revision)
);
