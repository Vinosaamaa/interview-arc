import { createHash } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { d1TransactionalInvariantGuard } from "./d1-transactional-guard.ts";
import { getDb } from "./index.ts";
import {
  createSuppliedInterviewTranscriptParser,
  InterviewPackageContentError,
  interviewPackageObjectLocator,
  interviewPackageSignatureMatches,
} from "./interview-package-content-policy.ts";
import {
  cancelInterviewPackageUploadSchema,
  completeInterviewPackageUploadSchema,
  declareInterviewPackageSourceSchema,
  deleteInterviewPackageSchema,
  INTERVIEW_PACKAGE_MAX_FILES,
  INTERVIEW_PACKAGE_MAX_TOTAL_BYTES,
  INTERVIEW_PACKAGE_PART_BYTES,
  INTERVIEW_PACKAGE_UPLOAD_TTL_MS,
  type InterviewPackageSourceKind,
} from "./interview-package-policy.ts";
import {
  deriveInterviewPackageId,
  InterviewPackageError,
  interviewPackageRequestFingerprint,
  interviewPackageSha256,
  rawInterviewPackage,
  rawInterviewPackageOperation,
} from "./interview-packages.ts";
import {
  interviewPackageOperations,
  interviewPackageEntries,
  interviewPackageEntryRevisions,
  interviewPackageMaterialLinks,
  interviewPackageMaterialProposals,
  interviewPackages,
  interviewPackageSources,
  interviewPackageUploadParts,
  interviewPackageUploadSessions,
} from "./schema.ts";

export type InterviewPackageBucket = Pick<R2Bucket,
  "createMultipartUpload" | "resumeMultipartUpload" | "head" | "get" | "delete">;

function storageFailure(message: string) {
  return new InterviewPackageError("interview_package_storage_unavailable", message, true);
}

export { interviewPackageObjectLocator, interviewPackageSignatureMatches };
export { parseSuppliedInterviewTranscript } from "./interview-package-content-policy.ts";

export async function declareInterviewPackageSource(
  ownerId: string,
  inputValue: unknown,
  bucket: InterviewPackageBucket,
  nowMs = Date.now(),
) {
  const input = declareInterviewPackageSourceSchema.parse(inputValue);
  const requestFingerprint = await interviewPackageRequestFingerprint(input);
  const replay = await rawInterviewPackageOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const current = await rawInterviewPackage(ownerId, input.packageId);
  if (current.revision !== input.expectedRevision || current.status === "deleting" || current.status === "deleted") {
    throw new InterviewPackageError("interview_package_revision_conflict", "The package changed; reread it before adding this file.");
  }
  const db = getDb();
  const aggregateRows = await db.select({
    count: sql<number>`count(*)`,
    bytes: sql<number>`coalesce(sum(${interviewPackageSources.sizeBytes}),0)`,
  }).from(interviewPackageSources).where(and(
    eq(interviewPackageSources.ownerId, ownerId), eq(interviewPackageSources.packageId, input.packageId), sql`${interviewPackageSources.state} <> 'deleted'`,
  ));
  if (Number(aggregateRows[0]?.count ?? 0) >= INTERVIEW_PACKAGE_MAX_FILES) {
    throw new InterviewPackageError("interview_package_file_limit", "One package can contain at most 20 file sources.");
  }
  if (Number(aggregateRows[0]?.bytes ?? 0) + input.sizeBytes > INTERVIEW_PACKAGE_MAX_TOTAL_BYTES) {
    throw new InterviewPackageError("interview_package_size_limit", "The package would exceed its 2 GB total file limit.");
  }
  const sourceId = await deriveInterviewPackageId("source", ownerId, input.operationId);
  const sessionId = await deriveInterviewPackageId("upload", ownerId, input.operationId);
  const privateLocator = await interviewPackageObjectLocator(ownerId, input.packageId, sourceId);
  let multipart: R2MultipartUpload;
  try {
    multipart = await bucket.createMultipartUpload(privateLocator, {
      httpMetadata: { contentType: input.mediaType },
      customMetadata: { namespace: "interview-package", kind: input.kind },
    });
  } catch {
    throw storageFailure("The private upload session could not be created. Retry the exact operation.");
  }
  const packageRevision = current.revision + 1;
  const receipt = {
    status: "upload_declared" as const,
    packageId: input.packageId,
    packageRevision,
    sourceId,
    sessionId,
    partBytes: INTERVIEW_PACKAGE_PART_BYTES,
    expiresAt: nowMs + INTERVIEW_PACKAGE_UPLOAD_TTL_MS,
  };
  const unchanged = sql`EXISTS (SELECT 1 FROM ${interviewPackages}
    WHERE ${interviewPackages.ownerId}=${ownerId} AND ${interviewPackages.packageId}=${input.packageId}
      AND ${interviewPackages.revision}=${input.expectedRevision} AND ${interviewPackages.status} NOT IN ('deleting','deleted'))`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, unchanged),
      db.insert(interviewPackageSources).values({
        ownerId, packageId: input.packageId, sourceId, kind: input.kind, state: "uploading", revision: 1,
        label: input.label, mediaType: input.mediaType, sizeBytes: input.sizeBytes, contentHash: null,
        privateLocator, objectEtag: null, transcriptRepresentation: null, rejectionCode: null,
        createdAt: nowMs, updatedAt: nowMs,
      }),
      db.insert(interviewPackageUploadSessions).values({
        ownerId, sessionId, packageId: input.packageId, sourceId, operationId: input.operationId,
        requestFingerprint, privateLocator, r2UploadId: multipart.uploadId, expectedBytes: input.sizeBytes,
        status: "open", expiresAt: nowMs + INTERVIEW_PACKAGE_UPLOAD_TTL_MS, createdAt: nowMs, updatedAt: nowMs,
      }),
      db.update(interviewPackages).set({ revision: packageRevision, status: "uploading", manifestDigest: null, updatedAt: nowMs }).where(and(
        eq(interviewPackages.ownerId, ownerId), eq(interviewPackages.packageId, input.packageId), eq(interviewPackages.revision, input.expectedRevision),
      )),
      db.insert(interviewPackageOperations).values({ ownerId, operationId: input.operationId, packageId: input.packageId, action: "declare_source", requestFingerprint, receipt, createdAt: nowMs }),
    ]);
  } catch {
    try { await multipart.abort(); } catch { /* The stale multipart lifecycle expires independently. */ }
    const racedReplay = await rawInterviewPackageOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    throw new InterviewPackageError("interview_package_source_conflict", "The package changed while creating the upload session; reread it.");
  }
  return { ...receipt, duplicate: false };
}

async function requireUpload(ownerId: string, packageId: string, sourceId: string, nowMs: number) {
  const rows = await getDb().select().from(interviewPackageUploadSessions).where(and(
    eq(interviewPackageUploadSessions.ownerId, ownerId),
    eq(interviewPackageUploadSessions.packageId, packageId),
    eq(interviewPackageUploadSessions.sourceId, sourceId),
  )).limit(1);
  const session = rows[0];
  if (!session) throw new InterviewPackageError("interview_package_upload_not_found", "That owner-private upload session is unavailable.");
  if (session.status === "open" && session.expiresAt <= nowMs) {
    await getDb().update(interviewPackageUploadSessions).set({ status: "expired", updatedAt: nowMs }).where(and(
      eq(interviewPackageUploadSessions.ownerId, ownerId), eq(interviewPackageUploadSessions.sessionId, session.sessionId), eq(interviewPackageUploadSessions.status, "open"),
    ));
    await getDb().update(interviewPackageSources).set({ state: "expired", updatedAt: nowMs }).where(and(
      eq(interviewPackageSources.ownerId, ownerId), eq(interviewPackageSources.sourceId, sourceId), eq(interviewPackageSources.state, "uploading"),
    ));
    throw new InterviewPackageError("interview_package_upload_expired", "That upload session expired; remove it and start a new source upload.");
  }
  return session;
}

export async function uploadInterviewPackagePart(
  ownerId: string,
  input: { packageId: string; sourceId: string; operationId: string; partNumber: number },
  bytes: Uint8Array,
  bucket: InterviewPackageBucket,
  nowMs = Date.now(),
) {
  if (!Number.isInteger(input.partNumber) || input.partNumber < 1 || input.partNumber > 10_000) {
    throw new InterviewPackageError("interview_package_part_invalid", "Use a valid multipart part number.");
  }
  if (bytes.byteLength === 0 || bytes.byteLength > INTERVIEW_PACKAGE_PART_BYTES) {
    throw new InterviewPackageError("interview_package_part_invalid", "Each upload part must be non-empty and no larger than 5 MB.");
  }
  const session = await requireUpload(ownerId, input.packageId, input.sourceId, nowMs);
  if (session.status !== "open") {
    throw new InterviewPackageError("interview_package_upload_not_open", "That upload session is no longer open.");
  }
  const contentHash = await interviewPackageSha256(bytes);
  const requestFingerprint = await interviewPackageRequestFingerprint({ ...input, byteCount: bytes.byteLength, contentHash });
  const replay = await rawInterviewPackageOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const existing = await getDb().select().from(interviewPackageUploadParts).where(and(
    eq(interviewPackageUploadParts.ownerId, ownerId),
    eq(interviewPackageUploadParts.sessionId, session.sessionId),
    eq(interviewPackageUploadParts.partNumber, input.partNumber),
  )).limit(1);
  if (existing[0]) {
    if (existing[0].contentHash !== contentHash || existing[0].byteCount !== bytes.byteLength) {
      throw new InterviewPackageError("interview_package_part_conflict", "That part number already belongs to different bytes.");
    }
    return { status: "part_uploaded" as const, packageId: input.packageId, sourceId: input.sourceId, partNumber: input.partNumber, byteCount: bytes.byteLength, duplicate: true };
  }
  let uploaded: R2UploadedPart;
  try {
    uploaded = await bucket.resumeMultipartUpload(session.privateLocator, session.r2UploadId).uploadPart(input.partNumber, bytes);
  } catch {
    throw storageFailure("That private upload part could not be stored. Retry the exact part.");
  }
  const receipt = { status: "part_uploaded" as const, packageId: input.packageId, sourceId: input.sourceId, partNumber: input.partNumber, byteCount: bytes.byteLength };
  try {
    await getDb().batch([
      dbInsertPart(ownerId, session.sessionId, input.partNumber, bytes.byteLength, contentHash, uploaded.etag, nowMs),
      getDb().insert(interviewPackageOperations).values({ ownerId, operationId: input.operationId, packageId: input.packageId, action: "upload_part", requestFingerprint, receipt, createdAt: nowMs }),
    ]);
  } catch {
    const racedReplay = await rawInterviewPackageOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    const raced = await getDb().select().from(interviewPackageUploadParts).where(and(
      eq(interviewPackageUploadParts.ownerId, ownerId), eq(interviewPackageUploadParts.sessionId, session.sessionId), eq(interviewPackageUploadParts.partNumber, input.partNumber),
    )).limit(1);
    if (raced[0]?.contentHash === contentHash && raced[0].byteCount === bytes.byteLength) return { ...receipt, duplicate: true };
    throw new InterviewPackageError("interview_package_part_conflict", "That upload part conflicted with another request.");
  }
  return { ...receipt, duplicate: false };
}

function dbInsertPart(ownerId: string, sessionId: string, partNumber: number, byteCount: number, contentHash: string, etag: string, createdAt: number) {
  return getDb().insert(interviewPackageUploadParts).values({ ownerId, sessionId, partNumber, byteCount, contentHash, etag, createdAt });
}

async function inspectStoredObject(
  bucket: InterviewPackageBucket,
  locator: string,
  expectedBytes: number,
  kind: InterviewPackageSourceKind,
  mediaType: string,
) {
  const object = await bucket.get(locator);
  if (!object?.body || object.size !== expectedBytes) throw storageFailure("The stored source failed exact R2 readback.");
  const hash = createHash("sha256");
  const reader = object.body.getReader();
  const prefix = new Uint8Array(64);
  let prefixLength = 0;
  const decoder = kind === "transcript" || (kind === "document" && mediaType !== "application/pdf")
    ? new TextDecoder("utf-8", { fatal: true })
    : null;
  const transcriptParser = kind === "transcript" ? createSuppliedInterviewTranscriptParser(mediaType) : null;
  let textSample = "";
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      hash.update(value);
      if (prefixLength < prefix.length) {
        const amount = Math.min(prefix.length - prefixLength, value.byteLength);
        prefix.set(value.subarray(0, amount), prefixLength);
        prefixLength += amount;
      }
      if (decoder) {
        const decoded = decoder.decode(value, { stream: true });
        transcriptParser?.push(decoded);
        if (textSample.length < 2_000) textSample += decoded.slice(0, 2_000 - textSample.length);
      }
    }
    const tail = decoder?.decode() ?? "";
    transcriptParser?.push(tail);
    if (textSample.length < 2_000) textSample += tail.slice(0, 2_000 - textSample.length);
  } catch {
    throw new InterviewPackageError("interview_package_encoding_mismatch", "The supplied text source is not valid UTF-8.");
  }
  if (total !== expectedBytes) throw storageFailure("The stored source byte count changed during verification.");
  if (!interviewPackageSignatureMatches(kind, mediaType, prefix.subarray(0, prefixLength), decoder ? textSample : undefined)) {
    throw new InterviewPackageError("interview_package_signature_mismatch", "The stored bytes do not match the declared safe file format.");
  }
  return {
    contentHash: hash.digest("hex"),
    transcriptRepresentation: transcriptParser ? (() => {
      try {
        return transcriptParser.finish();
      } catch (error) {
        if (error instanceof InterviewPackageContentError) {
          throw new InterviewPackageError(error.code, error.message);
        }
        throw error;
      }
    })() : null,
    etag: object.etag,
  };
}

export async function completeInterviewPackageUpload(
  ownerId: string,
  inputValue: unknown,
  bucket: InterviewPackageBucket,
  nowMs = Date.now(),
) {
  const input = completeInterviewPackageUploadSchema.parse(inputValue);
  const requestFingerprint = await interviewPackageRequestFingerprint(input);
  const replay = await rawInterviewPackageOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const session = await requireUpload(ownerId, input.packageId, input.sourceId, nowMs);
  const sourceRows = await getDb().select().from(interviewPackageSources).where(and(
    eq(interviewPackageSources.ownerId, ownerId), eq(interviewPackageSources.packageId, input.packageId), eq(interviewPackageSources.sourceId, input.sourceId),
  )).limit(1);
  const source = sourceRows[0];
  if (!source || (session.status !== "open" && session.status !== "completing")) {
    throw new InterviewPackageError("interview_package_upload_not_open", "That upload is not available for completion.");
  }
  const parts = await getDb().select().from(interviewPackageUploadParts).where(and(
    eq(interviewPackageUploadParts.ownerId, ownerId), eq(interviewPackageUploadParts.sessionId, session.sessionId),
  )).orderBy(asc(interviewPackageUploadParts.partNumber));
  const byteCount = parts.reduce((total, part) => total + part.byteCount, 0);
  if (!parts.length || byteCount !== session.expectedBytes
      || parts.some((part, index) => part.partNumber !== index + 1)
      || parts.slice(0, -1).some((part) => part.byteCount !== INTERVIEW_PACKAGE_PART_BYTES)) {
    throw new InterviewPackageError("interview_package_upload_incomplete", "Upload every contiguous 5 MB part before completing this source.");
  }
  let existingHead: R2Object | null;
  try {
    existingHead = await bucket.head(session.privateLocator);
  } catch {
    throw storageFailure("The private source completion state is temporarily unavailable.");
  }
  if (session.status === "open") {
    const claimed = await getDb().update(interviewPackageUploadSessions).set({ status: "completing", updatedAt: nowMs }).where(and(
      eq(interviewPackageUploadSessions.ownerId, ownerId), eq(interviewPackageUploadSessions.sessionId, session.sessionId), eq(interviewPackageUploadSessions.status, "open"),
    )).returning({ sessionId: interviewPackageUploadSessions.sessionId });
    if (claimed.length !== 1) {
      throw new InterviewPackageError("interview_package_completion_in_progress", "Another request is completing this source. Retry the exact completion.", true);
    }
  } else if (!existingHead || existingHead.size !== session.expectedBytes) {
    throw new InterviewPackageError("interview_package_completion_in_progress", "This source is still completing. Retry the exact completion.", true);
  }
  try {
    if (!existingHead || existingHead.size !== session.expectedBytes) {
      await bucket.resumeMultipartUpload(session.privateLocator, session.r2UploadId).complete(parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag })));
    }
    const head = await bucket.head(session.privateLocator);
    if (!head || head.size !== session.expectedBytes || head.customMetadata?.namespace !== "interview-package" || head.customMetadata?.kind !== source.kind) {
      throw storageFailure("The completed private source failed R2 metadata readback.");
    }
    const inspected = await inspectStoredObject(bucket, session.privateLocator, session.expectedBytes, source.kind, source.mediaType);
    const duplicateRows = await getDb().select({ sourceId: interviewPackageSources.sourceId }).from(interviewPackageSources).where(and(
      eq(interviewPackageSources.ownerId, ownerId), eq(interviewPackageSources.contentHash, inspected.contentHash), eq(interviewPackageSources.state, "ready"),
    )).limit(1);
    if (duplicateRows[0]) {
      throw new InterviewPackageError("interview_package_duplicate_source", "Those exact bytes already exist in one of your ready Interview Package sources.");
    }
    const current = await rawInterviewPackage(ownerId, input.packageId);
    const packageRevision = current.revision + 1;
    const receipt = { status: "source_ready" as const, packageId: input.packageId, packageRevision, sourceId: input.sourceId, contentHash: inspected.contentHash, sizeBytes: session.expectedBytes };
    const db = getDb();
    const unchanged = sql`EXISTS (SELECT 1 FROM ${interviewPackages}
      WHERE ${interviewPackages.ownerId}=${ownerId} AND ${interviewPackages.packageId}=${input.packageId}
        AND ${interviewPackages.revision}=${current.revision} AND ${interviewPackages.status} NOT IN ('deleting','deleted'))
      AND EXISTS (SELECT 1 FROM ${interviewPackageSources}
      WHERE ${interviewPackageSources.ownerId}=${ownerId} AND ${interviewPackageSources.sourceId}=${input.sourceId}
        AND ${interviewPackageSources.revision}=${source.revision} AND ${interviewPackageSources.state}='uploading')
      AND EXISTS (SELECT 1 FROM ${interviewPackageUploadSessions}
      WHERE ${interviewPackageUploadSessions.ownerId}=${ownerId} AND ${interviewPackageUploadSessions.sessionId}=${session.sessionId}
        AND ${interviewPackageUploadSessions.status}='completing')`;
    await db.batch([
      d1TransactionalInvariantGuard(db, unchanged),
      db.update(interviewPackageSources).set({ state: "ready", revision: source.revision + 1, contentHash: inspected.contentHash, objectEtag: inspected.etag, transcriptRepresentation: inspected.transcriptRepresentation, rejectionCode: null, updatedAt: nowMs }).where(and(
        eq(interviewPackageSources.ownerId, ownerId), eq(interviewPackageSources.sourceId, input.sourceId), eq(interviewPackageSources.state, "uploading"),
      )),
      db.update(interviewPackageUploadSessions).set({ status: "completed", updatedAt: nowMs }).where(and(
        eq(interviewPackageUploadSessions.ownerId, ownerId), eq(interviewPackageUploadSessions.sessionId, session.sessionId), eq(interviewPackageUploadSessions.status, "completing"),
      )),
      db.delete(interviewPackageUploadParts).where(and(
        eq(interviewPackageUploadParts.ownerId, ownerId), eq(interviewPackageUploadParts.sessionId, session.sessionId),
      )),
      db.update(interviewPackages).set({ revision: packageRevision, status: "draft", manifestDigest: null, updatedAt: nowMs }).where(and(
        eq(interviewPackages.ownerId, ownerId), eq(interviewPackages.packageId, input.packageId), eq(interviewPackages.revision, current.revision),
      )),
      db.insert(interviewPackageOperations).values({ ownerId, operationId: input.operationId, packageId: input.packageId, action: "complete_upload", requestFingerprint, receipt, createdAt: nowMs }),
    ]);
    return { ...receipt, duplicate: false };
  } catch (error) {
    if (error instanceof InterviewPackageError && !error.retryable) {
      try { await bucket.delete(session.privateLocator); } catch { throw storageFailure("The rejected private object could not be reconciled."); }
      await rejectUpload(ownerId, input, session.sessionId, error.code, requestFingerprint, nowMs);
      throw error;
    }
    if (error instanceof InterviewPackageError) throw error;
    throw storageFailure("The private source could not be completed and verified. Retry the exact completion.");
  }
}

async function rejectUpload(
  ownerId: string,
  input: { packageId: string; sourceId: string; operationId: string },
  sessionId: string,
  rejectionCode: string,
  requestFingerprint: string,
  nowMs: number,
) {
  const receipt = { status: "source_rejected" as const, packageId: input.packageId, sourceId: input.sourceId, code: rejectionCode };
  try {
    await getDb().batch([
      getDb().update(interviewPackageSources).set({ state: "rejected", rejectionCode, privateLocator: null, objectEtag: null, updatedAt: nowMs }).where(and(
        eq(interviewPackageSources.ownerId, ownerId), eq(interviewPackageSources.sourceId, input.sourceId),
      )),
      getDb().update(interviewPackageUploadSessions).set({ status: "rejected", updatedAt: nowMs }).where(and(
        eq(interviewPackageUploadSessions.ownerId, ownerId), eq(interviewPackageUploadSessions.sessionId, sessionId),
      )),
      getDb().insert(interviewPackageOperations).values({ ownerId, operationId: input.operationId, packageId: input.packageId, action: "complete_upload", requestFingerprint, receipt, createdAt: nowMs }),
    ]);
  } catch {
    const replay = await rawInterviewPackageOperation(ownerId, input.operationId, requestFingerprint);
    if (!replay) throw storageFailure("The rejected source state could not be reconciled.");
  }
}

export async function cancelInterviewPackageUpload(
  ownerId: string,
  inputValue: unknown,
  bucket: InterviewPackageBucket,
  nowMs = Date.now(),
) {
  const input = cancelInterviewPackageUploadSchema.parse(inputValue);
  const requestFingerprint = await interviewPackageRequestFingerprint(input);
  const replay = await rawInterviewPackageOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const session = await requireUpload(ownerId, input.packageId, input.sourceId, nowMs);
  if (session.status !== "open" && session.status !== "completing") {
    throw new InterviewPackageError("interview_package_upload_not_open", "Only an unfinished upload can be cancelled.");
  }
  try {
    const head = await bucket.head(session.privateLocator);
    if (head) await bucket.delete(session.privateLocator);
    else {
      try { await bucket.resumeMultipartUpload(session.privateLocator, session.r2UploadId).abort(); } catch {
        // An exact retry may reach an already-aborted multipart upload. With no
        // completed object present, D1 remains the authoritative cancellation receipt.
      }
    }
  } catch {
    throw storageFailure("The private upload could not be cancelled. Retry the exact operation.");
  }
  const current = await rawInterviewPackage(ownerId, input.packageId);
  const packageRevision = current.revision + 1;
  const receipt = { status: "upload_cancelled" as const, packageId: input.packageId, packageRevision, sourceId: input.sourceId };
  const db = getDb();
  const unchanged = sql`EXISTS (SELECT 1 FROM ${interviewPackages}
    WHERE ${interviewPackages.ownerId}=${ownerId} AND ${interviewPackages.packageId}=${input.packageId}
      AND ${interviewPackages.revision}=${current.revision} AND ${interviewPackages.status} NOT IN ('deleting','deleted'))
    AND EXISTS (SELECT 1 FROM ${interviewPackageSources}
    WHERE ${interviewPackageSources.ownerId}=${ownerId} AND ${interviewPackageSources.sourceId}=${input.sourceId}
      AND ${interviewPackageSources.state}='uploading')
    AND EXISTS (SELECT 1 FROM ${interviewPackageUploadSessions}
    WHERE ${interviewPackageUploadSessions.ownerId}=${ownerId} AND ${interviewPackageUploadSessions.sessionId}=${session.sessionId}
      AND ${interviewPackageUploadSessions.status} IN ('open','completing'))`;
  try {
    await db.batch([
    d1TransactionalInvariantGuard(db, unchanged),
    db.update(interviewPackageUploadSessions).set({ status: "cancelled", updatedAt: nowMs }).where(and(
      eq(interviewPackageUploadSessions.ownerId, ownerId), eq(interviewPackageUploadSessions.sessionId, session.sessionId),
    )),
    db.update(interviewPackageSources).set({ state: "deleted", privateLocator: null, objectEtag: null, updatedAt: nowMs }).where(and(
      eq(interviewPackageSources.ownerId, ownerId), eq(interviewPackageSources.sourceId, input.sourceId),
    )),
    db.update(interviewPackages).set({ revision: packageRevision, status: "draft", manifestDigest: null, updatedAt: nowMs }).where(and(
      eq(interviewPackages.ownerId, ownerId), eq(interviewPackages.packageId, input.packageId), eq(interviewPackages.revision, current.revision),
    )),
    db.insert(interviewPackageOperations).values({ ownerId, operationId: input.operationId, packageId: input.packageId, action: "cancel_upload", requestFingerprint, receipt, createdAt: nowMs }),
  ]);
  } catch {
    const racedReplay = await rawInterviewPackageOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    throw new InterviewPackageError("interview_package_cancel_conflict", "The package changed while cancelling the upload; reread and retry.", true);
  }
  return { ...receipt, duplicate: false };
}

function safeDownloadName(label: string, mediaType: string) {
  const extension = new Map([
    ["audio/mpeg", ".mp3"], ["audio/mp4", ".m4a"], ["audio/wav", ".wav"], ["audio/webm", ".webm"], ["audio/ogg", ".ogg"],
    ["text/plain", ".txt"], ["text/vtt", ".vtt"], ["application/x-subrip", ".srt"], ["text/markdown", ".md"],
    ["application/pdf", ".pdf"], ["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/webp", ".webp"],
  ]).get(mediaType) ?? ".bin";
  const stem = label.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "interview-source";
  return stem.toLowerCase().endsWith(extension) ? stem : `${stem}${extension}`;
}

function parseRangeHeader(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return undefined;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return undefined;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return undefined;
  return { start, end: Math.min(end, size - 1) };
}

export async function serveInterviewPackageSource(ownerId: string, sourceId: string, rangeHeader: string | null, bucket: InterviewPackageBucket) {
  const rows = await getDb().select().from(interviewPackageSources).where(and(
    eq(interviewPackageSources.ownerId, ownerId), eq(interviewPackageSources.sourceId, sourceId), eq(interviewPackageSources.state, "ready"),
  )).limit(1);
  const source = rows[0];
  if (!source?.privateLocator || !source.objectEtag || !source.contentHash) {
    throw new InterviewPackageError("interview_package_source_not_found", "That ready owner-private source is unavailable.");
  }
  const expectedLocator = await interviewPackageObjectLocator(ownerId, source.packageId, source.sourceId);
  if (source.privateLocator !== expectedLocator) throw storageFailure("The private source locator failed integrity verification.");
  try {
    const head = await bucket.head(expectedLocator);
    if (!head || head.size !== source.sizeBytes || head.etag !== source.objectEtag
        || head.customMetadata?.namespace !== "interview-package" || head.customMetadata?.kind !== source.kind) {
      throw storageFailure("The private source failed R2 readback.");
    }
    const parsedRange = parseRangeHeader(rangeHeader, source.sizeBytes);
    if (parsedRange === undefined) return new Response(null, { status: 416, headers: { "content-range": `bytes */${source.sizeBytes}`, "cache-control": "private, no-store" } });
    const object = await bucket.get(expectedLocator, parsedRange ? { range: { offset: parsedRange.start, length: parsedRange.end - parsedRange.start + 1 } } : undefined);
    if (!object?.body) throw storageFailure("The private source body is unavailable.");
    const headers = new Headers({
      "content-type": source.mediaType,
      "content-disposition": `${source.kind === "audio" || source.kind === "image" || source.kind === "transcript" || source.mediaType === "application/pdf" || source.mediaType.startsWith("text/") ? "inline" : "attachment"}; filename="${safeDownloadName(source.label, source.mediaType)}"`,
      "content-length": String(parsedRange ? parsedRange.end - parsedRange.start + 1 : source.sizeBytes),
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    });
    if (parsedRange) headers.set("content-range", `bytes ${parsedRange.start}-${parsedRange.end}/${source.sizeBytes}`);
    return new Response(object.body, { status: parsedRange ? 206 : 200, headers });
  } catch (error) {
    if (error instanceof InterviewPackageError) throw error;
    throw storageFailure("The private source is temporarily unavailable.");
  }
}

export async function deleteInterviewPackage(
  ownerId: string,
  inputValue: unknown,
  bucket: InterviewPackageBucket,
  nowMs = Date.now(),
) {
  const input = deleteInterviewPackageSchema.parse(inputValue);
  const requestFingerprint = await interviewPackageRequestFingerprint(input);
  const replay = await rawInterviewPackageOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  let current = await rawInterviewPackage(ownerId, input.packageId);
  if (current.status !== "deleting") {
    if (current.status === "deleted") {
      throw new InterviewPackageError("interview_package_delete_receipt_missing", "The deleted package receipt is unavailable.", true);
    }
    if (current.revision !== input.expectedRevision) {
      throw new InterviewPackageError("interview_package_revision_conflict", "The package changed; reread it before deletion.");
    }
    await getDb().update(interviewPackages).set({
      revision: current.revision + 1,
      status: "deleting",
      retention: "deletion_pending",
      updatedAt: nowMs,
    }).where(and(
      eq(interviewPackages.ownerId, ownerId),
      eq(interviewPackages.packageId, input.packageId),
      eq(interviewPackages.revision, input.expectedRevision),
      sql`${interviewPackages.status} NOT IN ('deleting','deleted')`,
    ));
    current = await rawInterviewPackage(ownerId, input.packageId);
    if (current.status !== "deleting") {
      throw new InterviewPackageError("interview_package_delete_conflict", "The package changed while deletion began; reread it.");
    }
  } else if (current.revision !== input.expectedRevision + 1) {
    throw new InterviewPackageError("interview_package_delete_conflict", "The deletion retry does not match the current package revision.");
  }
  const db = getDb();
  const [sources, uploads, entries, materialLinks, proposals] = await Promise.all([
    db.select().from(interviewPackageSources).where(and(
      eq(interviewPackageSources.ownerId, ownerId), eq(interviewPackageSources.packageId, input.packageId),
    )),
    db.select().from(interviewPackageUploadSessions).where(and(
      eq(interviewPackageUploadSessions.ownerId, ownerId), eq(interviewPackageUploadSessions.packageId, input.packageId),
    )),
    db.select({ entryId: interviewPackageEntries.entryId }).from(interviewPackageEntries).where(and(
      eq(interviewPackageEntries.ownerId, ownerId), eq(interviewPackageEntries.packageId, input.packageId),
    )),
    db.select().from(interviewPackageMaterialLinks).where(and(
      eq(interviewPackageMaterialLinks.ownerId, ownerId), eq(interviewPackageMaterialLinks.packageId, input.packageId), eq(interviewPackageMaterialLinks.state, "linked"),
    )).limit(1),
    db.select({ count: sql<number>`count(*)` }).from(interviewPackageMaterialProposals).where(and(
      eq(interviewPackageMaterialProposals.ownerId, ownerId), eq(interviewPackageMaterialProposals.packageId, input.packageId),
    )),
  ]);
  try {
    for (const upload of uploads) {
      if (upload.status === "open" || upload.status === "completing") {
        try { await bucket.resumeMultipartUpload(upload.privateLocator, upload.r2UploadId).abort(); } catch { /* A missing multipart is already absent. */ }
      }
    }
    const locators = new Set(sources.map((source) => source.privateLocator).filter((locator): locator is string => Boolean(locator)));
    for (const locator of locators) {
      await bucket.delete(locator);
      if (await bucket.head(locator)) throw storageFailure("A private source remained after deletion.");
    }
  } catch (error) {
    if (error instanceof InterviewPackageError) throw error;
    throw storageFailure("Private source deletion is incomplete; retry the exact governed deletion.");
  }
  const deletionRevision = current.revision + 1;
  const receipt = {
    status: "deleted" as const,
    packageId: input.packageId,
    packageRevision: deletionRevision,
    deletedObjectCount: new Set(sources.map((source) => source.privateLocator).filter(Boolean)).size,
    deletedEntryCount: entries.length,
    linkedMaterialRevision: materialLinks[0]?.materialRevision ?? null,
    retainedProposalCount: Number(proposals[0]?.count ?? 0),
  };
  const entryIds = entries.map((entry) => entry.entryId);
  try {
    await db.batch([
      db.delete(interviewPackageEntryRevisions).where(and(
        eq(interviewPackageEntryRevisions.ownerId, ownerId),
        entryIds.length ? inArray(interviewPackageEntryRevisions.entryId, entryIds) : sql`0`,
      )),
      db.delete(interviewPackageEntries).where(and(
        eq(interviewPackageEntries.ownerId, ownerId), eq(interviewPackageEntries.packageId, input.packageId),
      )),
      db.delete(interviewPackageUploadParts).where(and(
        eq(interviewPackageUploadParts.ownerId, ownerId),
        uploads.length ? inArray(interviewPackageUploadParts.sessionId, uploads.map((upload) => upload.sessionId)) : sql`0`,
      )),
      db.delete(interviewPackageUploadSessions).where(and(
        eq(interviewPackageUploadSessions.ownerId, ownerId), eq(interviewPackageUploadSessions.packageId, input.packageId),
      )),
      db.update(interviewPackageSources).set({
        state: "deleted", label: "Deleted source", contentHash: null, privateLocator: null, objectEtag: null,
        transcriptRepresentation: null, rejectionCode: null, updatedAt: nowMs,
      }).where(and(eq(interviewPackageSources.ownerId, ownerId), eq(interviewPackageSources.packageId, input.packageId))),
      db.update(interviewPackages).set({
        revision: deletionRevision, status: "deleted", interviewAt: null, timeZone: null, loopId: null, stageId: null,
        manifestDigest: null, consentAffirmedAt: null, retention: "deleted", updatedAt: nowMs,
      }).where(and(
        eq(interviewPackages.ownerId, ownerId), eq(interviewPackages.packageId, input.packageId), eq(interviewPackages.status, "deleting"), eq(interviewPackages.revision, current.revision),
      )),
      db.insert(interviewPackageOperations).values({ ownerId, operationId: input.operationId, packageId: input.packageId, action: "delete", requestFingerprint, receipt, createdAt: nowMs }),
    ]);
  } catch {
    const racedReplay = await rawInterviewPackageOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    throw storageFailure("Private bytes are absent, but the deletion tombstone needs the exact retry.");
  }
  return { ...receipt, duplicate: false };
}
