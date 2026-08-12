import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { isDisplaySafeResumeSourceLabel } from "./resume-revision-policy";
import { resumeSha256Hex, type ResumeRevisionManifest } from "./resume-revision-manifest";

import { d1TransactionalInvariantGuard, isD1TransactionalInvariantFailure } from "./d1-transactional-guard";
import { getDb } from "./index";
import {
  behavioralClaims,
  behavioralEvidenceItems,
  activityResumeContexts,
  problemSolutionProfiles,
  resumeBulletClaimLinks,
  resumeBulletOccurrences,
  resumeCurrentRevisionOperations,
  resumeImportLocks,
  resumeImportOperations,
  resumeRevisionReviewImpacts,
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
  return { revision, files, bulletCount: Number(bulletCountRows[0]?.count ?? 0) };
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
      file.mime_type AS mimeType
    FROM bounded_sources source
    LEFT JOIN ranked_revisions revision
      ON revision.owner_id = source.owner_id
     AND revision.resume_id = source.resume_id
     AND revision.revision_rank <= ?3
    LEFT JOIN resume_revision_files file
      ON file.owner_id = revision.owner_id
     AND file.resume_id = revision.resume_id
     AND file.revision_id = revision.revision_id
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
        downloadPath: string;
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
        downloadPath: `/api/resume-library/${row.resumeId}/${row.revisionId}/${row.format}`,
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
  const [files, bullets, links, impacts] = await Promise.all([
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
        downloadPath: revisionDownloadPath(resumeId, revision.revisionId, file.format),
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
  const [source, revision] = await Promise.all([
    readSource(ownerId, input.resumeId),
    findResumeRevision(ownerId, input.resumeId, input.revisionId),
  ]);
  if (!source || !revision) {
    throw new ResumeImportError(
      "resume_revision_not_found",
      "That owner-private resume revision is unavailable.",
      404,
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
  return {
    found: rows.length > 0,
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
  const rows = await getDb().select({
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
    )).limit(1);
  return rows[0] ?? null;
}
