import { canonicalJson, importFingerprint, type ImportedPractice } from "./chatgpt-import-policy.ts";
import { specialistWritePayloadDigest } from "../mcp-worker/specialist-write-policy.ts";
import { classifyD1TransactionalFailure } from "./d1-transactional-guard.ts";
import { normalizedSolutionProfile, profileFingerprint, validateSolutionProfile, type SolutionProfileProjectBinding } from "./solution-profile-validation.ts";
import type { SolutionProfile, Specialty } from "./solution-profile-types.ts";
import type { PracticeRecordPayload } from "./practice-records.ts";

type Database = Pick<D1Database, "prepare" | "batch">;
type Profile = SolutionProfile;
export type PracticeSolutionPublicationInput = {
  operationId: string;
  activityId: string;
  specialty: Specialty;
  questionId: string;
  expectedPracticeRevision: number;
  expectedPracticeFingerprint: string;
  expectedSolutionRevision: number;
} & ({ action: "create_or_revise"; solutionProfile: Profile } | { action: "reuse_current"; solutionProfile?: never });

export type PracticeSolutionPublication = {
  operationId: string;
  activityId: string;
  revision: number;
  practiceRevision: number;
  practiceFingerprint: string;
  specialty: Specialty;
  questionId: string;
  solutionRevision: number;
  profileFingerprint: string;
  action: "created" | "revised" | "reused";
  createdAt: number;
};

export class PracticeSolutionPublicationError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "PracticeSolutionPublicationError";
    this.code = code;
    this.retryable = retryable;
  }
}

// Read the exact completed revision, including imports which do not create
// native activities or timers. Every pointer must resolve to its saved bytes.
const completedRecords = `(
  SELECT r.owner_id, r.activity_id, r.specialty, r.question_id,
    r.revision, r.fingerprint, r.payload, 'imported' AS source, NULL AS completed_at
  FROM chatgpt_import_records r
  JOIN chatgpt_import_revisions v ON v.owner_id=r.owner_id AND v.attempt_key=r.attempt_key
    AND v.revision=r.revision AND v.fingerprint=r.fingerprint AND v.payload=r.payload
  WHERE r.status='completed'
  UNION ALL
  SELECT r.owner_id, r.activity_id, r.specialty, r.question_id,
    r.current_revision, r.record_fingerprint, v.payload, 'native', r.completed_at
  FROM practice_records r
  JOIN practice_record_revisions v ON v.owner_id=r.owner_id AND v.activity_id=r.activity_id
    AND v.revision=r.current_revision AND v.record_fingerprint=r.record_fingerprint
    AND r.title=json_extract(v.payload,'$.prompt.title') AND r.practice_date=json_extract(v.payload,'$.practiceDate')
    AND r.outcome IS json_extract(v.payload,'$.outcome') AND r.solution_revision IS json_extract(v.payload,'$.solutionLink.profileRevision')
  JOIN activity_finalizations f ON f.owner_id=r.owner_id AND f.activity_id=r.activity_id
    AND f.status IN ('ready','published') AND f.practice_record_revision=r.current_revision
    AND f.practice_record_fingerprint=r.record_fingerprint
    AND f.finalization_operation_id=r.finalization_operation_id
    AND v.operation_id=r.finalization_operation_id
    AND r.finalization_operation_id=json_extract(v.payload,'$.finalizationOperationId')
    AND f.finalization_request_fingerprint=v.request_fingerprint
)`;
const recordScope = "owner_id=? AND activity_id=? AND specialty=? AND question_id=?";
type CompletedRecord = {
  revision: number; fingerprint: string; payload: string; source: "imported" | "native"; completed_at: number | null;
};
type CurrentProfile = { current_revision: number; payload: string; updated_at: number };
type StoredPublication = { request_fingerprint: string; payload: string };

async function verifyPublication(db: Database, owner: string, publication: PracticeSolutionPublication) {
  const revision = await db.prepare("SELECT payload FROM problem_solution_revisions WHERE owner_id=? AND specialty=? AND question_id=? AND revision=?")
    .bind(owner, publication.specialty, publication.questionId, publication.solutionRevision).first<{ payload: string }>();
  if (!revision || await specialistWritePayloadDigest(JSON.parse(revision.payload)) !== publication.profileFingerprint) {
    throw new PracticeSolutionPublicationError("solution_publication_readback_failed", "The published solution does not resolve to its exact immutable revision.");
  }
  return publication;
}

export async function readPracticeSolutionPublication(db: Database, owner: string, activityId: string, revision?: number) {
  const row = await db.prepare(`SELECT payload FROM practice_solution_publications WHERE owner_id=? AND activity_id=?${revision === undefined ? " ORDER BY revision DESC LIMIT 1" : " AND revision=?"}`)
    .bind(owner, activityId, ...(revision === undefined ? [] : [revision])).first<{ payload: string }>();
  if (!row) return null;
  const publication = JSON.parse(row.payload) as PracticeSolutionPublication;
  if (publication.activityId !== activityId || (revision !== undefined && publication.revision !== revision)) {
    throw new PracticeSolutionPublicationError("solution_publication_readback_failed", "The solution publication link failed exact readback.");
  }
  return verifyPublication(db, owner, publication);
}

export async function savePracticeSolutionPublication(
  db: Database,
  owner: string,
  input: PracticeSolutionPublicationInput,
  now = Date.now(),
) {
  if (!input.operationId?.trim() || input.operationId.length > 240 || !input.activityId?.trim() || !input.questionId?.trim()
      || !["leetcode", "behavioral", "system_design"].includes(input.specialty)
      || !Number.isSafeInteger(input.expectedPracticeRevision) || input.expectedPracticeRevision < 1
      || !Number.isSafeInteger(input.expectedSolutionRevision) || input.expectedSolutionRevision < 0
      || !/^[a-f0-9]{64}$/.test(input.expectedPracticeFingerprint)
      || !["create_or_revise", "reuse_current"].includes(input.action)
      || (input.action === "create_or_revise" ? !input.solutionProfile : input.solutionProfile !== undefined)) {
    throw new PracticeSolutionPublicationError("solution_publication_invalid", "Provide an exact completed record, expected revisions, and a profile only for create_or_revise.");
  }
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 768 * 1024) {
    throw new PracticeSolutionPublicationError("solution_publication_too_large", "The solution publication exceeds the bounded payload limit.");
  }
  const requestFingerprint = await specialistWritePayloadDigest(input);
  async function replay() {
    const row = await db.prepare("SELECT request_fingerprint,payload FROM practice_solution_publications WHERE owner_id=? AND operation_id=?")
      .bind(owner, input.operationId).first<StoredPublication>();
    if (!row) return null;
    if (row.request_fingerprint !== requestFingerprint) {
      throw new PracticeSolutionPublicationError("solution_publication_identity_conflict", "This solution publication operation ID already belongs to different content.");
    }
    const publication = JSON.parse(row.payload) as PracticeSolutionPublication;
    if (publication.operationId !== input.operationId || publication.activityId !== input.activityId
        || publication.specialty !== input.specialty || publication.questionId !== input.questionId
        || publication.practiceRevision !== input.expectedPracticeRevision || publication.practiceFingerprint !== input.expectedPracticeFingerprint) {
      throw new PracticeSolutionPublicationError("solution_publication_readback_failed", "The solution publication receipt does not match its exact operation and Practice Record.");
    }
    await verifyPublication(db, owner, publication);
    return { saved: true as const, duplicate: true, publication };
  }
  const prior = await replay();
  if (prior) return prior;

  const records = await db.prepare(`SELECT revision,fingerprint,payload,source,completed_at FROM ${completedRecords} WHERE ${recordScope}`)
    .bind(owner, input.activityId, input.specialty, input.questionId).all<CompletedRecord>();
  if (records.results.length !== 1) {
    throw new PracticeSolutionPublicationError("solution_publication_record_missing", "Choose one completed Practice Record belonging to this owner, specialty, and question.");
  }
  const record = records.results[0];
  if (record.revision !== input.expectedPracticeRevision || record.fingerprint !== input.expectedPracticeFingerprint) {
    throw new PracticeSolutionPublicationError("solution_publication_record_conflict", "The completed Practice Record changed; read its exact revision and fingerprint before publishing.");
  }
  let title: string;
  let canonicalProblemUrl: string | null;
  if (record.source === "imported") {
    const original = JSON.parse(record.payload) as ImportedPractice;
    const { questionId, practiceDate, attempt, session, sources, snapshot, status, reasons } = original;
    if (await importFingerprint({ questionId, practiceDate, attempt, session, sources, snapshot, status, reasons }) !== record.fingerprint
        || original.activityId !== input.activityId || original.revision !== record.revision
        || questionId !== input.questionId || attempt.question.specialty !== input.specialty || status !== "completed") {
      throw new PracticeSolutionPublicationError("solution_publication_record_integrity", "The imported Practice Record failed exact readback.");
    }
    title = attempt.question.title;
    canonicalProblemUrl = attempt.question.url;
  } else {
    const original = JSON.parse(record.payload) as PracticeRecordPayload;
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(original)));
    const fingerprint = Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
    if (fingerprint !== record.fingerprint || original.activityId !== input.activityId || original.revision !== record.revision
        || original.questionId !== input.questionId || original.specialty !== input.specialty
        || !Number.isFinite(Date.parse(original.completedAt)) || record.completed_at !== Date.parse(original.completedAt)) {
      throw new PracticeSolutionPublicationError("solution_publication_record_integrity", "The native Practice Record failed exact readback.");
    }
    title = original.prompt.title;
    canonicalProblemUrl = original.prompt.canonicalUrl;
  }
  const [current, binding, latest] = await Promise.all([
    db.prepare("SELECT current_revision,payload,updated_at FROM problem_solution_profiles WHERE owner_id=? AND specialty=? AND question_id=?")
      .bind(owner, input.specialty, input.questionId).first<CurrentProfile>(),
    input.specialty === "behavioral"
      ? db.prepare("SELECT state,project_id AS projectId,current_revision AS currentRevision,focus,source_claim_id AS sourceClaimId FROM behavioral_project_question_bindings WHERE owner_id=? AND question_id=?")
        .bind(owner, input.questionId).first<SolutionProfileProjectBinding>() : Promise.resolve(null),
    db.prepare("SELECT COALESCE(MAX(revision),0) AS revision FROM practice_solution_publications WHERE owner_id=? AND activity_id=?")
      .bind(owner, input.activityId).first<{ revision: number }>(),
  ]);
  if ((current?.current_revision ?? 0) !== input.expectedSolutionRevision) {
    throw new PracticeSolutionPublicationError("solution_publication_revision_conflict", "The current Solution Profile changed; read it before preparing a new operation.");
  }
  if (input.action === "reuse_current" && !current) {
    throw new PracticeSolutionPublicationError("solution_publication_profile_missing", "There is no owner-private current Solution Profile to reuse.");
  }
  const profile: Profile = input.action === "reuse_current"
    ? JSON.parse(current!.payload) : normalizedSolutionProfile(input.solutionProfile, input.solutionProfile.references);
  validateSolutionProfile(input.specialty, profile, binding, input.questionId, canonicalProblemUrl);
  const unchanged = current && canonicalJson(JSON.parse(profileFingerprint(JSON.parse(current.payload) as Profile)))
    === canonicalJson(JSON.parse(profileFingerprint(profile)));
  const reuse = input.action === "reuse_current" || Boolean(unchanged);
  const solutionRevision = reuse ? current!.current_revision : input.expectedSolutionRevision + 1;
  const savedProfile: Profile = reuse ? JSON.parse(current!.payload) : profile;
  // Equal semantic content reuses the exact old bytes, including provenance.
  const publication: PracticeSolutionPublication = {
    operationId: input.operationId, activityId: input.activityId, revision: (latest?.revision ?? 0) + 1,
    practiceRevision: record.revision, practiceFingerprint: record.fingerprint,
    specialty: input.specialty, questionId: input.questionId, solutionRevision,
    profileFingerprint: await specialistWritePayloadDigest(savedProfile),
    action: reuse ? "reused" : current ? "revised" : "created", createdAt: now,
  };
  const statements = [
    db.prepare(`SELECT json(CASE WHEN (SELECT COUNT(*) FROM ${completedRecords} WHERE ${recordScope} AND revision=? AND fingerprint=? AND payload=? AND completed_at IS ?)=1
      AND COALESCE((SELECT MAX(revision) FROM practice_solution_publications WHERE owner_id=? AND activity_id=?),0)=?
      THEN 'true' ELSE 'solution_publication_record_conflict' END)`)
      .bind(owner, input.activityId, input.specialty, input.questionId, record.revision, record.fingerprint, record.payload, record.completed_at, owner, input.activityId, latest?.revision ?? 0),
    current
      ? db.prepare("SELECT json(CASE WHEN EXISTS(SELECT 1 FROM problem_solution_profiles WHERE owner_id=? AND specialty=? AND question_id=? AND current_revision=? AND updated_at=? AND payload=?) THEN 'true' ELSE 'solution_publication_profile_conflict' END)")
        .bind(owner, input.specialty, input.questionId, current.current_revision, current.updated_at, current.payload)
      : db.prepare("SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM problem_solution_profiles WHERE owner_id=? AND specialty=? AND question_id=?) THEN 'true' ELSE 'solution_publication_profile_conflict' END)")
        .bind(owner, input.specialty, input.questionId),
  ];
  if (input.specialty === "behavioral") {
    statements.push(binding
      ? db.prepare("SELECT json(CASE WHEN EXISTS(SELECT 1 FROM behavioral_project_question_bindings WHERE owner_id=? AND question_id=? AND state=? AND project_id=? AND current_revision=? AND focus=? AND source_claim_id IS ?) THEN 'true' ELSE 'solution_publication_binding_conflict' END)")
        .bind(owner, input.questionId, binding.state, binding.projectId, binding.currentRevision, binding.focus, binding.sourceClaimId)
      : db.prepare("SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM behavioral_project_question_bindings WHERE owner_id=? AND question_id=?) THEN 'true' ELSE 'solution_publication_binding_conflict' END)")
        .bind(owner, input.questionId));
  }
  if (reuse) {
    statements.push(db.prepare("SELECT json(CASE WHEN EXISTS(SELECT 1 FROM problem_solution_revisions WHERE owner_id=? AND specialty=? AND question_id=? AND revision=? AND payload=?) THEN 'true' ELSE 'solution_publication_revision_missing' END)")
      .bind(owner, input.specialty, input.questionId, solutionRevision, current!.payload));
  } else {
    const payload = canonicalJson(savedProfile);
    statements.push(
      db.prepare("INSERT INTO problem_solution_revisions(owner_id,specialty,question_id,revision,activity_id,payload,created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(owner, input.specialty, input.questionId, solutionRevision, input.activityId, payload, now),
      db.prepare(`INSERT INTO problem_solution_profiles(owner_id,specialty,question_id,title,current_revision,tags,payload,updated_at) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(owner_id,specialty,question_id) DO UPDATE SET title=excluded.title,current_revision=excluded.current_revision,tags=excluded.tags,payload=excluded.payload,updated_at=excluded.updated_at`)
        .bind(owner, input.specialty, input.questionId, title, solutionRevision, canonicalJson(savedProfile.tags), payload, now),
      db.prepare("DELETE FROM provisional_solution_profiles WHERE owner_id=? AND specialty=? AND question_id=?")
        .bind(owner, input.specialty, input.questionId),
    );
  }
  statements.push(db.prepare("INSERT INTO practice_solution_publications(owner_id,activity_id,revision,operation_id,request_fingerprint,payload,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(owner, input.activityId, publication.revision, input.operationId, requestFingerprint, canonicalJson(publication), now));
  try {
    await db.batch(statements);
  } catch (error) {
    const settled = await replay();
    if (settled) return settled;
    if (classifyD1TransactionalFailure(error) !== "unknown") {
      throw new PracticeSolutionPublicationError("solution_publication_conflict", "The record, solution, or project binding changed during publication; read the latest state before preparing a new operation.");
    }
    // A lost response can be safely retried using this immutable operation ID.
    throw new PracticeSolutionPublicationError("solution_publication_storage_failure", "Solution publication was not confirmed; retry the identical operation.", true);
  }
  const saved = await replay();
  if (!saved || canonicalJson(saved.publication) !== canonicalJson(publication)) {
    throw new PracticeSolutionPublicationError("solution_publication_readback_failed", "Solution publication readback was not confirmed; retry the identical operation.", true);
  }
  return { ...saved, duplicate: false };
}
