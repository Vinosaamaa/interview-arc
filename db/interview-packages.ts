import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { d1TransactionalInvariantGuard } from "./d1-transactional-guard.ts";
import { getDb } from "./index.ts";
import {
  addInterviewPackageEntrySchema,
  assignInterviewPackageSchema,
  confirmInterviewPackageMaterialProposalSchema,
  createInterviewPackageSchema,
  finalizeInterviewPackageSchema,
  linkInterviewPackageMaterialSchema,
  prepareInterviewPackageMaterialProposalSchema,
  reviseInterviewPackageEntrySchema,
} from "./interview-package-policy.ts";
import {
  createLoopInterviewMaterialFromWebsite,
  reviseLoopInterviewMaterialFromWebsite,
} from "./loop-materials.ts";
import {
  interviewLoopRevisions,
  interviewLoops,
  interviewPackageAssignments,
  interviewPackageEntries,
  interviewPackageEntryRevisions,
  interviewPackageMaterialLinks,
  interviewPackageMaterialProposals,
  interviewPackageOperations,
  interviewPackages,
  interviewPackageSources,
  interviewPackageUploadParts,
  interviewPackageUploadSessions,
  loopInterviewMaterialRevisions,
  loopInterviewMaterials,
  loopRoleBriefRevisions,
} from "./schema.ts";

export class InterviewPackageError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "InterviewPackageError";
    this.code = code;
    this.retryable = retryable;
  }
}

export async function interviewPackageSha256(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function deriveInterviewPackageId(prefix: string, ownerId: string, operationId: string) {
  return `${prefix}_${(await interviewPackageSha256(`${ownerId}\u0000${prefix}\u0000${operationId}`)).slice(0, 40)}`;
}

async function fingerprint(value: unknown) {
  return interviewPackageSha256(JSON.stringify(value));
}

async function replayOperation(ownerId: string, operationId: string, requestFingerprint: string) {
  const rows = await getDb().select().from(interviewPackageOperations).where(and(
    eq(interviewPackageOperations.ownerId, ownerId),
    eq(interviewPackageOperations.operationId, operationId),
  )).limit(1);
  const operation = rows[0];
  if (!operation) return null;
  if (operation.requestFingerprint !== requestFingerprint) {
    throw new InterviewPackageError(
      "interview_package_operation_conflict",
      "That operation ID already belongs to a different Interview Package request.",
    );
  }
  return { ...(operation.receipt as object), duplicate: true };
}

async function requirePackage(ownerId: string, packageId: string, includeDeleted = false) {
  const rows = await getDb().select().from(interviewPackages).where(and(
    eq(interviewPackages.ownerId, ownerId),
    eq(interviewPackages.packageId, packageId),
  )).limit(1);
  const record = rows[0];
  if (!record || (!includeDeleted && record.status === "deleted")) {
    throw new InterviewPackageError("interview_package_not_found", "That owner-private Interview Package is unavailable.");
  }
  return record;
}

async function validateAssignment(ownerId: string, assignment: {
  loopId: string;
  stageId?: string;
  expectedLoopRevision: number;
  expectedRoleBriefRevision: number;
}) {
  const db = getDb();
  const [currentRows, loopRevisionRows, roleBriefRows] = await Promise.all([
    db.select().from(interviewLoops).where(and(
      eq(interviewLoops.ownerId, ownerId),
      eq(interviewLoops.loopId, assignment.loopId),
    )).limit(1),
    db.select().from(interviewLoopRevisions).where(and(
      eq(interviewLoopRevisions.ownerId, ownerId),
      eq(interviewLoopRevisions.loopId, assignment.loopId),
      eq(interviewLoopRevisions.revision, assignment.expectedLoopRevision),
    )).limit(1),
    db.select().from(loopRoleBriefRevisions).where(and(
      eq(loopRoleBriefRevisions.ownerId, ownerId),
      eq(loopRoleBriefRevisions.loopId, assignment.loopId),
      eq(loopRoleBriefRevisions.revision, assignment.expectedRoleBriefRevision),
    )).limit(1),
  ]);
  const current = currentRows[0];
  if (!current || current.state !== "active") {
    throw new InterviewPackageError("interview_package_loop_not_found", "That active owner-private Loop is unavailable.");
  }
  if (current.currentRevision !== assignment.expectedLoopRevision
      || current.currentRoleBriefRevision !== assignment.expectedRoleBriefRevision
      || !loopRevisionRows[0]
      || !roleBriefRows[0]) {
    throw new InterviewPackageError(
      "interview_package_assignment_conflict",
      "The Loop or Role Brief changed; reread it before assigning this package.",
    );
  }
  if (assignment.stageId) {
    const snapshot = loopRevisionRows[0].snapshot as { stages?: Array<{ stageId?: string }> };
    if (!snapshot.stages?.some((stage) => stage.stageId === assignment.stageId)) {
      throw new InterviewPackageError("interview_package_round_not_found", "That Round is not present in the selected Loop revision.");
    }
  }
  return current;
}

export async function createInterviewPackage(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = createInterviewPackageSchema.parse(inputValue);
  const requestFingerprint = await fingerprint(input);
  const replay = await replayOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  if (input.assignment) await validateAssignment(ownerId, input.assignment);
  const packageId = await deriveInterviewPackageId("pkg", ownerId, input.operationId);
  const receipt = {
    status: "created" as const,
    packageId,
    packageRevision: 1,
    assigned: Boolean(input.assignment),
  };
  const db = getDb();
  try {
    await db.batch([
      db.insert(interviewPackages).values({
        ownerId,
        packageId,
        revision: 1,
        status: "draft",
        interviewAt: input.interviewAt ?? null,
        timeZone: input.timeZone ?? null,
        loopId: input.assignment?.loopId ?? null,
        stageId: input.assignment?.stageId ?? null,
        manifestDigest: null,
        consentAffirmedAt: nowMs,
        retention: "retained",
        createdAt: nowMs,
        updatedAt: nowMs,
      }),
      ...(input.assignment ? [db.insert(interviewPackageAssignments).values({
        ownerId,
        packageId,
        assignmentRevision: 1,
        operationId: input.operationId,
        loopId: input.assignment.loopId,
        stageId: input.assignment.stageId ?? null,
        loopRevision: input.assignment.expectedLoopRevision,
        roleBriefRevision: input.assignment.expectedRoleBriefRevision,
        assignedAt: nowMs,
      })] : []),
      db.insert(interviewPackageOperations).values({
        ownerId,
        operationId: input.operationId,
        packageId,
        action: "create",
        requestFingerprint,
        receipt,
        createdAt: nowMs,
      }),
    ]);
  } catch {
    const racedReplay = await replayOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    throw new InterviewPackageError(
      "interview_package_create_conflict",
      "The Interview Package could not be created atomically; retry with the same operation.",
      true,
    );
  }
  return { ...receipt, duplicate: false };
}

export async function assignInterviewPackage(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = assignInterviewPackageSchema.parse(inputValue);
  const requestFingerprint = await fingerprint(input);
  const replay = await replayOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const current = await requirePackage(ownerId, input.packageId);
  if (current.revision !== input.expectedRevision || current.status === "deleting") {
    throw new InterviewPackageError("interview_package_revision_conflict", "The package changed; reread it before assigning.");
  }
  if (input.assignment) await validateAssignment(ownerId, input.assignment);
  const revision = current.revision + 1;
  const assignmentRevisionRows = await getDb().select({ count: sql<number>`count(*)` })
    .from(interviewPackageAssignments).where(and(
      eq(interviewPackageAssignments.ownerId, ownerId),
      eq(interviewPackageAssignments.packageId, input.packageId),
    ));
  const assignmentRevision = Number(assignmentRevisionRows[0]?.count ?? 0) + 1;
  const receipt = {
    status: input.assignment ? "assigned" as const : "unassigned" as const,
    packageId: input.packageId,
    packageRevision: revision,
    assignmentRevision,
  };
  const db = getDb();
  const unchanged = sql`EXISTS (SELECT 1 FROM ${interviewPackages}
    WHERE ${interviewPackages.ownerId}=${ownerId} AND ${interviewPackages.packageId}=${input.packageId}
      AND ${interviewPackages.revision}=${input.expectedRevision} AND ${interviewPackages.status} NOT IN ('deleting','deleted'))`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, unchanged),
      db.insert(interviewPackageAssignments).values({
        ownerId,
        packageId: input.packageId,
        assignmentRevision,
        operationId: input.operationId,
        loopId: input.assignment?.loopId ?? null,
        stageId: input.assignment?.stageId ?? null,
        loopRevision: input.assignment?.expectedLoopRevision ?? null,
        roleBriefRevision: input.assignment?.expectedRoleBriefRevision ?? null,
        assignedAt: nowMs,
      }),
      db.update(interviewPackages).set({
        revision,
        loopId: input.assignment?.loopId ?? null,
        stageId: input.assignment?.stageId ?? null,
        updatedAt: nowMs,
      }).where(and(
        eq(interviewPackages.ownerId, ownerId),
        eq(interviewPackages.packageId, input.packageId),
        eq(interviewPackages.revision, input.expectedRevision),
      )),
      db.insert(interviewPackageOperations).values({
        ownerId,
        operationId: input.operationId,
        packageId: input.packageId,
        action: "assign",
        requestFingerprint,
        receipt,
        createdAt: nowMs,
      }),
    ]);
  } catch {
    const racedReplay = await replayOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    throw new InterviewPackageError("interview_package_assignment_conflict", "The package or Loop changed while assigning; reread both.");
  }
  return { ...receipt, duplicate: false };
}

export async function addInterviewPackageEntry(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = addInterviewPackageEntrySchema.parse(inputValue);
  const requestFingerprint = await fingerprint(input);
  const replay = await replayOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const current = await requirePackage(ownerId, input.packageId);
  if (current.revision !== input.expectedRevision || current.status === "deleting") {
    throw new InterviewPackageError("interview_package_revision_conflict", "The package changed; reread it before adding this entry.");
  }
  const countRows = await getDb().select({ count: sql<number>`count(*)` }).from(interviewPackageEntries).where(and(
    eq(interviewPackageEntries.ownerId, ownerId),
    eq(interviewPackageEntries.packageId, input.packageId),
    eq(interviewPackageEntries.state, "active"),
  ));
  if (Number(countRows[0]?.count ?? 0) >= 50) {
    throw new InterviewPackageError("interview_package_entry_limit", "One package can contain at most 50 active links and notes.");
  }
  const entryId = await deriveInterviewPackageId("entry", ownerId, input.operationId);
  const contentHash = await fingerprint(input.entry);
  const revision = current.revision + 1;
  const receipt = { status: "entry_created" as const, packageId: input.packageId, packageRevision: revision, entryId, entryRevision: 1 };
  const db = getDb();
  const unchanged = sql`EXISTS (SELECT 1 FROM ${interviewPackages}
    WHERE ${interviewPackages.ownerId}=${ownerId} AND ${interviewPackages.packageId}=${input.packageId}
      AND ${interviewPackages.revision}=${input.expectedRevision} AND ${interviewPackages.status} NOT IN ('deleting','deleted'))`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, unchanged),
      db.insert(interviewPackageEntryRevisions).values({
        ownerId,
        entryId,
        revision: 1,
        operationId: input.operationId,
        requestFingerprint,
        snapshot: input.entry,
        contentHash,
        createdAt: nowMs,
      }),
      db.insert(interviewPackageEntries).values({
        ownerId,
        packageId: input.packageId,
        entryId,
        kind: input.entry.kind,
        currentRevision: 1,
        state: "active",
        createdAt: nowMs,
        updatedAt: nowMs,
      }),
      db.update(interviewPackages).set({ revision, status: "draft", manifestDigest: null, updatedAt: nowMs }).where(and(
        eq(interviewPackages.ownerId, ownerId), eq(interviewPackages.packageId, input.packageId), eq(interviewPackages.revision, input.expectedRevision),
      )),
      db.insert(interviewPackageOperations).values({ ownerId, operationId: input.operationId, packageId: input.packageId, action: "add_entry", requestFingerprint, receipt, createdAt: nowMs }),
    ]);
  } catch {
    const racedReplay = await replayOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    throw new InterviewPackageError("interview_package_entry_conflict", "The package changed while adding this entry; reread it.");
  }
  return { ...receipt, duplicate: false };
}

export async function reviseInterviewPackageEntry(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = reviseInterviewPackageEntrySchema.parse(inputValue);
  const requestFingerprint = await fingerprint(input);
  const replay = await replayOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const [current, entryRows] = await Promise.all([
    requirePackage(ownerId, input.packageId),
    getDb().select().from(interviewPackageEntries).where(and(
      eq(interviewPackageEntries.ownerId, ownerId),
      eq(interviewPackageEntries.packageId, input.packageId),
      eq(interviewPackageEntries.entryId, input.entryId),
    )).limit(1),
  ]);
  const entry = entryRows[0];
  if (current.revision !== input.expectedRevision || !entry || entry.state !== "active"
      || entry.currentRevision !== input.expectedEntryRevision || entry.kind !== input.entry.kind) {
    throw new InterviewPackageError("interview_package_entry_conflict", "The package or entry changed; reread it before revising.");
  }
  const packageRevision = current.revision + 1;
  const entryRevision = entry.currentRevision + 1;
  const contentHash = await fingerprint(input.entry);
  const receipt = { status: "entry_revised" as const, packageId: input.packageId, packageRevision, entryId: input.entryId, entryRevision };
  const db = getDb();
  const unchanged = sql`EXISTS (SELECT 1 FROM ${interviewPackages}
    WHERE ${interviewPackages.ownerId}=${ownerId} AND ${interviewPackages.packageId}=${input.packageId}
      AND ${interviewPackages.revision}=${input.expectedRevision} AND ${interviewPackages.status} NOT IN ('deleting','deleted'))
    AND EXISTS (SELECT 1 FROM ${interviewPackageEntries}
    WHERE ${interviewPackageEntries.ownerId}=${ownerId} AND ${interviewPackageEntries.entryId}=${input.entryId}
      AND ${interviewPackageEntries.currentRevision}=${input.expectedEntryRevision} AND ${interviewPackageEntries.state}='active')`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, unchanged),
      db.insert(interviewPackageEntryRevisions).values({ ownerId, entryId: input.entryId, revision: entryRevision, operationId: input.operationId, requestFingerprint, snapshot: input.entry, contentHash, createdAt: nowMs }),
      db.update(interviewPackageEntries).set({ currentRevision: entryRevision, updatedAt: nowMs }).where(and(
        eq(interviewPackageEntries.ownerId, ownerId), eq(interviewPackageEntries.entryId, input.entryId), eq(interviewPackageEntries.currentRevision, input.expectedEntryRevision),
      )),
      db.update(interviewPackages).set({ revision: packageRevision, status: "draft", manifestDigest: null, updatedAt: nowMs }).where(and(
        eq(interviewPackages.ownerId, ownerId), eq(interviewPackages.packageId, input.packageId), eq(interviewPackages.revision, input.expectedRevision),
      )),
      db.insert(interviewPackageOperations).values({ ownerId, operationId: input.operationId, packageId: input.packageId, action: "revise_entry", requestFingerprint, receipt, createdAt: nowMs }),
    ]);
  } catch {
    const racedReplay = await replayOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    throw new InterviewPackageError("interview_package_entry_conflict", "The package or entry changed while revising; reread it.");
  }
  return { ...receipt, duplicate: false };
}

function sourceDisplay(row: typeof interviewPackageSources.$inferSelect) {
  return {
    packageId: row.packageId,
    sourceId: row.sourceId,
    kind: row.kind,
    state: row.state,
    revision: row.revision,
    label: row.label,
    mediaType: row.mediaType,
    sizeBytes: row.sizeBytes,
    contentHash: row.contentHash ?? undefined,
    transcriptRepresentation: row.transcriptRepresentation ?? undefined,
    rejectionCode: row.rejectionCode ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function queryInterviewPackages(ownerId: string, input: { packageId?: string; loopId?: string; includeDeleted?: boolean } = {}) {
  const db = getDb();
  const packages = await db.select().from(interviewPackages).where(and(
    eq(interviewPackages.ownerId, ownerId),
    input.packageId ? eq(interviewPackages.packageId, input.packageId) : undefined,
    input.loopId ? eq(interviewPackages.loopId, input.loopId) : undefined,
    input.includeDeleted ? undefined : sql`${interviewPackages.status} <> 'deleted'`,
  )).orderBy(desc(interviewPackages.updatedAt)).limit(101);
  const items = await Promise.all(packages.slice(0, 100).map(async (record) => {
    const [sources, entries, uploads, materialLinks, proposals] = await Promise.all([
      db.select().from(interviewPackageSources).where(and(
        eq(interviewPackageSources.ownerId, ownerId), eq(interviewPackageSources.packageId, record.packageId), sql`${interviewPackageSources.state} <> 'deleted'`,
      )).orderBy(asc(interviewPackageSources.createdAt)),
      db.select({
        entryId: interviewPackageEntries.entryId,
        kind: interviewPackageEntries.kind,
        state: interviewPackageEntries.state,
        revision: interviewPackageEntryRevisions.revision,
        snapshot: interviewPackageEntryRevisions.snapshot,
        contentHash: interviewPackageEntryRevisions.contentHash,
        createdAt: interviewPackageEntries.createdAt,
        updatedAt: interviewPackageEntries.updatedAt,
      }).from(interviewPackageEntries).innerJoin(interviewPackageEntryRevisions, and(
        eq(interviewPackageEntryRevisions.ownerId, interviewPackageEntries.ownerId),
        eq(interviewPackageEntryRevisions.entryId, interviewPackageEntries.entryId),
        eq(interviewPackageEntryRevisions.revision, interviewPackageEntries.currentRevision),
      )).where(and(
        eq(interviewPackageEntries.ownerId, ownerId), eq(interviewPackageEntries.packageId, record.packageId), eq(interviewPackageEntries.state, "active"),
      )).orderBy(asc(interviewPackageEntries.createdAt)),
      db.select({ sourceId: interviewPackageUploadSessions.sourceId, status: interviewPackageUploadSessions.status, expectedBytes: interviewPackageUploadSessions.expectedBytes, expiresAt: interviewPackageUploadSessions.expiresAt })
        .from(interviewPackageUploadSessions).where(and(
          eq(interviewPackageUploadSessions.ownerId, ownerId), eq(interviewPackageUploadSessions.packageId, record.packageId),
        )),
      db.select().from(interviewPackageMaterialLinks).where(and(
        eq(interviewPackageMaterialLinks.ownerId, ownerId), eq(interviewPackageMaterialLinks.packageId, record.packageId),
      )).limit(1),
      db.select({ proposalId: interviewPackageMaterialProposals.proposalId, status: interviewPackageMaterialProposals.status, materialId: interviewPackageMaterialProposals.materialId, baseMaterialRevision: interviewPackageMaterialProposals.baseMaterialRevision, baseLoopRevision: interviewPackageMaterialProposals.baseLoopRevision, baseRoleBriefRevision: interviewPackageMaterialProposals.baseRoleBriefRevision, sourceDigests: interviewPackageMaterialProposals.sourceDigests, proposedSnapshot: interviewPackageMaterialProposals.proposedSnapshot, confirmedMaterialRevision: interviewPackageMaterialProposals.confirmedMaterialRevision, createdAt: interviewPackageMaterialProposals.createdAt, updatedAt: interviewPackageMaterialProposals.updatedAt })
        .from(interviewPackageMaterialProposals).where(and(
          eq(interviewPackageMaterialProposals.ownerId, ownerId), eq(interviewPackageMaterialProposals.packageId, record.packageId),
        )).orderBy(desc(interviewPackageMaterialProposals.createdAt)).limit(20),
    ]);
    const progressRows = await Promise.all(uploads.map(async (upload) => {
      const parts = await db.select({ bytes: sql<number>`coalesce(sum(${interviewPackageUploadParts.byteCount}),0)` }).from(interviewPackageUploadParts).where(and(
        eq(interviewPackageUploadParts.ownerId, ownerId),
        eq(interviewPackageUploadParts.sessionId, (await db.select({ sessionId: interviewPackageUploadSessions.sessionId }).from(interviewPackageUploadSessions).where(and(
          eq(interviewPackageUploadSessions.ownerId, ownerId), eq(interviewPackageUploadSessions.sourceId, upload.sourceId),
        )).limit(1))[0]?.sessionId ?? ""),
      ));
      return { ...upload, uploadedBytes: Number(parts[0]?.bytes ?? 0) };
    }));
    const link = materialLinks[0];
    return {
      packageId: record.packageId,
      revision: record.revision,
      status: record.status,
      interviewAt: record.interviewAt ?? undefined,
      timeZone: record.timeZone ?? undefined,
      assignment: record.loopId ? { loopId: record.loopId, stageId: record.stageId ?? undefined } : null,
      manifestDigest: record.manifestDigest ?? undefined,
      retention: record.retention,
      consentAffirmedAt: record.consentAffirmedAt ?? undefined,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      sources: sources.map(sourceDisplay),
      entries,
      uploads: progressRows,
      materialLink: link ? {
        state: link.state,
        linkRevision: link.linkRevision,
        materialId: link.materialId ?? undefined,
        materialRevision: link.materialRevision ?? undefined,
        proposalId: link.proposalId ?? undefined,
        sourceDigests: link.sourceDigests,
        updatedAt: link.updatedAt,
      } : null,
      proposals,
    };
  }));
  return { packages: items, truncated: packages.length > 100 };
}

export async function finalizeInterviewPackage(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = finalizeInterviewPackageSchema.parse(inputValue);
  const requestFingerprint = await fingerprint(input);
  const replay = await replayOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const current = await requirePackage(ownerId, input.packageId);
  if (current.revision !== input.expectedRevision || current.status === "deleting") {
    throw new InterviewPackageError("interview_package_revision_conflict", "The package changed; reread it before finalizing.");
  }
  const db = getDb();
  const [sources, entries] = await Promise.all([
    db.select().from(interviewPackageSources).where(and(
      eq(interviewPackageSources.ownerId, ownerId), eq(interviewPackageSources.packageId, input.packageId), sql`${interviewPackageSources.state} <> 'deleted'`,
    )),
    db.select({ entryId: interviewPackageEntries.entryId, state: interviewPackageEntries.state, contentHash: interviewPackageEntryRevisions.contentHash, revision: interviewPackageEntryRevisions.revision })
      .from(interviewPackageEntries).innerJoin(interviewPackageEntryRevisions, and(
        eq(interviewPackageEntryRevisions.ownerId, interviewPackageEntries.ownerId),
        eq(interviewPackageEntryRevisions.entryId, interviewPackageEntries.entryId),
        eq(interviewPackageEntryRevisions.revision, interviewPackageEntries.currentRevision),
      )).where(and(eq(interviewPackageEntries.ownerId, ownerId), eq(interviewPackageEntries.packageId, input.packageId), eq(interviewPackageEntries.state, "active"))),
  ]);
  const selectedSourceSet = new Set(input.includedSourceIds);
  const selectedEntrySet = new Set(input.includedEntryIds);
  const selectedSources = sources.filter((source) => selectedSourceSet.has(source.sourceId));
  const selectedEntries = entries.filter((entry) => selectedEntrySet.has(entry.entryId));
  if (selectedSources.length !== selectedSourceSet.size || selectedEntries.length !== selectedEntrySet.size
      || selectedSources.some((source) => source.state !== "ready" || !source.contentHash)) {
    throw new InterviewPackageError("interview_package_manifest_invalid", "Finalize only exact ready sources and active entries from this package.");
  }
  const omitted = sources.some((source) => !selectedSourceSet.has(source.sourceId))
    || entries.some((entry) => !selectedEntrySet.has(entry.entryId));
  if (omitted && !input.finalizeSubset) {
    throw new InterviewPackageError("interview_package_subset_confirmation_required", "Confirm subset finalization before omitting a package source or entry.");
  }
  const manifest = [
    ...selectedSources.map((source) => ({ type: "file", id: source.sourceId, revision: source.revision, digest: source.contentHash })),
    ...selectedEntries.map((entry) => ({ type: "entry", id: entry.entryId, revision: entry.revision, digest: entry.contentHash })),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const manifestDigest = await fingerprint(manifest);
  const revision = current.revision + 1;
  const status = omitted ? "partial" as const : "ready" as const;
  const receipt = { status: "finalized" as const, packageId: input.packageId, packageRevision: revision, packageStatus: status, manifestDigest, readySourceCount: selectedSources.length, activeEntryCount: selectedEntries.length };
  const unchanged = sql`EXISTS (SELECT 1 FROM ${interviewPackages}
    WHERE ${interviewPackages.ownerId}=${ownerId} AND ${interviewPackages.packageId}=${input.packageId}
      AND ${interviewPackages.revision}=${input.expectedRevision} AND ${interviewPackages.status} NOT IN ('deleting','deleted'))`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, unchanged),
      db.update(interviewPackages).set({ revision, status, manifestDigest, updatedAt: nowMs }).where(and(
        eq(interviewPackages.ownerId, ownerId), eq(interviewPackages.packageId, input.packageId), eq(interviewPackages.revision, input.expectedRevision),
      )),
      db.insert(interviewPackageOperations).values({ ownerId, operationId: input.operationId, packageId: input.packageId, action: "finalize", requestFingerprint, receipt, createdAt: nowMs }),
    ]);
  } catch {
    const racedReplay = await replayOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    throw new InterviewPackageError("interview_package_finalize_conflict", "The package changed while finalizing; reread it.");
  }
  return { ...receipt, duplicate: false };
}

export async function linkInterviewPackageMaterial(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = linkInterviewPackageMaterialSchema.parse(inputValue);
  const requestFingerprint = await fingerprint(input);
  const replay = await replayOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const current = await requirePackage(ownerId, input.packageId);
  if (current.revision !== input.expectedRevision || !current.loopId || current.status === "deleting") {
    throw new InterviewPackageError("interview_package_material_context_conflict", "Assign the current package to a Loop and reread it before changing material.");
  }
  if (input.materialId && input.materialRevision) {
    const rows = await getDb().select({ loopId: loopInterviewMaterials.loopId, stageId: loopInterviewMaterials.stageId })
      .from(loopInterviewMaterials).innerJoin(loopInterviewMaterialRevisions, and(
        eq(loopInterviewMaterialRevisions.ownerId, loopInterviewMaterials.ownerId),
        eq(loopInterviewMaterialRevisions.materialId, loopInterviewMaterials.materialId),
        eq(loopInterviewMaterialRevisions.revision, input.materialRevision),
      )).where(and(
        eq(loopInterviewMaterials.ownerId, ownerId), eq(loopInterviewMaterials.materialId, input.materialId),
      )).limit(1);
    const material = rows[0];
    if (!material || material.loopId !== current.loopId || (material.stageId && material.stageId !== current.stageId)) {
      throw new InterviewPackageError("interview_package_material_not_found", "That exact Interview Material revision does not belong to this package assignment.");
    }
  }
  const db = getDb();
  const existing = await db.select().from(interviewPackageMaterialLinks).where(and(
    eq(interviewPackageMaterialLinks.ownerId, ownerId), eq(interviewPackageMaterialLinks.packageId, input.packageId),
  )).limit(1);
  const linkRevision = (existing[0]?.linkRevision ?? 0) + 1;
  const packageRevision = current.revision + 1;
  const receipt = { status: input.materialId ? "material_linked" as const : "material_unlinked" as const, packageId: input.packageId, packageRevision, linkRevision, materialRevision: input.materialRevision };
  const unchanged = sql`EXISTS (SELECT 1 FROM ${interviewPackages}
    WHERE ${interviewPackages.ownerId}=${ownerId} AND ${interviewPackages.packageId}=${input.packageId}
      AND ${interviewPackages.revision}=${input.expectedRevision} AND ${interviewPackages.status} NOT IN ('deleting','deleted'))`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, unchanged),
      db.insert(interviewPackageMaterialLinks).values({
        ownerId, packageId: input.packageId, linkRevision, state: input.materialId ? "linked" : "unlinked",
        materialId: input.materialId, materialRevision: input.materialRevision, proposalId: null,
        sourceDigests: [], operationId: input.operationId, createdAt: existing[0]?.createdAt ?? nowMs, updatedAt: nowMs,
      }).onConflictDoUpdate({
        target: [interviewPackageMaterialLinks.ownerId, interviewPackageMaterialLinks.packageId],
        set: { linkRevision, state: input.materialId ? "linked" : "unlinked", materialId: input.materialId, materialRevision: input.materialRevision, proposalId: null, sourceDigests: [], operationId: input.operationId, updatedAt: nowMs },
      }),
      db.update(interviewPackages).set({ revision: packageRevision, updatedAt: nowMs }).where(and(
        eq(interviewPackages.ownerId, ownerId), eq(interviewPackages.packageId, input.packageId), eq(interviewPackages.revision, input.expectedRevision),
      )),
      db.insert(interviewPackageOperations).values({ ownerId, operationId: input.operationId, packageId: input.packageId, action: "link_material", requestFingerprint, receipt, createdAt: nowMs }),
    ]);
  } catch {
    const racedReplay = await replayOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    throw new InterviewPackageError("interview_package_material_link_conflict", "The package or material link changed; reread it.");
  }
  return { ...receipt, duplicate: false };
}

async function selectedSourceDigests(ownerId: string, packageId: string, selectedIds: string[]) {
  const db = getDb();
  const [sources, entries] = await Promise.all([
    db.select({ id: interviewPackageSources.sourceId, digest: interviewPackageSources.contentHash, state: interviewPackageSources.state, revision: interviewPackageSources.revision })
      .from(interviewPackageSources).where(and(
        eq(interviewPackageSources.ownerId, ownerId), eq(interviewPackageSources.packageId, packageId), inArray(interviewPackageSources.sourceId, selectedIds),
      )),
    db.select({ id: interviewPackageEntries.entryId, digest: interviewPackageEntryRevisions.contentHash, state: interviewPackageEntries.state, revision: interviewPackageEntryRevisions.revision })
      .from(interviewPackageEntries).innerJoin(interviewPackageEntryRevisions, and(
        eq(interviewPackageEntryRevisions.ownerId, interviewPackageEntries.ownerId),
        eq(interviewPackageEntryRevisions.entryId, interviewPackageEntries.entryId),
        eq(interviewPackageEntryRevisions.revision, interviewPackageEntries.currentRevision),
      )).where(and(
        eq(interviewPackageEntries.ownerId, ownerId), eq(interviewPackageEntries.packageId, packageId), inArray(interviewPackageEntries.entryId, selectedIds),
      )),
  ]);
  const combined = [
    ...sources.filter((row) => row.state === "ready" && row.digest).map((row) => ({ sourceId: row.id, revision: row.revision, digest: row.digest! })),
    ...entries.filter((row) => row.state === "active").map((row) => ({ sourceId: row.id, revision: row.revision, digest: row.digest })),
  ].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  if (combined.length !== selectedIds.length || new Set(combined.map((row) => row.sourceId)).size !== selectedIds.length) {
    throw new InterviewPackageError("interview_package_proposal_source_conflict", "Every selected proposal source must be current, ready, and belong to this package.");
  }
  return combined;
}

export async function prepareInterviewPackageMaterialProposal(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = prepareInterviewPackageMaterialProposalSchema.parse(inputValue);
  const requestFingerprint = await fingerprint(input);
  const replay = await replayOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const current = await requirePackage(ownerId, input.packageId);
  if (current.revision !== input.expectedRevision || !current.loopId || current.status === "deleting"
      || input.proposedMaterial.loopId !== current.loopId
      || (input.proposedMaterial.stageId ?? null) !== current.stageId) {
    throw new InterviewPackageError("interview_package_proposal_context_conflict", "The proposal must target the package's exact current Loop and Round assignment.");
  }
  await validateAssignment(ownerId, {
    loopId: current.loopId,
    stageId: current.stageId ?? undefined,
    expectedLoopRevision: input.baseLoopRevision,
    expectedRoleBriefRevision: input.baseRoleBriefRevision,
  });
  const materialRows = await getDb().select().from(loopInterviewMaterials).where(and(
    eq(loopInterviewMaterials.ownerId, ownerId), eq(loopInterviewMaterials.materialId, input.proposedMaterial.materialId),
  )).limit(1);
  if (input.baseMaterialRevision === null ? Boolean(materialRows[0]) : materialRows[0]?.currentRevision !== input.baseMaterialRevision) {
    throw new InterviewPackageError("interview_package_proposal_base_conflict", "The current Interview Material revision does not match the reviewed proposal base.");
  }
  const sourceDigests = await selectedSourceDigests(ownerId, input.packageId, input.selectedSourceIds);
  const proposalId = await deriveInterviewPackageId("proposal", ownerId, input.operationId);
  const packageRevision = current.revision + 1;
  const receipt = { status: "material_proposal_prepared" as const, packageId: input.packageId, packageRevision, proposalId, selectedSourceCount: sourceDigests.length };
  const db = getDb();
  const unchanged = sql`EXISTS (SELECT 1 FROM ${interviewPackages}
    WHERE ${interviewPackages.ownerId}=${ownerId} AND ${interviewPackages.packageId}=${input.packageId}
      AND ${interviewPackages.revision}=${input.expectedRevision} AND ${interviewPackages.status} NOT IN ('deleting','deleted'))`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, unchanged),
      db.insert(interviewPackageMaterialProposals).values({
        ownerId, proposalId, packageId: input.packageId, operationId: input.operationId, requestFingerprint,
        status: "proposed", materialId: input.proposedMaterial.materialId, baseMaterialRevision: input.baseMaterialRevision,
        baseLoopRevision: input.baseLoopRevision, baseRoleBriefRevision: input.baseRoleBriefRevision,
        sourceDigests, proposedSnapshot: input.proposedMaterial, confirmedMaterialRevision: null, createdAt: nowMs, updatedAt: nowMs,
      }),
      db.update(interviewPackages).set({ revision: packageRevision, updatedAt: nowMs }).where(and(
        eq(interviewPackages.ownerId, ownerId), eq(interviewPackages.packageId, input.packageId), eq(interviewPackages.revision, input.expectedRevision),
      )),
      db.insert(interviewPackageOperations).values({ ownerId, operationId: input.operationId, packageId: input.packageId, action: "prepare_material_proposal", requestFingerprint, receipt, createdAt: nowMs }),
    ]);
  } catch {
    const racedReplay = await replayOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    throw new InterviewPackageError("interview_package_proposal_conflict", "The package or proposal base changed; reread it.");
  }
  return { ...receipt, duplicate: false };
}

export async function confirmInterviewPackageMaterialProposal(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = confirmInterviewPackageMaterialProposalSchema.parse(inputValue);
  const requestFingerprint = await fingerprint(input);
  const replay = await replayOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const [current, proposalRows] = await Promise.all([
    requirePackage(ownerId, input.packageId),
    getDb().select().from(interviewPackageMaterialProposals).where(and(
      eq(interviewPackageMaterialProposals.ownerId, ownerId),
      eq(interviewPackageMaterialProposals.packageId, input.packageId),
      eq(interviewPackageMaterialProposals.proposalId, input.proposalId),
    )).limit(1),
  ]);
  const proposal = proposalRows[0];
  if (current.revision !== input.expectedRevision || current.status === "deleting"
      || !current.loopId || !proposal || proposal.status !== "proposed") {
    throw new InterviewPackageError("interview_package_proposal_conflict", "The package or material proposal changed; reread it before confirmation.");
  }
  const proposedMaterial = proposal.proposedSnapshot as {
    materialId: string;
    loopId: string;
    stageId?: string;
    kind: "interview_prep";
    state: "active" | "archived";
    label: string;
    summary?: string;
    sections: Array<{ sectionId: string; title: string; body?: string; bullets: string[] }>;
    provenance: { kind: "owner_authorized_synthesis"; roleBriefRevision: number; activityIds: string[]; sourceLabel: string; preparedAt: number };
  };
  const markStale = async (message: string) => {
    await getDb().update(interviewPackageMaterialProposals).set({ status: "stale", updatedAt: nowMs }).where(and(
      eq(interviewPackageMaterialProposals.ownerId, ownerId), eq(interviewPackageMaterialProposals.proposalId, input.proposalId), eq(interviewPackageMaterialProposals.status, "proposed"),
    ));
    throw new InterviewPackageError("interview_package_proposal_stale", message);
  };
  if (proposedMaterial.loopId !== current.loopId || (proposedMaterial.stageId ?? null) !== current.stageId) {
    return markStale("The package assignment changed after this proposal was prepared.");
  }
  try {
    await validateAssignment(ownerId, {
      loopId: current.loopId,
      stageId: current.stageId ?? undefined,
      expectedLoopRevision: proposal.baseLoopRevision,
      expectedRoleBriefRevision: proposal.baseRoleBriefRevision,
    });
  } catch {
    return markStale("The Loop, Round, or Role Brief changed after review; prepare a new proposal.");
  }
  const materialRows = await getDb().select({ currentRevision: loopInterviewMaterials.currentRevision }).from(loopInterviewMaterials).where(and(
    eq(loopInterviewMaterials.ownerId, ownerId), eq(loopInterviewMaterials.materialId, proposal.materialId),
  )).limit(1);
  if (proposal.baseMaterialRevision === null ? Boolean(materialRows[0]) : materialRows[0]?.currentRevision !== proposal.baseMaterialRevision) {
    return markStale("The Interview Material base changed after review; prepare a new proposal.");
  }
  const selected = proposal.sourceDigests as Array<{ sourceId: string; revision: number; digest: string }>;
  const currentDigests = await selectedSourceDigests(ownerId, input.packageId, selected.map((item) => item.sourceId));
  if (JSON.stringify(currentDigests) !== JSON.stringify(selected)) {
    return markStale("A selected source changed after review; prepare a new proposal.");
  }
  const materialOperationId = await deriveInterviewPackageId("material", ownerId, input.proposalId);
  const materialReceipt = proposal.baseMaterialRevision === null
    ? await createLoopInterviewMaterialFromWebsite(ownerId, {
      operationId: materialOperationId,
      authorization: "website_owner",
      expectedLoopRevision: proposal.baseLoopRevision,
      expectedRoleBriefRevision: proposal.baseRoleBriefRevision,
      material: proposedMaterial,
    }, nowMs)
    : await reviseLoopInterviewMaterialFromWebsite(ownerId, {
      operationId: materialOperationId,
      authorization: "website_owner",
      expectedLoopRevision: proposal.baseLoopRevision,
      expectedRoleBriefRevision: proposal.baseRoleBriefRevision,
      materialId: proposal.materialId,
      expectedRevision: proposal.baseMaterialRevision,
      material: proposedMaterial,
    }, nowMs);
  const confirmedMaterialRevision = Number((materialReceipt as unknown as { materialRevision: number }).materialRevision);
  const existingLink = await getDb().select().from(interviewPackageMaterialLinks).where(and(
    eq(interviewPackageMaterialLinks.ownerId, ownerId), eq(interviewPackageMaterialLinks.packageId, input.packageId),
  )).limit(1);
  const linkRevision = (existingLink[0]?.linkRevision ?? 0) + 1;
  const packageRevision = current.revision + 1;
  const receipt = {
    status: "material_proposal_confirmed" as const,
    packageId: input.packageId,
    packageRevision,
    proposalId: input.proposalId,
    materialId: proposal.materialId,
    materialRevision: confirmedMaterialRevision,
    selectedSourceCount: selected.length,
  };
  const db = getDb();
  const unchanged = sql`EXISTS (SELECT 1 FROM ${interviewPackages}
    WHERE ${interviewPackages.ownerId}=${ownerId} AND ${interviewPackages.packageId}=${input.packageId}
      AND ${interviewPackages.revision}=${input.expectedRevision} AND ${interviewPackages.status} NOT IN ('deleting','deleted'))
    AND EXISTS (SELECT 1 FROM ${interviewPackageMaterialProposals}
    WHERE ${interviewPackageMaterialProposals.ownerId}=${ownerId} AND ${interviewPackageMaterialProposals.proposalId}=${input.proposalId}
      AND ${interviewPackageMaterialProposals.status}='proposed')`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, unchanged),
      db.update(interviewPackageMaterialProposals).set({ status: "confirmed", confirmedMaterialRevision, updatedAt: nowMs }).where(and(
        eq(interviewPackageMaterialProposals.ownerId, ownerId), eq(interviewPackageMaterialProposals.proposalId, input.proposalId), eq(interviewPackageMaterialProposals.status, "proposed"),
      )),
      db.insert(interviewPackageMaterialLinks).values({
        ownerId, packageId: input.packageId, linkRevision, state: "linked", materialId: proposal.materialId,
        materialRevision: confirmedMaterialRevision, proposalId: input.proposalId, sourceDigests: selected,
        operationId: input.operationId, createdAt: existingLink[0]?.createdAt ?? nowMs, updatedAt: nowMs,
      }).onConflictDoUpdate({
        target: [interviewPackageMaterialLinks.ownerId, interviewPackageMaterialLinks.packageId],
        set: { linkRevision, state: "linked", materialId: proposal.materialId, materialRevision: confirmedMaterialRevision, proposalId: input.proposalId, sourceDigests: selected, operationId: input.operationId, updatedAt: nowMs },
      }),
      db.update(interviewPackages).set({ revision: packageRevision, updatedAt: nowMs }).where(and(
        eq(interviewPackages.ownerId, ownerId), eq(interviewPackages.packageId, input.packageId), eq(interviewPackages.revision, input.expectedRevision),
      )),
      db.insert(interviewPackageOperations).values({ ownerId, operationId: input.operationId, packageId: input.packageId, action: "confirm_material_proposal", requestFingerprint, receipt, createdAt: nowMs }),
    ]);
  } catch {
    const racedReplay = await replayOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    throw new InterviewPackageError("interview_package_proposal_commit_conflict", "The material revision was saved, but the package link needs the exact confirmation retry.", true);
  }
  return { ...receipt, duplicate: false };
}

export async function rawInterviewPackage(ownerId: string, packageId: string) {
  return requirePackage(ownerId, packageId, true);
}

export async function rawInterviewPackageOperation(ownerId: string, operationId: string, requestFingerprint: string) {
  return replayOperation(ownerId, operationId, requestFingerprint);
}

export async function interviewPackageRequestFingerprint(value: unknown) {
  return fingerprint(value);
}
