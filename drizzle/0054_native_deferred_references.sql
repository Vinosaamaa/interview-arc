CREATE TABLE practice_records_next (
  owner_id text NOT NULL, activity_id text NOT NULL, current_revision integer NOT NULL,
  specialty text NOT NULL, question_id text NOT NULL, title text NOT NULL,
  completed_at integer NOT NULL, practice_date text NOT NULL, outcome text,
  solution_revision integer, record_fingerprint text NOT NULL,
  finalization_operation_id text NOT NULL, updated_at integer DEFAULT 0 NOT NULL,
  PRIMARY KEY(owner_id, activity_id)
);
INSERT INTO practice_records_next (owner_id,activity_id,current_revision,specialty,question_id,title,completed_at,practice_date,outcome,solution_revision,record_fingerprint,finalization_operation_id,updated_at)
SELECT owner_id,activity_id,current_revision,specialty,question_id,title,completed_at,practice_date,outcome,solution_revision,record_fingerprint,finalization_operation_id,updated_at FROM practice_records;
DROP TABLE practice_records;
ALTER TABLE practice_records_next RENAME TO practice_records;
CREATE INDEX practice_records_owner_date_idx ON practice_records(owner_id,practice_date,completed_at,activity_id);
