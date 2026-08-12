import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { isDisplaySafeResumeSourceLabel } from "./resume-revision-policy";
import { resumeSha256Hex, type ResumeRevisionManifest } from "./resume-revision-manifest";
import { behavioralFinalAnswerSnapshotInputSchema } from "./behavioral-final-answer";
import {
  backfillActivityResumeContextSchema,
  type BackfillActivityResumeContextInput,
} from "./activity-resume-context";

import { d1TransactionalInvariantGuard, isD1TransactionalInvariantFailure } from "./d1-transactional-guard";
import { getDb } from "./index";
import {
  behavioralClaims,
  behavioralFinalAnswerSnapshots,
  behavioralEvidenceItems,
  activityResumeContexts,
  activityResumeContextBackfills,
  problemSolutionProfiles,
  resumeBulletClaimLinks,
  resumeBulletOccurrences,
  resumeCurrentRevisionOperations,
  resumeImportLocks,
  resumeImportOperations,
  resumeRevisionReviewImpacts,
  resumeRevisionFileDeletions,
  resumeRevisionFiles,
  resumeRevisions,
  resumeSources,
  type ResumeImportOperationRow,
} from "./schema";

export type ResumeFileFormat = "docx" | "pdf";

export interface ResumeFileIntegrity {
  format: ResumeFileFormat;
  sha256: string;
  byteSize: number;
  mimeType: string;
}

export interface ResumeImportReceipt {
  operationId: string;
  status: "saved";
  unchanged: boolean;
  resumeId: string;
  revisionId: string;
  parentRevisionId: string | null;
  sourceFingerprint: string;
  sourceProvider?: "google_drive" | "local_file";
  sourceRevisionFingerprint?: string;
  manifestFingerprint?: string;
  extractionVersion?: string;
  bulletCount?: number;
  importedAt: number;
  currentRevisionId: string;
  files: Record<ResumeFileFormat, Omit<ResumeFileIntegrity, "format">>;
}

interface ResumeCurrentRevisionReceipt {
  operationId: string;
  status: "saved";
  unchanged: boolean;
  resumeId: string;
  priorRevisionId: string | null;
  currentRevisionId: string;
  selectedAt: number;
}

export interface ResumeFileDeletionReceipt {
  operationId: string;
  status: "deleted";
  resumeId: string;
  revisionId: string;
  deletedFormats: ["docx", "pdf"];
  preserved: ["revision", "integrity", "wording", "semantic_links", "activity_context"];
  deletedAt: number;
}

export interface ResumeFileDeletionInput {
  operationId: string;
  resumeId: string;
  revisionId: string;
  authorization: "explicit_user_instruction";
  reason: string;
}

export interface ActivityResumeContextBackfillReceipt {
  operationId: string;
  status: "saved";
  state: "backfilled";
  activityId: string;
  snapshotRevision: number;
  resumeId: string;
  resumeRevisionId: string;
  claimIds: string[];
  evidenceIds: string[];
  capturedAt: number;
}

export class ResumeImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ResumeImportError";
  }
}

interface ReserveResumeImportInput {
  operationId: string;
  resumeId: string;
  revisionId: string;
  requestHash: string;
}

interface CompleteResumeImportInput extends ReserveResumeImportInput {
  sourceLabel: string;
  sourceFingerprint: string;
  manifest: ResumeRevisionManifest | null;
  manifestFingerprint: string | null;
  storageGeneration: string;
  files: [ResumeFileIntegrity, ResumeFileIntegrity];
}

const LOCK_LEASE_MS = 5 * 60 * 1_000;
const RESUME_LIBRARY_SOURCE_LIMIT = 20;
const RESUME_LIBRARY_REVISION_LIMIT = 20;

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function readResumeManifestReferences(
  ownerId: string,
  manifest: ResumeRevisionManifest,
) {
  const claimIds = [...new Set(manifest.bullets.flatMap((bullet) => bullet.claimIds))].sort();
  const evidenceIds = [...new Set(manifest.bullets.flatMap((bullet) => bullet.evidenceIds))].sort();
  const claimRows = (await Promise.all(chunks(claimIds, 50).map((ids) => getDb().select({
    claimId: behavioralClaims.claimId,
    questionId: behavioralClaims.questionId,
    status: behavioralClaims.status,
  }).from(behavioralClaims).where(and(
    eq(behavioralClaims.ownerId, ownerId),
    inArray(behavioralClaims.claimId, ids),
  ))))).flat();
  const evidenceRows = (await Promise.all(chunks(evidenceIds, 50).map((ids) => getDb().select({
    evidenceId: behavioralEvidenceItems.evidenceId,
    candidateState: behavioralEvidenceItems.candidateState,
  }).from(behavioralEvidenceItems).where(and(
    eq(behavioralEvidenceItems.ownerId, ownerId),
    inArray(behavioralEvidenceItems.evidenceId, ids),
  ))))).flat();
  const claimsById = new Map(claimRows.map((row) => [row.claimId, row]));
  const evidenceById = new Map(evidenceRows.map((row) => [row.evidenceId, row]));
  const unavailableClaim = claimIds.find((claimId) => {
    const row = claimsById.get(claimId);
    return !row || row.status === "contradicted";
  });
  if (unavailableClaim) {
    throw new ResumeImportError(
      "resume_import_claim_unavailable",
      "A resume bullet references a missing or contradicted owner-private claim.",
      409,
      false,
    );
  }
  const unavailableEvidence = evidenceIds.find((evidenceId) => evidenceById.get(evidenceId)?.candidateState !== "accepted");
  if (unavailableEvidence) {
    throw new ResumeImportError(
      "resume_import_evidence_unavailable",
      "A resume bullet references evidence that is not accepted and owner-private.",
      409,
      false,
    );
  }
  return { claimRows, claimIds, evidenceIds };
}

async function buildResumeReviewImpacts(
  ownerId: string,
  resumeId: string,
  revisionId: string,
  parentRevisionId: string | null,
  currentClaimRows: Array<{ claimId: string; questionId: string }>,
  nowMs: number,
) {
  const currentClaimIds = new Set(currentClaimRows.map((row) => row.claimId));
  const parentRows = parentRevisionId ? await getDb().select({
    referenceId: resumeBulletClaimLinks.referenceId,
  }).from(resumeBulletClaimLinks).where(and(
    eq(resumeBulletClaimLinks.ownerId, ownerId),
    eq(resumeBulletClaimLinks.resumeId, resumeId),
    eq(resumeBulletClaimLinks.revisionId, parentRevisionId),
    eq(resumeBulletClaimLinks.referenceType, "claim"),
  )) : [];
  const parentClaimIds = new Set(parentRows.map((row) => row.referenceId));
  const changedClaimIds = [...new Set([
    ...[...currentClaimIds].filter((claimId) => !parentClaimIds.has(claimId)),
    ...[...parentClaimIds].filter((claimId) => !currentClaimIds.has(claimId)),
  ])].sort();
  if (!changedClaimIds.length || !parentRevisionId) return [];
  const changedClaimRows = (await Promise.all(chunks(changedClaimIds, 50).map((ids) => getDb().select({
    claimId: behavioralClaims.claimId,
    questionId: behavioralClaims.questionId,
  }).from(behavioralClaims).where(and(
    eq(behavioralClaims.ownerId, ownerId),
    inArray(behavioralClaims.claimId, ids),
  ))))).flat();
  const changedByQuestion = new Map<string, string[]>();
  changedClaimRows.forEach((row) => {
    const values = changedByQuestion.get(row.questionId) ?? [];
    values.push(row.claimId);
    changedByQuestion.set(row.questionId, values);
  });
  const questionIds = [...changedByQuestion.keys()];
  const profiles = questionIds.length ? (await Promise.all(chunks(questionIds, 50).map((ids) => getDb().select({
    questionId: problemSolutionProfiles.questionId,
    currentRevision: problemSolutionProfiles.currentRevision,
  }).from(problemSolutionProfiles).where(and(
    eq(problemSolutionProfiles.ownerId, ownerId),
    eq(problemSolutionProfiles.specialty, "behavioral"),
    inArray(problemSolutionProfiles.questionId, ids),
  ))))).flat() : [];
  return profiles.map((profile) => ({
    ownerId,
    resumeId,
    revisionId,
    questionId: profile.questionId,
    solutionProfileRevision: profile.currentRevision,
    changedClaimIds: changedByQuestion.get(profile.questionId)!.sort(),
    status: "needs_review" as const,
    createdAt: nowMs,
    acknowledgedAt: null,
  }));
}

function sameNullable(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? null) === (right ?? null);
}

function immutableFileCompatibility(
  ownerId: string,
  resumeId: string,
  revisionId: string,
  file: ResumeFileIntegrity,
) {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${resumeRevisionFiles}
    WHERE ${resumeRevisionFiles.ownerId} = ${ownerId}
      AND ${resumeRevisionFiles.resumeId} = ${resumeId}
      AND ${resumeRevisionFiles.revisionId} = ${revisionId}
      AND ${resumeRevisionFiles.format} = ${file.format}
      AND (
        ${resumeRevisionFiles.sha256} <> ${file.sha256}
        OR ${resumeRevisionFiles.byteSize} <> ${file.byteSize}
        OR ${resumeRevisionFiles.mimeType} <> ${file.mimeType}
      )
  )`;
}

async function readOperation(ownerId: string, operationId: string) {
  const rows = await getDb().select().from(resumeImportOperations).where(and(
    eq(resumeImportOperations.ownerId, ownerId),
    eq(resumeImportOperations.operationId, operationId),
  )).limit(1);
  return rows[0] ?? null;
}

async function readResumeFileDeletionOperation(ownerId: string, operationId: string) {
  const rows = await getDb().select().from(resumeRevisionFileDeletions).where(and(
    eq(resumeRevisionFileDeletions.ownerId, ownerId),
    eq(resumeRevisionFileDeletions.operationId, operationId),
  )).limit(1);
  return rows[0] ?? null;
}

async function readResumeFileDeletionTarget(ownerId: string, resumeId: string, revisionId: string) {
  const rows = await getDb().select().from(resumeRevisionFileDeletions).where(and(
    eq(resumeRevisionFileDeletions.ownerId, ownerId),
    eq(resumeRevisionFileDeletions.resumeId, resumeId),
    eq(resumeRevisionFileDeletions.revisionId, revisionId),
  )).limit(1);
  return rows[0] ?? null;
}

async function readSource(ownerId: string, resumeId: string) {
  const rows = await getDb().select().from(resumeSources).where(and(
    eq(resumeSources.ownerId, ownerId),
    eq(resumeSources.resumeId, resumeId),
  )).limit(1);
  return rows[0] ?? null;
}

async function readLock(ownerId: string, resumeId: string) {
  const rows = await getDb().select().from(resumeImportLocks).where(and(
    eq(resumeImportLocks.ownerId, ownerId),
    eq(resumeImportLocks.resumeId, resumeId),
  )).limit(1);
  return rows[0] ?? null;
}

function assertOperationIdentity(operation: ResumeImportOperationRow, input: ReserveResumeImportInput) {
  if (operation.requestHash !== input.requestHash
      || operation.resumeId !== input.resumeId
      || operation.requestedRevisionId !== input.revisionId) {
    throw new ResumeImportError(
      "resume_import_operation_conflict",
      "That operation ID already belongs to a different immutable resume import request.",
      409,
      false,
    );
  }
}

function savedReceipt(operation: ResumeImportOperationRow) {
  if (operation.status !== "saved" || !operation.receipt) return null;
  return operation.receipt as unknown as ResumeImportReceipt;
}

export async function reserveResumeImport(
  ownerId: string,
  input: ReserveResumeImportInput,
  nowMs = Date.now(),
) {
  const db = getDb();
  const existing = await readOperation(ownerId, input.operationId);
  if (existing) {
    assertOperationIdentity(existing, input);
    const receipt = savedReceipt(existing);
    if (receipt) return { duplicate: true as const, receipt };
    if (existing.status === "failed") {
      throw new ResumeImportError(
        existing.errorCode ?? "resume_import_failed",
        "That immutable resume import cannot be retried.",
        409,
        false,
      );
    }
  }

  const source = await readSource(ownerId, input.resumeId);
  const baseCurrentRevisionId = existing?.baseCurrentRevisionId ?? source?.currentRevisionId ?? null;
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = nowMs + LOCK_LEASE_MS;
  const statements = [
    db.insert(resumeImportOperations).values({
      ownerId,
      operationId: input.operationId,
      resumeId: input.resumeId,
      requestedRevisionId: input.revisionId,
      requestHash: input.requestHash,
      baseCurrentRevisionId,
      status: "staging",
      errorCode: null,
      receipt: null,
      createdAt: nowMs,
      updatedAt: nowMs,
      completedAt: null,
    }).onConflictDoNothing(),
    db.insert(resumeImportLocks).values({
      ownerId,
      resumeId: input.resumeId,
      operationId: input.operationId,
      leaseToken,
      leaseExpiresAt,
      createdAt: nowMs,
      updatedAt: nowMs,
    }).onConflictDoUpdate({
      target: [resumeImportLocks.ownerId, resumeImportLocks.resumeId],
      set: {
        operationId: input.operationId,
        leaseToken,
        leaseExpiresAt,
        updatedAt: nowMs,
      },
      where: lte(resumeImportLocks.leaseExpiresAt, nowMs),
    }),
  ];
  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);

  const [operation, lock] = await Promise.all([
    readOperation(ownerId, input.operationId),
    readLock(ownerId, input.resumeId),
  ]);
  if (!operation) throw new Error("Resume import reservation was not durable.");
  assertOperationIdentity(operation, input);
  const replay = savedReceipt(operation);
  if (replay) return { duplicate: true as const, receipt: replay };
  if (lock?.operationId !== input.operationId || lock.leaseToken !== leaseToken) {
    throw new ResumeImportError(
      "resume_import_busy",
      "Another immutable revision is currently being staged for this resume.",
      409,
      true,
    );
  }

  const authoritativeSource = await readSource(ownerId, input.resumeId);
  if (!sameNullable(authoritativeSource?.currentRevisionId, operation.baseCurrentRevisionId)) {
    await failResumeImport(ownerId, input, leaseToken, "resume_import_stale_current", false, nowMs);
    throw new ResumeImportError(
      "resume_import_stale_current",
      "The current resume revision changed after this operation was reserved.",
      409,
      false,
    );
  }
  await db.update(resumeImportOperations).set({
    status: "staging",
    errorCode: null,
    updatedAt: nowMs,
  }).where(and(
    eq(resumeImportOperations.ownerId, ownerId),
    eq(resumeImportOperations.operationId, input.operationId),
    eq(resumeImportOperations.requestHash, input.requestHash),
    sql`${resumeImportOperations.status} <> 'saved'`,
    sql`EXISTS (
      SELECT 1 FROM ${resumeImportLocks}
      WHERE ${resumeImportLocks.ownerId} = ${ownerId}
        AND ${resumeImportLocks.resumeId} = ${input.resumeId}
        AND ${resumeImportLocks.operationId} = ${input.operationId}
        AND ${resumeImportLocks.leaseToken} = ${leaseToken}
    )`,
  ));
  return {
    duplicate: false as const,
    baseCurrentRevisionId: operation.baseCurrentRevisionId,
    leaseToken,
  };
}

export async function failResumeImport(
  ownerId: string,
  input: ReserveResumeImportInput,
  leaseToken: string,
  errorCode: string,
  retryable: boolean,
  nowMs = Date.now(),
) {
  const db = getDb();
  await db.batch([
    db.update(resumeImportOperations).set({
      status: retryable ? "retryable_failure" : "failed",
      errorCode,
      updatedAt: nowMs,
      completedAt: retryable ? null : nowMs,
    }).where(and(
      eq(resumeImportOperations.ownerId, ownerId),
      eq(resumeImportOperations.operationId, input.operationId),
      eq(resumeImportOperations.requestHash, input.requestHash),
      sql`${resumeImportOperations.status} <> 'saved'`,
      sql`EXISTS (
        SELECT 1 FROM ${resumeImportLocks}
        WHERE ${resumeImportLocks.ownerId} = ${ownerId}
          AND ${resumeImportLocks.resumeId} = ${input.resumeId}
          AND ${resumeImportLocks.operationId} = ${input.operationId}
          AND ${resumeImportLocks.leaseToken} = ${leaseToken}
      )`,
    )),
    db.delete(resumeImportLocks).where(and(
      eq(resumeImportLocks.ownerId, ownerId),
      eq(resumeImportLocks.resumeId, input.resumeId),
      eq(resumeImportLocks.operationId, input.operationId),
      eq(resumeImportLocks.leaseToken, leaseToken),
    )),
  ]);
}

export async function findResumeRevisionByFingerprint(
  ownerId: string,
  resumeId: string,
  sourceFingerprint: string,
) {
  const revisions = await getDb().select().from(resumeRevisions).where(and(
    eq(resumeRevisions.ownerId, ownerId),
    eq(resumeRevisions.resumeId, resumeId),
    eq(resumeRevisions.sourceFingerprint, sourceFingerprint),
  )).limit(1);
  const revision = revisions[0];
  if (!revision) return null;
  const files = await getDb().select({
    format: resumeRevisionFiles.format,
    sha256: resumeRevisionFiles.sha256,
    byteSize: resumeRevisionFiles.byteSize,
    mimeType: resumeRevisionFiles.mimeType,
  }).from(resumeRevisionFiles).where(and(
    eq(resumeRevisionFiles.ownerId, ownerId),
    eq(resumeRevisionFiles.resumeId, resumeId),
    eq(resumeRevisionFiles.revisionId, revision.revisionId),
  )).orderBy(asc(resumeRevisionFiles.format)).limit(2);
  const bulletCountRows = await getDb().select({ count: sql<number>`count(*)` })
    .from(resumeBulletOccurrences).where(and(
      eq(resumeBulletOccurrences.ownerId, ownerId),
      eq(resumeBulletOccurrences.resumeId, resumeId),
      eq(resumeBulletOccurrences.revisionId, revision.revisionId),
    ));
  const retention = await getResumeFileRetention(ownerId, resumeId, revision.revisionId);
  return { revision, files, retention, bulletCount: Number(bulletCountRows[0]?.count ?? 0) };
}

export async function findResumeRevision(
  ownerId: string,
  resumeId: string,
  revisionId: string,
) {
  const revisions = await getDb().select().from(resumeRevisions).where(and(
    eq(resumeRevisions.ownerId, ownerId),
    eq(resumeRevisions.resumeId, resumeId),
    eq(resumeRevisions.revisionId, revisionId),
  )).limit(1);
  return revisions[0] ?? null;
}

export async function completeUnchangedResumeImport(
  ownerId: string,
  input: ReserveResumeImportInput,
  leaseToken: string,
  canonical: {
    revisionId: string;
    parentRevisionId: string | null;
    sourceFingerprint: string;
    sourceProvider: "google_drive" | "local_file" | null;
    sourceRevisionFingerprint: string | null;
    manifestFingerprint: string | null;
    extractionVersion: string | null;
    bulletCount: number;
    importedAt: number;
    files: [ResumeFileIntegrity, ResumeFileIntegrity];
  },
  nowMs = Date.now(),
) {
  const db = getDb();
  const operation = await readOperation(ownerId, input.operationId);
  if (!operation) throw new Error("Resume import operation was not reserved.");
  assertOperationIdentity(operation, input);
  const replay = savedReceipt(operation);
  if (replay) return { duplicate: true, receipt: replay };
  const source = await readSource(ownerId, input.resumeId);
  if (!source?.currentRevisionId) {
    throw new ResumeImportError(
      "resume_import_commit_conflict",
      "The canonical resume source is no longer available.",
      409,
      false,
    );
  }
  const files = Object.fromEntries(canonical.files.map(({ format, ...file }) => [format, file])) as ResumeImportReceipt["files"];
  const receipt: ResumeImportReceipt = {
    operationId: input.operationId,
    status: "saved",
    unchanged: true,
    resumeId: input.resumeId,
    revisionId: canonical.revisionId,
    parentRevisionId: canonical.parentRevisionId,
    sourceFingerprint: canonical.sourceFingerprint,
    ...(canonical.sourceProvider ? { sourceProvider: canonical.sourceProvider } : {}),
    ...(canonical.sourceRevisionFingerprint ? { sourceRevisionFingerprint: canonical.sourceRevisionFingerprint } : {}),
    ...(canonical.manifestFingerprint ? { manifestFingerprint: canonical.manifestFingerprint } : {}),
    ...(canonical.extractionVersion ? { extractionVersion: canonical.extractionVersion } : {}),
    bulletCount: canonical.bulletCount,
    importedAt: canonical.importedAt,
    currentRevisionId: source.currentRevisionId,
    files,
  };
  const invariant = sql`
    EXISTS (
      SELECT 1 FROM ${resumeImportLocks}
      WHERE ${resumeImportLocks.ownerId} = ${ownerId}
        AND ${resumeImportLocks.resumeId} = ${input.resumeId}
        AND ${resumeImportLocks.operationId} = ${input.operationId}
        AND ${resumeImportLocks.leaseToken} = ${leaseToken}
    )
    AND EXISTS (
      SELECT 1 FROM ${resumeImportOperations}
      WHERE ${resumeImportOperations.ownerId} = ${ownerId}
        AND ${resumeImportOperations.operationId} = ${input.operationId}
        AND ${resumeImportOperations.requestHash} = ${input.requestHash}
        AND ${resumeImportOperations.status} IN ('staging', 'retryable_failure')
    )
    AND COALESCE((
      SELECT ${resumeSources.currentRevisionId} FROM ${resumeSources}
      WHERE ${resumeSources.ownerId} = ${ownerId}
        AND ${resumeSources.resumeId} = ${input.resumeId}
    ), '') = COALESCE(${operation.baseCurrentRevisionId}, '')
    AND EXISTS (
      SELECT 1 FROM ${resumeRevisions}
      WHERE ${resumeRevisions.ownerId} = ${ownerId}
        AND ${resumeRevisions.resumeId} = ${input.resumeId}
        AND ${resumeRevisions.revisionId} = ${canonical.revisionId}
    )
    AND 2 = (
      SELECT COUNT(*) FROM ${resumeRevisionFiles}
      WHERE ${resumeRevisionFiles.ownerId} = ${ownerId}
        AND ${resumeRevisionFiles.resumeId} = ${input.resumeId}
        AND ${resumeRevisionFiles.revisionId} = ${canonical.revisionId}
    )
  `;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, invariant),
      db.update(resumeImportOperations).set({
        status: "saved",
        errorCode: null,
        receipt,
        updatedAt: nowMs,
        completedAt: nowMs,
      }).where(and(
        eq(resumeImportOperations.ownerId, ownerId),
        eq(resumeImportOperations.operationId, input.operationId),
        eq(resumeImportOperations.requestHash, input.requestHash),
      )),
      db.delete(resumeImportLocks).where(and(
        eq(resumeImportLocks.ownerId, ownerId),
        eq(resumeImportLocks.resumeId, input.resumeId),
        eq(resumeImportLocks.operationId, input.operationId),
        eq(resumeImportLocks.leaseToken, leaseToken),
      )),
    ]);
  } catch (error) {
    const authoritative = await readOperation(ownerId, input.operationId);
    if (authoritative) {
      assertOperationIdentity(authoritative, input);
      const authoritativeReceipt = savedReceipt(authoritative);
      if (authoritativeReceipt) return { duplicate: true, receipt: authoritativeReceipt };
    }
    if (isD1TransactionalInvariantFailure(error)) {
      await failResumeImport(ownerId, input, leaseToken, "resume_import_commit_conflict", false, nowMs);
      throw new ResumeImportError(
        "resume_import_commit_conflict",
        "The current resume revision changed before the no-op receipt committed.",
        409,
        false,
      );
    }
    throw error;
  }
  return { duplicate: false, receipt };
}

export async function completeResumeImport(
  ownerId: string,
  input: CompleteResumeImportInput,
  leaseToken: string,
  nowMs = Date.now(),
) {
  const db = getDb();
  const operation = await readOperation(ownerId, input.operationId);
  if (!operation) throw new Error("Resume import operation was not reserved.");
  assertOperationIdentity(operation, input);
  const replay = savedReceipt(operation);
  if (replay) {
    const canonical = await findResumeRevision(ownerId, input.resumeId, replay.revisionId);
    return {
      duplicate: true,
      receipt: replay,
      cleanupStaging: canonical?.storageGeneration !== input.storageGeneration,
    };
  }

  const files = Object.fromEntries(input.files.map(({ format, ...file }) => [format, file])) as ResumeImportReceipt["files"];
  const baseCurrentRevisionId = operation.baseCurrentRevisionId;
  const references = input.manifest
    ? await readResumeManifestReferences(ownerId, input.manifest)
    : { claimRows: [], claimIds: [], evidenceIds: [] };
  const reviewImpacts = await buildResumeReviewImpacts(
    ownerId,
    input.resumeId,
    input.revisionId,
    baseCurrentRevisionId,
    references.claimRows,
    nowMs,
  );
  const receipt: ResumeImportReceipt = {
    operationId: input.operationId,
    status: "saved",
    unchanged: false,
    resumeId: input.resumeId,
    revisionId: input.revisionId,
    parentRevisionId: baseCurrentRevisionId,
    sourceFingerprint: input.sourceFingerprint,
    ...(input.manifest ? {
      sourceProvider: input.manifest.sourceProvider,
      sourceRevisionFingerprint: input.manifest.sourceRevisionFingerprint,
      manifestFingerprint: input.manifestFingerprint!,
      extractionVersion: input.manifest.extractionVersion,
      bulletCount: input.manifest.bullets.length,
    } : { bulletCount: 0 }),
    importedAt: nowMs,
    currentRevisionId: input.revisionId,
    files,
  };
  const fileIntegrityInvariant = sql.join(
    input.files.map((file) => immutableFileCompatibility(
      ownerId,
      input.resumeId,
      input.revisionId,
      file,
    )),
    sql` AND `,
  );
  const referenceInvariant = sql`
    ${references.claimIds.length} = (
      SELECT COUNT(*) FROM ${behavioralClaims}
      WHERE ${behavioralClaims.ownerId} = ${ownerId}
        AND ${behavioralClaims.status} <> 'contradicted'
        AND ${behavioralClaims.claimId} IN (
          SELECT value FROM json_each(${JSON.stringify(references.claimIds)})
        )
    )
    AND ${references.evidenceIds.length} = (
      SELECT COUNT(*) FROM ${behavioralEvidenceItems}
      WHERE ${behavioralEvidenceItems.ownerId} = ${ownerId}
        AND ${behavioralEvidenceItems.candidateState} = 'accepted'
        AND ${behavioralEvidenceItems.evidenceId} IN (
          SELECT value FROM json_each(${JSON.stringify(references.evidenceIds)})
        )
    )
    AND ${reviewImpacts.length} = (
      SELECT COUNT(*)
      FROM ${problemSolutionProfiles} profile
      INNER JOIN json_each(${JSON.stringify(reviewImpacts.map((impact) => ({
        questionId: impact.questionId,
        revision: impact.solutionProfileRevision,
      })))}) expected
        ON json_extract(expected.value, '$.questionId') = profile.question_id
       AND CAST(json_extract(expected.value, '$.revision') AS INTEGER) = profile.current_revision
      WHERE profile.owner_id = ${ownerId}
        AND profile.specialty = 'behavioral'
    )
  `;
  const invariant = sql`
    EXISTS (
      SELECT 1 FROM ${resumeImportLocks}
      WHERE ${resumeImportLocks.ownerId} = ${ownerId}
        AND ${resumeImportLocks.resumeId} = ${input.resumeId}
        AND ${resumeImportLocks.operationId} = ${input.operationId}
        AND ${resumeImportLocks.leaseToken} = ${leaseToken}
    )
    AND EXISTS (
      SELECT 1 FROM ${resumeImportOperations}
      WHERE ${resumeImportOperations.ownerId} = ${ownerId}
        AND ${resumeImportOperations.operationId} = ${input.operationId}
        AND ${resumeImportOperations.requestHash} = ${input.requestHash}
        AND ${resumeImportOperations.status} IN ('staging', 'retryable_failure')
    )
    AND COALESCE((
      SELECT ${resumeSources.currentRevisionId} FROM ${resumeSources}
      WHERE ${resumeSources.ownerId} = ${ownerId}
        AND ${resumeSources.resumeId} = ${input.resumeId}
    ), '') = COALESCE(${baseCurrentRevisionId}, '')
    AND NOT EXISTS (
      SELECT 1 FROM ${resumeRevisions}
      WHERE ${resumeRevisions.ownerId} = ${ownerId}
        AND ${resumeRevisions.resumeId} = ${input.resumeId}
        AND ${resumeRevisions.revisionId} = ${input.revisionId}
        AND (
          ${resumeRevisions.sourceFingerprint} <> ${input.sourceFingerprint}
          OR COALESCE(${resumeRevisions.sourceProvider}, '') <> ${input.manifest?.sourceProvider ?? ""}
          OR COALESCE(${resumeRevisions.sourceRevisionFingerprint}, '') <> ${input.manifest?.sourceRevisionFingerprint ?? ""}
          OR COALESCE(${resumeRevisions.manifestFingerprint}, '') <> ${input.manifestFingerprint ?? ""}
          OR COALESCE(${resumeRevisions.extractionVersion}, '') <> ${input.manifest?.extractionVersion ?? ""}
          OR ${resumeRevisions.importOperationId} <> ${input.operationId}
          OR ${resumeRevisions.storageGeneration} <> ${input.storageGeneration}
          OR COALESCE(${resumeRevisions.parentRevisionId}, '') <> COALESCE(${baseCurrentRevisionId}, '')
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM ${resumeRevisions}
      WHERE ${resumeRevisions.ownerId} = ${ownerId}
        AND ${resumeRevisions.resumeId} = ${input.resumeId}
        AND ${resumeRevisions.sourceFingerprint} = ${input.sourceFingerprint}
        AND ${resumeRevisions.revisionId} <> ${input.revisionId}
    )
    AND ${fileIntegrityInvariant}
    AND ${referenceInvariant}
  `;
  const guard = d1TransactionalInvariantGuard(db, invariant);
  const statements = [
    guard,
    db.insert(resumeSources).values({
      ownerId,
      resumeId: input.resumeId,
      sourceLabel: input.sourceLabel,
      currentRevisionId: null,
      createdAt: nowMs,
      updatedAt: nowMs,
    }).onConflictDoNothing(),
    db.insert(resumeRevisions).values({
      ownerId,
      resumeId: input.resumeId,
      revisionId: input.revisionId,
      parentRevisionId: baseCurrentRevisionId,
      sourceFingerprint: input.sourceFingerprint,
      sourceProvider: input.manifest?.sourceProvider ?? null,
      sourceRevisionFingerprint: input.manifest?.sourceRevisionFingerprint ?? null,
      manifestFingerprint: input.manifestFingerprint,
      extractionVersion: input.manifest?.extractionVersion ?? null,
      importOperationId: input.operationId,
      storageGeneration: input.storageGeneration,
      visibility: "owner_private",
      importedAt: nowMs,
    }).onConflictDoNothing(),
    ...chunks((input.manifest?.bullets ?? []).map((bullet) => ({
      ownerId,
      resumeId: input.resumeId,
      revisionId: input.revisionId,
      occurrenceId: bullet.occurrenceId,
      sectionLabel: bullet.sectionLabel,
      ordinal: bullet.ordinal,
      text: bullet.text,
      contentFingerprint: bullet.contentFingerprint,
      createdAt: nowMs,
    })), 10).map((values) => db.insert(resumeBulletOccurrences).values(values).onConflictDoNothing()),
    ...chunks((input.manifest?.bullets ?? []).flatMap((bullet) => [
      ...bullet.claimIds.map((referenceId) => ({
        ownerId,
        resumeId: input.resumeId,
        revisionId: input.revisionId,
        occurrenceId: bullet.occurrenceId,
        referenceType: "claim" as const,
        referenceId,
        createdAt: nowMs,
      })),
      ...bullet.evidenceIds.map((referenceId) => ({
        ownerId,
        resumeId: input.resumeId,
        revisionId: input.revisionId,
        occurrenceId: bullet.occurrenceId,
        referenceType: "evidence" as const,
        referenceId,
        createdAt: nowMs,
      })),
    ]), 10).map((values) => db.insert(resumeBulletClaimLinks).values(values).onConflictDoNothing()),
    ...chunks(reviewImpacts, 10).map((values) => db.insert(resumeRevisionReviewImpacts).values(values).onConflictDoNothing()),
    ...input.files.map((file) => db.insert(resumeRevisionFiles).values({
      ownerId,
      resumeId: input.resumeId,
      revisionId: input.revisionId,
      format: file.format,
      sha256: file.sha256,
      byteSize: file.byteSize,
      mimeType: file.mimeType,
      visibility: "owner_private",
      createdAt: nowMs,
    }).onConflictDoNothing()),
    db.update(resumeSources).set({
      sourceLabel: input.sourceLabel,
      currentRevisionId: input.revisionId,
      updatedAt: nowMs,
    }).where(and(
      eq(resumeSources.ownerId, ownerId),
      eq(resumeSources.resumeId, input.resumeId),
    )),
    db.update(resumeImportOperations).set({
      status: "saved",
      errorCode: null,
      receipt,
      updatedAt: nowMs,
      completedAt: nowMs,
    }).where(and(
      eq(resumeImportOperations.ownerId, ownerId),
      eq(resumeImportOperations.operationId, input.operationId),
      eq(resumeImportOperations.requestHash, input.requestHash),
    )),
    db.delete(resumeImportLocks).where(and(
      eq(resumeImportLocks.ownerId, ownerId),
      eq(resumeImportLocks.resumeId, input.resumeId),
      eq(resumeImportLocks.operationId, input.operationId),
      eq(resumeImportLocks.leaseToken, leaseToken),
    )),
  ];
  try {
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
  } catch (error) {
    const authoritative = await readOperation(ownerId, input.operationId);
    if (authoritative) {
      assertOperationIdentity(authoritative, input);
      const authoritativeReceipt = savedReceipt(authoritative);
      if (authoritativeReceipt) {
        const canonical = await findResumeRevision(
          ownerId,
          input.resumeId,
          authoritativeReceipt.revisionId,
        );
        return {
          duplicate: true,
          receipt: authoritativeReceipt,
          cleanupStaging: canonical?.storageGeneration !== input.storageGeneration,
        };
      }
    }
    if (isD1TransactionalInvariantFailure(error)) {
      await failResumeImport(ownerId, input, leaseToken, "resume_import_commit_conflict", false, nowMs);
      throw new ResumeImportError(
        "resume_import_commit_conflict",
        "The immutable resume revision or current pointer changed before commit.",
        409,
        false,
      );
    }
    throw error;
  }
  return { duplicate: false, receipt, cleanupStaging: false };
}

export async function getResumeImportStatus(ownerId: string, operationId: string) {
  const operation = await readOperation(ownerId, operationId);
  if (!operation) return { found: false as const };
  const receipt = savedReceipt(operation);
  if (receipt) {
    return {
      found: true as const,
      import: {
        ...receipt,
        files: (Object.entries(receipt.files) as [ResumeFileFormat, Omit<ResumeFileIntegrity, "format">][])
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([format, file]) => ({ format, ...file })),
        retryable: false,
        errorCode: null,
      },
    };
  }
  const source = await readSource(ownerId, operation.resumeId);
  const files = await getDb().select({
    format: resumeRevisionFiles.format,
    sha256: resumeRevisionFiles.sha256,
    byteSize: resumeRevisionFiles.byteSize,
    mimeType: resumeRevisionFiles.mimeType,
  }).from(resumeRevisionFiles).where(and(
    eq(resumeRevisionFiles.ownerId, ownerId),
    eq(resumeRevisionFiles.resumeId, operation.resumeId),
    eq(resumeRevisionFiles.revisionId, operation.requestedRevisionId),
  )).orderBy(asc(resumeRevisionFiles.format)).limit(2);
  return {
    found: true as const,
    import: {
      operationId: operation.operationId,
      status: operation.status,
      unchanged: false,
      resumeId: operation.resumeId,
      revisionId: operation.requestedRevisionId,
      currentRevisionId: source?.currentRevisionId ?? null,
      files,
      retryable: operation.status === "staging" || operation.status === "retryable_failure",
      errorCode: operation.errorCode,
    },
  };
}

export async function getRecentResumeImports(ownerId: string) {
  const limit = 10;
  const rows = await getDb().select({
    operationId: resumeImportOperations.operationId,
    resumeId: resumeImportOperations.resumeId,
    revisionId: resumeImportOperations.requestedRevisionId,
    status: resumeImportOperations.status,
    errorCode: resumeImportOperations.errorCode,
    createdAt: resumeImportOperations.createdAt,
    updatedAt: resumeImportOperations.updatedAt,
    completedAt: resumeImportOperations.completedAt,
  }).from(resumeImportOperations).where(
    eq(resumeImportOperations.ownerId, ownerId),
  ).orderBy(
    desc(resumeImportOperations.updatedAt),
    desc(resumeImportOperations.operationId),
  ).limit(limit + 1);
  return {
    schemaVersion: 1 as const,
    imports: rows.slice(0, limit).map((row) => ({
      ...row,
      retryable: row.status === "staging" || row.status === "retryable_failure",
    })),
    limit: 10 as const,
    truncated: rows.length > limit,
  };
}

function storedResumeFileDeletionReceipt(
  row: typeof resumeRevisionFileDeletions.$inferSelect,
  duplicate: boolean,
) {
  if (row.status !== "deleted" || !row.receipt) return null;
  return {
    ...(row.receipt as ResumeFileDeletionReceipt),
    duplicate,
  };
}

async function readResumeFileDeletionScope(ownerId: string, resumeId: string, revisionId: string) {
  const [source, revision, files] = await Promise.all([
    readSource(ownerId, resumeId),
    findResumeRevision(ownerId, resumeId, revisionId),
    getDb().select({
      format: resumeRevisionFiles.format,
      sha256: resumeRevisionFiles.sha256,
      byteSize: resumeRevisionFiles.byteSize,
      mimeType: resumeRevisionFiles.mimeType,
    }).from(resumeRevisionFiles).where(and(
      eq(resumeRevisionFiles.ownerId, ownerId),
      eq(resumeRevisionFiles.resumeId, resumeId),
      eq(resumeRevisionFiles.revisionId, revisionId),
    )).orderBy(asc(resumeRevisionFiles.format)).limit(2),
  ]);
  if (!source || !revision || files.length !== 2
      || files[0].format !== "docx" || files[1].format !== "pdf") {
    throw new ResumeImportError(
      "resume_revision_files_not_found",
      "That complete owner-private resume file pair is unavailable.",
      404,
      false,
    );
  }
  if (source.currentRevisionId === revisionId) {
    throw new ResumeImportError(
      "resume_current_revision_files_protected",
      "Select another current resume revision before removing this private file pair.",
      409,
      false,
    );
  }
  return {
    storageGeneration: revision.storageGeneration,
    files: files as [ResumeFileIntegrity, ResumeFileIntegrity],
  };
}

export async function getResumeFileRetention(ownerId: string, resumeId: string, revisionId: string) {
  const deletion = await readResumeFileDeletionTarget(ownerId, resumeId, revisionId);
  if (!deletion) {
    return {
      state: "retained" as const,
      operationId: null,
      errorCode: null,
      updatedAt: null,
      deletedAt: null,
    };
  }
  return {
    state: deletion.status,
    operationId: deletion.operationId,
    errorCode: deletion.errorCode,
    updatedAt: deletion.updatedAt,
    deletedAt: deletion.status === "deleted" ? deletion.completedAt : null,
  };
}

export async function reserveResumeRevisionFileDeletion(
  ownerId: string,
  input: ResumeFileDeletionInput,
  nowMs = Date.now(),
) {
  if (input.authorization !== "explicit_user_instruction") {
    throw new ResumeImportError(
      "resume_file_deletion_authorization_required",
      "Private resume file deletion requires explicit owner instruction.",
      400,
      false,
    );
  }
  const reason = input.reason.normalize("NFKC").trim();
  if (!reason || reason.length > 2_000) {
    throw new ResumeImportError(
      "resume_file_deletion_reason_required",
      "Private resume file deletion requires a bounded audit reason.",
      400,
      false,
    );
  }
  const requestFingerprint = await resumeSha256Hex(JSON.stringify({ ...input, reason }));
  const existing = await readResumeFileDeletionOperation(ownerId, input.operationId);
  if (existing) {
    if (existing.requestFingerprint !== requestFingerprint
        || existing.resumeId !== input.resumeId
        || existing.revisionId !== input.revisionId) {
      throw new ResumeImportError(
        "resume_file_deletion_operation_conflict",
        "That deletion operation ID already belongs to a different immutable request.",
        409,
        false,
      );
    }
    const receipt = storedResumeFileDeletionReceipt(existing, true);
    if (receipt) return { duplicate: true as const, receipt };
    return {
      duplicate: false as const,
      requestFingerprint,
      ...(await readResumeFileDeletionScope(ownerId, input.resumeId, input.revisionId)),
    };
  }
  const priorTarget = await readResumeFileDeletionTarget(ownerId, input.resumeId, input.revisionId);
  if (priorTarget) {
    throw new ResumeImportError(
      "resume_file_deletion_already_registered",
      "That revision already has a private-file deletion operation; retry its original stable receipt.",
      409,
      false,
    );
  }
  const scope = await readResumeFileDeletionScope(ownerId, input.resumeId, input.revisionId);
  try {
    await getDb().batch([
      d1TransactionalInvariantGuard(getDb(), sql`
        EXISTS (
          SELECT 1 FROM ${resumeSources}
          WHERE ${resumeSources.ownerId} = ${ownerId}
            AND ${resumeSources.resumeId} = ${input.resumeId}
            AND COALESCE(${resumeSources.currentRevisionId}, '') <> ${input.revisionId}
        )
        AND NOT EXISTS (
          SELECT 1 FROM ${resumeRevisionFileDeletions}
          WHERE ${resumeRevisionFileDeletions.ownerId} = ${ownerId}
            AND ${resumeRevisionFileDeletions.resumeId} = ${input.resumeId}
            AND ${resumeRevisionFileDeletions.revisionId} = ${input.revisionId}
        )
      `),
      getDb().insert(resumeRevisionFileDeletions).values({
        ownerId,
        operationId: input.operationId,
        resumeId: input.resumeId,
        revisionId: input.revisionId,
        requestFingerprint,
        status: "deleting",
        errorCode: null,
        reason,
        receipt: null,
        createdAt: nowMs,
        updatedAt: nowMs,
        completedAt: null,
      }),
    ]);
  } catch (error) {
    const racedOperation = await readResumeFileDeletionOperation(ownerId, input.operationId);
    if (racedOperation?.requestFingerprint === requestFingerprint) {
      const receipt = storedResumeFileDeletionReceipt(racedOperation, true);
      if (receipt) return { duplicate: true as const, receipt };
      return { duplicate: false as const, requestFingerprint, ...scope };
    }
    if (await readResumeFileDeletionTarget(ownerId, input.resumeId, input.revisionId)) {
      throw new ResumeImportError(
        "resume_file_deletion_already_registered",
        "That revision already has a private-file deletion operation; retry its original stable receipt.",
        409,
        false,
      );
    }
    const source = await readSource(ownerId, input.resumeId);
    if (source?.currentRevisionId === input.revisionId) {
      throw new ResumeImportError(
        "resume_current_revision_files_protected",
        "Select another current resume revision before removing this private file pair.",
        409,
        false,
      );
    }
    throw error;
  }
  return { duplicate: false as const, requestFingerprint, ...scope };
}

export async function failResumeRevisionFileDeletion(
  ownerId: string,
  operationId: string,
  requestFingerprint: string,
  errorCode: string,
  nowMs = Date.now(),
) {
  await getDb().update(resumeRevisionFileDeletions).set({
    status: "retryable_failure",
    errorCode,
    updatedAt: nowMs,
  }).where(and(
    eq(resumeRevisionFileDeletions.ownerId, ownerId),
    eq(resumeRevisionFileDeletions.operationId, operationId),
    eq(resumeRevisionFileDeletions.requestFingerprint, requestFingerprint),
    sql`${resumeRevisionFileDeletions.status} <> 'deleted'`,
  ));
}

export async function completeResumeRevisionFileDeletion(
  ownerId: string,
  input: ResumeFileDeletionInput,
  requestFingerprint: string,
  nowMs = Date.now(),
) {
  const existing = await readResumeFileDeletionOperation(ownerId, input.operationId);
  if (!existing || existing.requestFingerprint !== requestFingerprint
      || existing.resumeId !== input.resumeId || existing.revisionId !== input.revisionId) {
    throw new ResumeImportError(
      "resume_file_deletion_operation_conflict",
      "The private-file deletion receipt no longer matches this exact request.",
      409,
      false,
    );
  }
  const replay = storedResumeFileDeletionReceipt(existing, true);
  if (replay) return replay;
  const receipt: ResumeFileDeletionReceipt = {
    operationId: input.operationId,
    status: "deleted",
    resumeId: input.resumeId,
    revisionId: input.revisionId,
    deletedFormats: ["docx", "pdf"],
    preserved: ["revision", "integrity", "wording", "semantic_links", "activity_context"],
    deletedAt: nowMs,
  };
  const invariant = sql`
    EXISTS (
      SELECT 1 FROM ${resumeRevisionFileDeletions}
      WHERE ${resumeRevisionFileDeletions.ownerId} = ${ownerId}
        AND ${resumeRevisionFileDeletions.operationId} = ${input.operationId}
        AND ${resumeRevisionFileDeletions.requestFingerprint} = ${requestFingerprint}
        AND ${resumeRevisionFileDeletions.resumeId} = ${input.resumeId}
        AND ${resumeRevisionFileDeletions.revisionId} = ${input.revisionId}
        AND ${resumeRevisionFileDeletions.status} IN ('deleting', 'retryable_failure')
    )
    AND EXISTS (
      SELECT 1 FROM ${resumeSources}
      WHERE ${resumeSources.ownerId} = ${ownerId}
        AND ${resumeSources.resumeId} = ${input.resumeId}
        AND COALESCE(${resumeSources.currentRevisionId}, '') <> ${input.revisionId}
    )
    AND 2 = (
      SELECT COUNT(*) FROM ${resumeRevisionFiles}
      WHERE ${resumeRevisionFiles.ownerId} = ${ownerId}
        AND ${resumeRevisionFiles.resumeId} = ${input.resumeId}
        AND ${resumeRevisionFiles.revisionId} = ${input.revisionId}
    )
  `;
  try {
    await getDb().batch([
      d1TransactionalInvariantGuard(getDb(), invariant),
      getDb().update(resumeRevisionFileDeletions).set({
        status: "deleted",
        errorCode: null,
        receipt,
        updatedAt: nowMs,
        completedAt: nowMs,
      }).where(and(
        eq(resumeRevisionFileDeletions.ownerId, ownerId),
        eq(resumeRevisionFileDeletions.operationId, input.operationId),
        eq(resumeRevisionFileDeletions.requestFingerprint, requestFingerprint),
      )),
    ]);
  } catch (error) {
    const raced = await readResumeFileDeletionOperation(ownerId, input.operationId);
    const racedReceipt = raced ? storedResumeFileDeletionReceipt(raced, true) : null;
    if (racedReceipt) return racedReceipt;
    if (isD1TransactionalInvariantFailure(error)) {
      throw new ResumeImportError(
        "resume_file_deletion_commit_conflict",
        "The resume current pointer changed before the private-file deletion receipt committed.",
        409,
        false,
      );
    }
    throw error;
  }
  return { ...receipt, duplicate: false as const };
}

interface ResumeLibraryRow {
  resumeId: string;
  sourceLabel: string;
  currentRevisionId: string | null;
  sourceUpdatedAt: number;
  revisionId: string | null;
  parentRevisionId: string | null;
  importedAt: number | null;
  revisionRank: number | null;
  format: ResumeFileFormat | null;
  sha256: string | null;
  byteSize: number | null;
  mimeType: string | null;
  deletionOperationId: string | null;
  deletionStatus: "deleting" | "retryable_failure" | "deleted" | null;
  deletionErrorCode: string | null;
  deletionUpdatedAt: number | null;
  deletionCompletedAt: number | null;
}

export async function getResumeLibrary(ownerId: string) {
  const result = await env.DB.prepare(`
    WITH bounded_sources AS (
      SELECT owner_id, resume_id, source_label, current_revision_id, updated_at
      FROM resume_sources
      WHERE owner_id = ?1
      ORDER BY updated_at DESC, resume_id ASC
      LIMIT ?2
    ), ranked_revisions AS (
      SELECT
        revision.*,
        ROW_NUMBER() OVER (
          PARTITION BY revision.owner_id, revision.resume_id
          ORDER BY revision.imported_at DESC, revision.revision_id DESC
        ) AS revision_rank
      FROM resume_revisions revision
      INNER JOIN bounded_sources source
        ON source.owner_id = revision.owner_id
       AND source.resume_id = revision.resume_id
    )
    SELECT
      source.resume_id AS resumeId,
      source.source_label AS sourceLabel,
      source.current_revision_id AS currentRevisionId,
      source.updated_at AS sourceUpdatedAt,
      revision.revision_id AS revisionId,
      revision.parent_revision_id AS parentRevisionId,
      revision.imported_at AS importedAt,
      revision.revision_rank AS revisionRank,
      file.format AS format,
      file.sha256 AS sha256,
      file.byte_size AS byteSize,
      file.mime_type AS mimeType,
      deletion.operation_id AS deletionOperationId,
      deletion.status AS deletionStatus,
      deletion.error_code AS deletionErrorCode,
      deletion.updated_at AS deletionUpdatedAt,
      deletion.completed_at AS deletionCompletedAt
    FROM bounded_sources source
    LEFT JOIN ranked_revisions revision
      ON revision.owner_id = source.owner_id
     AND revision.resume_id = source.resume_id
     AND revision.revision_rank <= ?3
    LEFT JOIN resume_revision_files file
      ON file.owner_id = revision.owner_id
     AND file.resume_id = revision.resume_id
     AND file.revision_id = revision.revision_id
    LEFT JOIN resume_revision_file_deletions deletion
      ON deletion.owner_id = revision.owner_id
     AND deletion.resume_id = revision.resume_id
     AND deletion.revision_id = revision.revision_id
    ORDER BY
      source.updated_at DESC,
      source.resume_id ASC,
      revision.imported_at DESC,
      revision.revision_id DESC,
      file.format ASC
  `).bind(
    ownerId,
    RESUME_LIBRARY_SOURCE_LIMIT + 1,
    RESUME_LIBRARY_REVISION_LIMIT + 1,
  ).all<ResumeLibraryRow>();

  const sourceRows = new Map<string, {
    resumeId: string;
    sourceLabel: string;
    currentRevisionId: string | null;
    updatedAt: number;
    revisions: Map<string, {
      revisionId: string;
      parentRevisionId: string | null;
      importedAt: number;
      current: boolean;
      files: Array<{
        format: ResumeFileFormat;
        sha256: string;
        byteSize: number;
        mimeType: string;
        downloadPath: string | null;
        retention: {
          state: "retained" | "deleting" | "retryable_failure" | "deleted";
          operationId: string | null;
          errorCode: string | null;
          updatedAt: number | null;
          deletedAt: number | null;
        };
      }>;
    }>;
  }>();
  let revisionsTruncated = false;
  for (const row of result.results) {
    let source = sourceRows.get(row.resumeId);
    if (!source) {
      source = {
        resumeId: row.resumeId,
        sourceLabel: isDisplaySafeResumeSourceLabel(row.sourceLabel) ? row.sourceLabel : "Private resume",
        currentRevisionId: row.currentRevisionId,
        updatedAt: row.sourceUpdatedAt,
        revisions: new Map(),
      };
      sourceRows.set(row.resumeId, source);
    }
    if (!row.revisionId || !row.importedAt || !row.revisionRank) continue;
    if (row.revisionRank > RESUME_LIBRARY_REVISION_LIMIT) {
      revisionsTruncated = true;
      continue;
    }
    let revision = source.revisions.get(row.revisionId);
    if (!revision) {
      revision = {
        revisionId: row.revisionId,
        parentRevisionId: row.parentRevisionId,
        importedAt: row.importedAt,
        current: row.revisionId === source.currentRevisionId,
        files: [],
      };
      source.revisions.set(row.revisionId, revision);
    }
    if (row.format && row.sha256 && row.byteSize && row.mimeType) {
      revision.files.push({
        format: row.format,
        sha256: row.sha256,
        byteSize: row.byteSize,
        mimeType: row.mimeType,
        downloadPath: row.deletionStatus
          ? null
          : `/api/resume-library/${row.resumeId}/${row.revisionId}/${row.format}`,
        retention: {
          state: row.deletionStatus ?? "retained",
          operationId: row.deletionOperationId,
          errorCode: row.deletionErrorCode,
          updatedAt: row.deletionUpdatedAt,
          deletedAt: row.deletionStatus === "deleted" ? row.deletionCompletedAt : null,
        },
      });
    }
  }

  const sources = [...sourceRows.values()];
  return {
    schemaVersion: 1 as const,
    sources: sources.slice(0, RESUME_LIBRARY_SOURCE_LIMIT).map(({ revisions, ...source }) => ({
      ...source,
      revisions: [...revisions.values()],
    })),
    limits: {
      sources: RESUME_LIBRARY_SOURCE_LIMIT as 20,
      revisionsPerSource: RESUME_LIBRARY_REVISION_LIMIT as 20,
    },
    truncated: {
      sources: sources.length > RESUME_LIBRARY_SOURCE_LIMIT,
      revisions: revisionsTruncated,
    },
  };
}

interface ResumeRevisionReferenceRow {
  resumeId: string;
  sourceLabel: string | null;
  revisionId: string;
  revisionKnown: number;
}

export async function getResumeRevisionReferences(
  ownerId: string,
  references: Array<{ resumeId: string; revisionId: string }>,
) {
  const unique = [...new Map(references.map((reference) => [
    `${reference.resumeId}\u0000${reference.revisionId}`,
    reference,
  ])).values()];
  if (unique.length === 0) return new Map<string, { label: string | null; revisionKnown: boolean }>();
  if (unique.length > 100) throw new Error("Resume revision reference read exceeds its bound.");

  const result = await env.DB.prepare(`
    WITH requested AS (
      SELECT
        json_extract(value, '$.resumeId') AS resume_id,
        json_extract(value, '$.revisionId') AS revision_id
      FROM json_each(?2)
    )
    SELECT
      requested.resume_id AS resumeId,
      source.source_label AS sourceLabel,
      requested.revision_id AS revisionId,
      CASE WHEN revision.revision_id IS NULL THEN 0 ELSE 1 END AS revisionKnown
    FROM requested
    LEFT JOIN resume_sources source
      ON source.owner_id = ?1
     AND source.resume_id = requested.resume_id
    LEFT JOIN resume_revisions revision
      ON revision.owner_id = ?1
     AND revision.resume_id = requested.resume_id
     AND revision.revision_id = requested.revision_id
  `).bind(ownerId, JSON.stringify(unique)).all<ResumeRevisionReferenceRow>();

  return new Map(result.results.map((row) => [
    `${row.resumeId}\u0000${row.revisionId}`,
    {
      label: row.sourceLabel && isDisplaySafeResumeSourceLabel(row.sourceLabel)
        ? row.sourceLabel
        : row.sourceLabel ? "Private resume" : null,
      revisionKnown: row.revisionKnown === 1,
    },
  ]));
}

function revisionDownloadPath(resumeId: string, revisionId: string, format: ResumeFileFormat) {
  return `/api/resume-library/${resumeId}/${revisionId}/${format}`;
}

export async function getResumeRevision(
  ownerId: string,
  resumeId: string,
  revisionId?: string,
) {
  const source = await readSource(ownerId, resumeId);
  const selectedRevisionId = revisionId ?? source?.currentRevisionId ?? null;
  if (!source || !selectedRevisionId) return { found: false as const };
  const revisionRows = await getDb().select().from(resumeRevisions).where(and(
    eq(resumeRevisions.ownerId, ownerId),
    eq(resumeRevisions.resumeId, resumeId),
    eq(resumeRevisions.revisionId, selectedRevisionId),
  )).limit(1);
  const revision = revisionRows[0];
  if (!revision) return { found: false as const };
  const [files, bullets, links, impacts, retention] = await Promise.all([
    getDb().select({
      format: resumeRevisionFiles.format,
      sha256: resumeRevisionFiles.sha256,
      byteSize: resumeRevisionFiles.byteSize,
      mimeType: resumeRevisionFiles.mimeType,
    }).from(resumeRevisionFiles).where(and(
      eq(resumeRevisionFiles.ownerId, ownerId),
      eq(resumeRevisionFiles.resumeId, resumeId),
      eq(resumeRevisionFiles.revisionId, selectedRevisionId),
    )).orderBy(asc(resumeRevisionFiles.format)).limit(2),
    getDb().select({
      occurrenceId: resumeBulletOccurrences.occurrenceId,
      sectionLabel: resumeBulletOccurrences.sectionLabel,
      ordinal: resumeBulletOccurrences.ordinal,
      text: resumeBulletOccurrences.text,
      contentFingerprint: resumeBulletOccurrences.contentFingerprint,
    }).from(resumeBulletOccurrences).where(and(
      eq(resumeBulletOccurrences.ownerId, ownerId),
      eq(resumeBulletOccurrences.resumeId, resumeId),
      eq(resumeBulletOccurrences.revisionId, selectedRevisionId),
    )).orderBy(asc(resumeBulletOccurrences.ordinal)).limit(241),
    getDb().select({
      occurrenceId: resumeBulletClaimLinks.occurrenceId,
      referenceType: resumeBulletClaimLinks.referenceType,
      referenceId: resumeBulletClaimLinks.referenceId,
    }).from(resumeBulletClaimLinks).where(and(
      eq(resumeBulletClaimLinks.ownerId, ownerId),
      eq(resumeBulletClaimLinks.resumeId, resumeId),
      eq(resumeBulletClaimLinks.revisionId, selectedRevisionId),
    )).orderBy(asc(resumeBulletClaimLinks.occurrenceId), asc(resumeBulletClaimLinks.referenceType), asc(resumeBulletClaimLinks.referenceId)).limit(401),
    getDb().select({
      questionId: resumeRevisionReviewImpacts.questionId,
      solutionProfileRevision: resumeRevisionReviewImpacts.solutionProfileRevision,
      changedClaimIds: resumeRevisionReviewImpacts.changedClaimIds,
      status: resumeRevisionReviewImpacts.status,
      createdAt: resumeRevisionReviewImpacts.createdAt,
      acknowledgedAt: resumeRevisionReviewImpacts.acknowledgedAt,
    }).from(resumeRevisionReviewImpacts).where(and(
      eq(resumeRevisionReviewImpacts.ownerId, ownerId),
      eq(resumeRevisionReviewImpacts.resumeId, resumeId),
      eq(resumeRevisionReviewImpacts.revisionId, selectedRevisionId),
    )).orderBy(asc(resumeRevisionReviewImpacts.questionId)).limit(101),
    getResumeFileRetention(ownerId, resumeId, selectedRevisionId),
  ]);
  const references = new Map<string, { claimIds: string[]; evidenceIds: string[] }>();
  for (const link of links.slice(0, 400)) {
    const entry = references.get(link.occurrenceId) ?? { claimIds: [], evidenceIds: [] };
    entry[link.referenceType === "claim" ? "claimIds" : "evidenceIds"].push(link.referenceId);
    references.set(link.occurrenceId, entry);
  }
  return {
    found: true as const,
    schemaVersion: 1 as const,
    source: {
      resumeId: source.resumeId,
      sourceLabel: isDisplaySafeResumeSourceLabel(source.sourceLabel) ? source.sourceLabel : "Private resume",
      currentRevisionId: source.currentRevisionId,
      updatedAt: source.updatedAt,
    },
    revision: {
      revisionId: revision.revisionId,
      parentRevisionId: revision.parentRevisionId,
      current: source.currentRevisionId === revision.revisionId,
      sourceFingerprint: revision.sourceFingerprint,
      sourceProvider: revision.sourceProvider,
      sourceRevisionFingerprint: revision.sourceRevisionFingerprint,
      manifestFingerprint: revision.manifestFingerprint,
      extractionVersion: revision.extractionVersion,
      importedAt: revision.importedAt,
      files: files.map((file) => ({
        ...file,
        downloadPath: retention.state === "retained"
          ? revisionDownloadPath(resumeId, revision.revisionId, file.format)
          : null,
        retention,
      })),
      bullets: bullets.slice(0, 240).map((bullet) => ({
        ...bullet,
        ...(references.get(bullet.occurrenceId) ?? { claimIds: [], evidenceIds: [] }),
      })),
      reviewImpacts: impacts.slice(0, 100),
      truncated: {
        bullets: bullets.length > 240,
        links: links.length > 400,
        reviewImpacts: impacts.length > 100,
      },
    },
  };
}

function stringDelta(before: string[], after: string[]) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((value) => !beforeSet.has(value)),
    removed: before.filter((value) => !afterSet.has(value)),
  };
}

export async function compareResumeRevisions(
  ownerId: string,
  resumeId: string,
  fromRevisionId: string,
  toRevisionId: string,
) {
  const [from, to] = await Promise.all([
    getResumeRevision(ownerId, resumeId, fromRevisionId),
    getResumeRevision(ownerId, resumeId, toRevisionId),
  ]);
  if (!from.found || !to.found) return { found: false as const };
  const fromById = new Map(from.revision.bullets.map((bullet) => [bullet.occurrenceId, bullet]));
  const toById = new Map(to.revision.bullets.map((bullet) => [bullet.occurrenceId, bullet]));
  const added = to.revision.bullets.filter((bullet) => !fromById.has(bullet.occurrenceId));
  const removed = from.revision.bullets.filter((bullet) => !toById.has(bullet.occurrenceId));
  const changed = to.revision.bullets.flatMap((after) => {
    const before = fromById.get(after.occurrenceId);
    if (!before) return [];
    const claimDelta = stringDelta(before.claimIds, after.claimIds);
    const evidenceDelta = stringDelta(before.evidenceIds, after.evidenceIds);
    const contentChanged = before.contentFingerprint !== after.contentFingerprint;
    const positionChanged = before.sectionLabel !== after.sectionLabel || before.ordinal !== after.ordinal;
    const linksChanged = Boolean(
      claimDelta.added.length || claimDelta.removed.length
      || evidenceDelta.added.length || evidenceDelta.removed.length,
    );
    return contentChanged || positionChanged || linksChanged ? [{
      occurrenceId: after.occurrenceId,
      before,
      after,
      changes: { contentChanged, positionChanged, claimDelta, evidenceDelta },
    }] : [];
  });
  const unchanged = to.revision.bullets
    .filter((bullet) => fromById.has(bullet.occurrenceId) && !changed.some((item) => item.occurrenceId === bullet.occurrenceId))
    .map((bullet) => bullet.occurrenceId);
  const fromClaimIds = [...new Set(from.revision.bullets.flatMap((bullet) => bullet.claimIds))].sort();
  const toClaimIds = [...new Set(to.revision.bullets.flatMap((bullet) => bullet.claimIds))].sort();
  const fromEvidenceIds = [...new Set(from.revision.bullets.flatMap((bullet) => bullet.evidenceIds))].sort();
  const toEvidenceIds = [...new Set(to.revision.bullets.flatMap((bullet) => bullet.evidenceIds))].sort();
  return {
    found: true as const,
    schemaVersion: 1 as const,
    resumeId,
    fromRevisionId,
    toRevisionId,
    summary: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      unchanged: unchanged.length,
    },
    added,
    removed,
    changed,
    unchangedOccurrenceIds: unchanged,
    references: {
      claims: stringDelta(fromClaimIds, toClaimIds),
      evidence: stringDelta(fromEvidenceIds, toEvidenceIds),
    },
  };
}

export async function setCurrentResumeRevision(
  ownerId: string,
  input: { operationId: string; resumeId: string; revisionId: string },
  nowMs = Date.now(),
) {
  const requestFingerprint = await resumeSha256Hex(JSON.stringify(input));
  const existingRows = await getDb().select().from(resumeCurrentRevisionOperations).where(and(
    eq(resumeCurrentRevisionOperations.ownerId, ownerId),
    eq(resumeCurrentRevisionOperations.operationId, input.operationId),
  )).limit(1);
  const existing = existingRows[0];
  if (existing) {
    if (existing.requestFingerprint !== requestFingerprint
      || existing.resumeId !== input.resumeId
      || existing.revisionId !== input.revisionId) {
      throw new ResumeImportError(
        "resume_current_revision_operation_conflict",
        "That operation ID already belongs to a different current-resume selection.",
        409,
        false,
      );
    }
    return { ...(existing.receipt as ResumeCurrentRevisionReceipt), duplicate: true as const };
  }
  const [source, revision, retention] = await Promise.all([
    readSource(ownerId, input.resumeId),
    findResumeRevision(ownerId, input.resumeId, input.revisionId),
    getResumeFileRetention(ownerId, input.resumeId, input.revisionId),
  ]);
  if (!source || !revision) {
    throw new ResumeImportError(
      "resume_revision_not_found",
      "That owner-private resume revision is unavailable.",
      404,
      false,
    );
  }
  if (retention.state !== "retained") {
    throw new ResumeImportError(
      "resume_revision_files_unavailable",
      "A resume revision with deleting or deleted private files cannot become current.",
      409,
      false,
    );
  }
  const priorRevisionId = source.currentRevisionId;
  const receipt = {
    operationId: input.operationId,
    status: "saved" as const,
    unchanged: priorRevisionId === input.revisionId,
    resumeId: input.resumeId,
    priorRevisionId,
    currentRevisionId: input.revisionId,
    selectedAt: nowMs,
  };
  const invariant = sql`
    EXISTS (
      SELECT 1 FROM ${resumeSources}
      WHERE ${resumeSources.ownerId} = ${ownerId}
        AND ${resumeSources.resumeId} = ${input.resumeId}
        AND COALESCE(${resumeSources.currentRevisionId}, '') = COALESCE(${priorRevisionId}, '')
    )
    AND EXISTS (
      SELECT 1 FROM ${resumeRevisions}
      WHERE ${resumeRevisions.ownerId} = ${ownerId}
        AND ${resumeRevisions.resumeId} = ${input.resumeId}
        AND ${resumeRevisions.revisionId} = ${input.revisionId}
    )
    AND NOT EXISTS (
      SELECT 1 FROM ${resumeRevisionFileDeletions}
      WHERE ${resumeRevisionFileDeletions.ownerId} = ${ownerId}
        AND ${resumeRevisionFileDeletions.resumeId} = ${input.resumeId}
        AND ${resumeRevisionFileDeletions.revisionId} = ${input.revisionId}
    )
    AND NOT EXISTS (
      SELECT 1 FROM ${resumeCurrentRevisionOperations}
      WHERE ${resumeCurrentRevisionOperations.ownerId} = ${ownerId}
        AND ${resumeCurrentRevisionOperations.operationId} = ${input.operationId}
    )
  `;
  try {
    await getDb().batch([
      d1TransactionalInvariantGuard(getDb(), invariant),
      getDb().update(resumeSources).set({
        currentRevisionId: input.revisionId,
        updatedAt: nowMs,
      }).where(and(
        eq(resumeSources.ownerId, ownerId),
        eq(resumeSources.resumeId, input.resumeId),
      )),
      getDb().insert(resumeCurrentRevisionOperations).values({
        ownerId,
        operationId: input.operationId,
        resumeId: input.resumeId,
        revisionId: input.revisionId,
        requestFingerprint,
        priorRevisionId,
        receipt,
        createdAt: nowMs,
      }),
    ]);
  } catch (error) {
    const replayRows = await getDb().select().from(resumeCurrentRevisionOperations).where(and(
      eq(resumeCurrentRevisionOperations.ownerId, ownerId),
      eq(resumeCurrentRevisionOperations.operationId, input.operationId),
    )).limit(1);
    const replay = replayRows[0];
    if (replay && replay.requestFingerprint === requestFingerprint) {
      return { ...(replay.receipt as ResumeCurrentRevisionReceipt), duplicate: true as const };
    }
    if (isD1TransactionalInvariantFailure(error)) {
      throw new ResumeImportError(
        "resume_current_revision_conflict",
        "The current resume changed; reread the Resume Library before selecting a revision.",
        409,
        false,
      );
    }
    throw error;
  }
  return { duplicate: false as const, ...receipt };
}

export async function backfillActivityResumeContext(
  ownerId: string,
  inputValue: BackfillActivityResumeContextInput,
  nowMs = Date.now(),
) {
  const input = backfillActivityResumeContextSchema.parse(inputValue);
  if (input.ownerConfirmedAt > nowMs + 5 * 60_000 || input.provenance.snapshotLoadedAt > nowMs + 5 * 60_000) {
    throw new ResumeImportError(
      "resume_context_backfill_future_provenance",
      "Historical resume-context provenance cannot be recorded in the future.",
      400,
      false,
    );
  }
  const requestFingerprint = await resumeSha256Hex(JSON.stringify({
    operationId: input.operationId,
    activityId: input.activityId,
    snapshotRevision: input.snapshotRevision,
    resumeId: input.resumeId,
    resumeRevisionId: input.resumeRevisionId,
    provenance: input.provenance,
    authorization: input.authorization,
    ownerConfirmedAt: input.ownerConfirmedAt,
    reason: input.reason,
  }));
  const db = getDb();
  const existingOperationRows = await db.select().from(activityResumeContextBackfills).where(and(
    eq(activityResumeContextBackfills.ownerId, ownerId),
    eq(activityResumeContextBackfills.operationId, input.operationId),
  )).limit(1);
  const existingOperation = existingOperationRows[0];
  if (existingOperation) {
    if (existingOperation.requestFingerprint !== requestFingerprint) {
      throw new ResumeImportError(
        "resume_context_backfill_operation_conflict",
        "This historical resume-context operation ID is already bound to a different request.",
        409,
        false,
      );
    }
    return {
      ...(existingOperation.receipt as ActivityResumeContextBackfillReceipt),
      duplicate: true as const,
    };
  }

  const [snapshotRows, sourceRows, revisionRows, fileRows, existingContextRows] = await Promise.all([
    db.select().from(behavioralFinalAnswerSnapshots).where(and(
      eq(behavioralFinalAnswerSnapshots.ownerId, ownerId),
      eq(behavioralFinalAnswerSnapshots.activityId, input.activityId),
      eq(behavioralFinalAnswerSnapshots.snapshotRevision, input.snapshotRevision),
    )).limit(1),
    db.select().from(resumeSources).where(and(
      eq(resumeSources.ownerId, ownerId),
      eq(resumeSources.resumeId, input.resumeId),
    )).limit(1),
    db.select().from(resumeRevisions).where(and(
      eq(resumeRevisions.ownerId, ownerId),
      eq(resumeRevisions.resumeId, input.resumeId),
      eq(resumeRevisions.revisionId, input.resumeRevisionId),
    )).limit(1),
    db.select({
      format: resumeRevisionFiles.format,
      sha256: resumeRevisionFiles.sha256,
    }).from(resumeRevisionFiles).where(and(
      eq(resumeRevisionFiles.ownerId, ownerId),
      eq(resumeRevisionFiles.resumeId, input.resumeId),
      eq(resumeRevisionFiles.revisionId, input.resumeRevisionId),
    )).orderBy(asc(resumeRevisionFiles.format)).limit(3),
    db.select().from(activityResumeContexts).where(and(
      eq(activityResumeContexts.ownerId, ownerId),
      eq(activityResumeContexts.activityId, input.activityId),
      eq(activityResumeContexts.snapshotRevision, input.snapshotRevision),
    )).limit(1),
  ]);
  if (existingContextRows[0]) {
    throw new ResumeImportError(
      "resume_context_backfill_target_conflict",
      "This immutable activity snapshot already has resume context; it cannot be replaced or relabeled.",
      409,
      false,
    );
  }
  if (!snapshotRows[0]) {
    throw new ResumeImportError(
      "resume_context_backfill_snapshot_unavailable",
      "The exact owner-private behavioral snapshot is unavailable and must remain legacy unversioned.",
      409,
      false,
    );
  }
  if (!sourceRows[0] || !revisionRows[0]) {
    throw new ResumeImportError(
      "resume_context_backfill_revision_unavailable",
      "The exact owner-private resume revision is unavailable.",
      409,
      false,
    );
  }
  const filesByFormat = new Map(fileRows.map((file) => [file.format, file]));
  const docx = filesByFormat.get("docx");
  const pdf = filesByFormat.get("pdf");
  if (
    fileRows.length !== 2
    || revisionRows[0].sourceFingerprint !== input.provenance.sourceFingerprint
    || revisionRows[0].importedAt !== input.provenance.resumeImportedAt
    || docx?.sha256 !== input.provenance.docxSha256
    || pdf?.sha256 !== input.provenance.pdfSha256
  ) {
    throw new ResumeImportError(
      "resume_context_backfill_provenance_mismatch",
      "The owner-confirmed historical relationship does not match the exact immutable resume snapshot fingerprints.",
      409,
      false,
    );
  }

  let snapshot;
  try {
    snapshot = behavioralFinalAnswerSnapshotInputSchema.parse(snapshotRows[0].snapshot);
  } catch {
    throw new ResumeImportError(
      "resume_context_backfill_snapshot_unsupported",
      "The historical answer lacks a valid immutable snapshot and must remain legacy unversioned.",
      409,
      false,
    );
  }
  const analysis = snapshot.behavioralAnalysis;
  if (!analysis) {
    throw new ResumeImportError(
      "resume_context_backfill_snapshot_unsupported",
      "The historical answer lacks exact typed analysis and must remain legacy unversioned.",
      409,
      false,
    );
  }
  const claimTexts = [...new Set(analysis.claimAudit.map((claim) => claim.claim))];
  const claimRows = claimTexts.length ? await db.select({
    claimId: behavioralClaims.claimId,
  }).from(behavioralClaims).where(and(
    eq(behavioralClaims.ownerId, ownerId),
    eq(behavioralClaims.questionId, snapshot.question.questionId),
    inArray(behavioralClaims.text, claimTexts),
  )).orderBy(asc(behavioralClaims.claimId)).limit(101) : [];
  const evidenceIds = [...new Set([
    ...snapshot.acceptedEvidenceIds,
    ...analysis.claimAudit.flatMap((claim) => claim.contraryEvidenceIds),
  ])].sort();
  if (claimRows.length > 100 || evidenceIds.length > 100) {
    throw new ResumeImportError(
      "resume_context_backfill_too_large",
      "The exact historical claim or evidence context exceeds the bounded snapshot limit.",
      409,
      false,
    );
  }
  const claimIds = claimRows.map((row) => row.claimId);
  const receipt: ActivityResumeContextBackfillReceipt = {
    operationId: input.operationId,
    status: "saved",
    state: "backfilled",
    activityId: input.activityId,
    snapshotRevision: input.snapshotRevision,
    resumeId: input.resumeId,
    resumeRevisionId: input.resumeRevisionId,
    claimIds,
    evidenceIds,
    capturedAt: nowMs,
  };
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, sql`NOT EXISTS (
        SELECT 1 FROM ${activityResumeContextBackfills}
        WHERE ${activityResumeContextBackfills.ownerId} = ${ownerId}
          AND ${activityResumeContextBackfills.operationId} = ${input.operationId}
      )`),
      d1TransactionalInvariantGuard(db, sql`NOT EXISTS (
        SELECT 1 FROM ${activityResumeContexts}
        WHERE ${activityResumeContexts.ownerId} = ${ownerId}
          AND ${activityResumeContexts.activityId} = ${input.activityId}
          AND ${activityResumeContexts.snapshotRevision} = ${input.snapshotRevision}
      )`),
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${behavioralFinalAnswerSnapshots}
        WHERE ${behavioralFinalAnswerSnapshots.ownerId} = ${ownerId}
          AND ${behavioralFinalAnswerSnapshots.activityId} = ${input.activityId}
          AND ${behavioralFinalAnswerSnapshots.snapshotRevision} = ${input.snapshotRevision}
      )`),
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${resumeSources}
        WHERE ${resumeSources.ownerId} = ${ownerId}
          AND ${resumeSources.resumeId} = ${input.resumeId}
          AND ${resumeSources.sourceLabel} = ${sourceRows[0].sourceLabel}
      )`),
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${resumeRevisions}
        WHERE ${resumeRevisions.ownerId} = ${ownerId}
          AND ${resumeRevisions.resumeId} = ${input.resumeId}
          AND ${resumeRevisions.revisionId} = ${input.resumeRevisionId}
          AND ${resumeRevisions.sourceFingerprint} = ${input.provenance.sourceFingerprint}
          AND ${resumeRevisions.importedAt} = ${input.provenance.resumeImportedAt}
      )`),
      d1TransactionalInvariantGuard(db, sql`(
        SELECT COUNT(*) FROM ${resumeRevisionFiles}
        WHERE ${resumeRevisionFiles.ownerId} = ${ownerId}
          AND ${resumeRevisionFiles.resumeId} = ${input.resumeId}
          AND ${resumeRevisionFiles.revisionId} = ${input.resumeRevisionId}
          AND (
            (${resumeRevisionFiles.format} = 'docx' AND ${resumeRevisionFiles.sha256} = ${input.provenance.docxSha256})
            OR (${resumeRevisionFiles.format} = 'pdf' AND ${resumeRevisionFiles.sha256} = ${input.provenance.pdfSha256})
          )
      ) = 2`),
      ...(claimRows.length ? [d1TransactionalInvariantGuard(db, sql`(
        SELECT COUNT(*) FROM ${behavioralClaims}
        WHERE ${behavioralClaims.ownerId} = ${ownerId}
          AND ${behavioralClaims.questionId} = ${snapshot.question.questionId}
          AND ${inArray(behavioralClaims.claimId, claimIds)}
          AND ${inArray(behavioralClaims.text, claimTexts)}
      ) = ${claimRows.length}`)] : []),
      db.insert(activityResumeContextBackfills).values({
        ownerId,
        operationId: input.operationId,
        activityId: input.activityId,
        snapshotRevision: input.snapshotRevision,
        resumeId: input.resumeId,
        resumeRevisionId: input.resumeRevisionId,
        requestFingerprint,
        sourceFingerprint: input.provenance.sourceFingerprint,
        docxSha256: input.provenance.docxSha256,
        pdfSha256: input.provenance.pdfSha256,
        resumeImportedAt: input.provenance.resumeImportedAt,
        snapshotLoadedAt: input.provenance.snapshotLoadedAt,
        ownerConfirmedAt: input.ownerConfirmedAt,
        reason: input.reason,
        receipt,
        createdAt: nowMs,
      }),
      db.insert(activityResumeContexts).values({
        ownerId,
        activityId: input.activityId,
        snapshotRevision: input.snapshotRevision,
        resumeId: input.resumeId,
        resumeRevisionId: input.resumeRevisionId,
        sourceLabel: sourceRows[0].sourceLabel,
        resumeImportedAt: revisionRows[0].importedAt,
        state: "backfilled",
        claimIds,
        evidenceIds,
        capturedAt: nowMs,
      }),
    ] as unknown as Parameters<typeof db.batch>[0]);
  } catch (error) {
    const racedRows = await db.select().from(activityResumeContextBackfills).where(and(
      eq(activityResumeContextBackfills.ownerId, ownerId),
      eq(activityResumeContextBackfills.operationId, input.operationId),
    )).limit(1);
    if (racedRows[0]?.requestFingerprint === requestFingerprint) {
      return {
        ...(racedRows[0].receipt as ActivityResumeContextBackfillReceipt),
        duplicate: true as const,
      };
    }
    if (isD1TransactionalInvariantFailure(error)) {
      throw new ResumeImportError(
        "resume_context_backfill_dependency_conflict",
        "The immutable activity or resume provenance changed before the historical link committed; reread before retrying.",
        409,
        false,
      );
    }
    throw error;
  }
  return { duplicate: false as const, ...receipt };
}

export async function getActivityResumeContext(
  ownerId: string,
  activityId: string,
  snapshotRevision?: number,
) {
  const rows = await getDb().select().from(activityResumeContexts).where(and(
    eq(activityResumeContexts.ownerId, ownerId),
    eq(activityResumeContexts.activityId, activityId),
    ...(snapshotRevision ? [eq(activityResumeContexts.snapshotRevision, snapshotRevision)] : []),
  )).orderBy(desc(activityResumeContexts.snapshotRevision)).limit(101);
  if (!rows.length) {
    const exactSnapshot = await getDb().select({
      snapshotRevision: behavioralFinalAnswerSnapshots.snapshotRevision,
    }).from(behavioralFinalAnswerSnapshots).where(and(
      eq(behavioralFinalAnswerSnapshots.ownerId, ownerId),
      eq(behavioralFinalAnswerSnapshots.activityId, activityId),
      ...(snapshotRevision ? [eq(behavioralFinalAnswerSnapshots.snapshotRevision, snapshotRevision)] : []),
    )).limit(1);
    return {
      found: false,
      contexts: [],
      truncated: false,
      ...(exactSnapshot[0] ? { provenanceState: "legacy_unversioned" as const } : {}),
    };
  }
  return {
    found: true,
    contexts: rows.slice(0, 100).map((row) => ({
      schemaVersion: 1 as const,
      activityId: row.activityId,
      snapshotRevision: row.snapshotRevision,
      resumeId: row.resumeId,
      resumeRevisionId: row.resumeRevisionId,
      sourceLabel: row.sourceLabel,
      resumeImportedAt: row.resumeImportedAt,
      state: row.state,
      claimIds: row.claimIds,
      evidenceIds: row.evidenceIds,
      capturedAt: row.capturedAt,
    })),
    truncated: rows.length > 100,
  };
}

interface ResumeReferenceUsageRow {
  resumeId: string;
  revisionId: string;
  occurrenceId: string;
  sectionLabel: string;
  ordinal: number;
  importedAt: number;
  currentRevisionId: string | null;
}

interface ActivityResumeReferenceUsageRow {
  activityId: string;
  snapshotRevision: number;
  resumeId: string;
  resumeRevisionId: string;
  state: "contemporaneous" | "backfilled";
  capturedAt: number;
}

export async function queryResumeReferenceUsage(
  ownerId: string,
  referenceType: "claim" | "evidence",
  referenceId: string,
) {
  const [revisionResult, activityResult] = await Promise.all([
    env.DB.prepare(`
      SELECT
        link.resume_id AS resumeId,
        link.revision_id AS revisionId,
        link.occurrence_id AS occurrenceId,
        occurrence.section_label AS sectionLabel,
        occurrence.ordinal AS ordinal,
        revision.imported_at AS importedAt,
        source.current_revision_id AS currentRevisionId
      FROM resume_bullet_claim_links link
      INNER JOIN resume_bullet_occurrences occurrence
        ON occurrence.owner_id = link.owner_id
       AND occurrence.resume_id = link.resume_id
       AND occurrence.revision_id = link.revision_id
       AND occurrence.occurrence_id = link.occurrence_id
      INNER JOIN resume_revisions revision
        ON revision.owner_id = link.owner_id
       AND revision.resume_id = link.resume_id
       AND revision.revision_id = link.revision_id
      INNER JOIN resume_sources source
        ON source.owner_id = link.owner_id
       AND source.resume_id = link.resume_id
      WHERE link.owner_id = ?1
        AND link.reference_type = ?2
        AND link.reference_id = ?3
      ORDER BY revision.imported_at DESC, link.resume_id ASC, occurrence.section_label ASC, occurrence.ordinal ASC
      LIMIT 101
    `).bind(ownerId, referenceType, referenceId).all<ResumeReferenceUsageRow>(),
    env.DB.prepare(`
      SELECT
        context.activity_id AS activityId,
        context.snapshot_revision AS snapshotRevision,
        context.resume_id AS resumeId,
        context.resume_revision_id AS resumeRevisionId,
        context.state AS state,
        context.captured_at AS capturedAt
      FROM activity_resume_contexts context
      WHERE context.owner_id = ?1
        AND EXISTS (
          SELECT 1 FROM json_each(
            CASE WHEN ?2 = 'claim' THEN context.claim_ids ELSE context.evidence_ids END
          ) reference
          WHERE reference.value = ?3
        )
      ORDER BY context.captured_at DESC, context.activity_id ASC, context.snapshot_revision DESC
      LIMIT 101
    `).bind(ownerId, referenceType, referenceId).all<ActivityResumeReferenceUsageRow>(),
  ]);
  return {
    schemaVersion: 1 as const,
    referenceType,
    referenceId,
    revisionOccurrences: revisionResult.results.slice(0, 100).map((row) => ({
      ...row,
      current: row.revisionId === row.currentRevisionId,
    })),
    activityContexts: activityResult.results.slice(0, 100),
    truncated: {
      revisionOccurrences: revisionResult.results.length > 100,
      activityContexts: activityResult.results.length > 100,
    },
  };
}

export async function readResumeRevisionFile(
  ownerId: string,
  resumeId: string,
  revisionId: string,
  format: ResumeFileFormat,
) {
  const [rows, retention] = await Promise.all([getDb().select({
    storageGeneration: resumeRevisions.storageGeneration,
    sha256: resumeRevisionFiles.sha256,
    byteSize: resumeRevisionFiles.byteSize,
    mimeType: resumeRevisionFiles.mimeType,
  }).from(resumeRevisionFiles)
    .innerJoin(resumeRevisions, and(
      eq(resumeRevisions.ownerId, resumeRevisionFiles.ownerId),
      eq(resumeRevisions.resumeId, resumeRevisionFiles.resumeId),
      eq(resumeRevisions.revisionId, resumeRevisionFiles.revisionId),
    ))
    .where(and(
      eq(resumeRevisionFiles.ownerId, ownerId),
      eq(resumeRevisionFiles.resumeId, resumeId),
      eq(resumeRevisionFiles.revisionId, revisionId),
      eq(resumeRevisionFiles.format, format),
    )).limit(1), getResumeFileRetention(ownerId, resumeId, revisionId)]);
  return rows[0] ? { ...rows[0], retention } : null;
}
