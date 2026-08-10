import { and, asc, eq, lte, or, sql } from "drizzle-orm";

import { d1TransactionalInvariantGuard, isD1TransactionalInvariantFailure } from "./d1-transactional-guard";
import { getDb } from "./index";
import {
  resumeImportLocks,
  resumeImportOperations,
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
  importedAt: number;
  currentRevisionId: string;
  files: Record<ResumeFileFormat, Omit<ResumeFileIntegrity, "format">>;
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
  files: [ResumeFileIntegrity, ResumeFileIntegrity];
}

const LOCK_LEASE_MS = 5 * 60 * 1_000;

function sameNullable(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? null) === (right ?? null);
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
      leaseExpiresAt,
      createdAt: nowMs,
      updatedAt: nowMs,
    }).onConflictDoUpdate({
      target: [resumeImportLocks.ownerId, resumeImportLocks.resumeId],
      set: {
        operationId: input.operationId,
        leaseExpiresAt,
        updatedAt: nowMs,
      },
      where: or(
        eq(resumeImportLocks.operationId, input.operationId),
        lte(resumeImportLocks.leaseExpiresAt, nowMs),
      ),
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
  if (lock?.operationId !== input.operationId) {
    throw new ResumeImportError(
      "resume_import_busy",
      "Another immutable revision is currently being staged for this resume.",
      409,
      true,
    );
  }

  const authoritativeSource = await readSource(ownerId, input.resumeId);
  if (!sameNullable(authoritativeSource?.currentRevisionId, operation.baseCurrentRevisionId)) {
    await failResumeImport(ownerId, input, "resume_import_stale_current", false, nowMs);
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
  ));
  return {
    duplicate: false as const,
    baseCurrentRevisionId: operation.baseCurrentRevisionId,
  };
}

export async function failResumeImport(
  ownerId: string,
  input: ReserveResumeImportInput,
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
    )),
    db.delete(resumeImportLocks).where(and(
      eq(resumeImportLocks.ownerId, ownerId),
      eq(resumeImportLocks.resumeId, input.resumeId),
      eq(resumeImportLocks.operationId, input.operationId),
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
  return { revision, files };
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
  canonical: {
    revisionId: string;
    parentRevisionId: string | null;
    sourceFingerprint: string;
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
      await failResumeImport(ownerId, input, "resume_import_commit_conflict", false, nowMs);
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
  nowMs = Date.now(),
) {
  const db = getDb();
  const operation = await readOperation(ownerId, input.operationId);
  if (!operation) throw new Error("Resume import operation was not reserved.");
  assertOperationIdentity(operation, input);
  const replay = savedReceipt(operation);
  if (replay) return { duplicate: true, receipt: replay };

  const files = Object.fromEntries(input.files.map(({ format, ...file }) => [format, file])) as ResumeImportReceipt["files"];
  const baseCurrentRevisionId = operation.baseCurrentRevisionId;
  const receipt: ResumeImportReceipt = {
    operationId: input.operationId,
    status: "saved",
    unchanged: false,
    resumeId: input.resumeId,
    revisionId: input.revisionId,
    parentRevisionId: baseCurrentRevisionId,
    sourceFingerprint: input.sourceFingerprint,
    importedAt: nowMs,
    currentRevisionId: input.revisionId,
    files,
  };
  const invariant = sql`
    EXISTS (
      SELECT 1 FROM ${resumeImportLocks}
      WHERE ${resumeImportLocks.ownerId} = ${ownerId}
        AND ${resumeImportLocks.resumeId} = ${input.resumeId}
        AND ${resumeImportLocks.operationId} = ${input.operationId}
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
          OR ${resumeRevisions.importOperationId} <> ${input.operationId}
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
    AND NOT EXISTS (
      SELECT 1 FROM ${resumeRevisionFiles}
      WHERE ${resumeRevisionFiles.ownerId} = ${ownerId}
        AND ${resumeRevisionFiles.resumeId} = ${input.resumeId}
        AND ${resumeRevisionFiles.revisionId} = ${input.revisionId}
        AND ${resumeRevisionFiles.format} = ${input.files[0].format}
        AND (
          ${resumeRevisionFiles.sha256} <> ${input.files[0].sha256}
          OR ${resumeRevisionFiles.byteSize} <> ${input.files[0].byteSize}
          OR ${resumeRevisionFiles.mimeType} <> ${input.files[0].mimeType}
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM ${resumeRevisionFiles}
      WHERE ${resumeRevisionFiles.ownerId} = ${ownerId}
        AND ${resumeRevisionFiles.resumeId} = ${input.resumeId}
        AND ${resumeRevisionFiles.revisionId} = ${input.revisionId}
        AND ${resumeRevisionFiles.format} = ${input.files[1].format}
        AND (
          ${resumeRevisionFiles.sha256} <> ${input.files[1].sha256}
          OR ${resumeRevisionFiles.byteSize} <> ${input.files[1].byteSize}
          OR ${resumeRevisionFiles.mimeType} <> ${input.files[1].mimeType}
        )
    )
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
      importOperationId: input.operationId,
      visibility: "owner_private",
      importedAt: nowMs,
    }).onConflictDoNothing(),
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
    )),
  ];
  try {
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
  } catch (error) {
    const authoritative = await readOperation(ownerId, input.operationId);
    if (authoritative) {
      assertOperationIdentity(authoritative, input);
      const authoritativeReceipt = savedReceipt(authoritative);
      if (authoritativeReceipt) return { duplicate: true, receipt: authoritativeReceipt };
    }
    if (isD1TransactionalInvariantFailure(error)) {
      await failResumeImport(ownerId, input, "resume_import_commit_conflict", false, nowMs);
      throw new ResumeImportError(
        "resume_import_commit_conflict",
        "The immutable resume revision or current pointer changed before commit.",
        409,
        false,
      );
    }
    throw error;
  }
  return { duplicate: false, receipt };
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
