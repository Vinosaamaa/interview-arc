// Only completed imported records or exactly promoted native records accept
// additions. Keep the original immutable practice revision separate from them.
export const completedPracticeTargets = `(
  SELECT owner_id, activity_id, question_id, specialty, status,
    json_extract(payload, '$.attempt.question.url') AS canonical_url
  FROM chatgpt_import_records WHERE status = 'completed'
  UNION ALL
  SELECT r.owner_id, r.activity_id, r.question_id, r.specialty, 'completed',
    json_extract(v.payload, '$.prompt.canonicalUrl') AS canonical_url
  FROM practice_records r
  JOIN practice_record_revisions v ON v.owner_id=r.owner_id AND v.activity_id=r.activity_id
    AND v.revision=r.current_revision AND v.record_fingerprint=r.record_fingerprint
  JOIN activity_finalizations f ON f.owner_id=r.owner_id AND f.activity_id=r.activity_id
    AND f.status IN ('ready','published') AND f.practice_record_revision=r.current_revision
    AND f.practice_record_fingerprint=r.record_fingerprint
)`;
