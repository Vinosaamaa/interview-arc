import { and, desc, eq, sql } from "drizzle-orm";

import { d1TransactionalInvariantGuard } from "./d1-transactional-guard";
import { getDb } from "./index";
import { behavioralTargetProfileInputSchema } from "./behavioral-target-profile-policy";
import { readBehavioralTargetRevision } from "./behavioral-target-profile";
import {
  behavioralTargetProfileRevisions,
  behavioralTargetProfiles,
  extraActivities,
  interviewLoopOperations,
  interviewLoopRevisions,
  interviewLoops,
  loopActivityBindingOperations,
  loopActivityBindings,
  loopActivityHistory,
  loopCapturePacketOperations,
  loopCapturePackets,
  loopRoleBriefRevisions,
  loopTargetProfileMigrations,
  outcomes,
  timers,
} from "./schema";
import {
  bindPlannedActivitySchema,
  captureLoopPacketSchema,
  createLoopSchema,
  displaySafeLoopRoleBriefRevisionSchema,
  importLoopCapturePacketSchema,
  linkCompletedActivitySchema,
  loopActivityContextRequestSchema,
  loopCapturePacketSnapshotSchema,
  loopRoleBriefDisplaySnapshotSchema,
  loopRoleBriefInputSchema,
  loopSnapshotSchema,
  loopSpecialtySchema,
  queryLoopCapturePacketsSchema,
  queryLoopRoleBriefSourceSchema,
  queryLoopsSchema,
  queryRoleBriefMigrationInboxSchema,
  reviseLoopRoleBriefSchema,
  reviseLoopSchema,
  targetProfileMigrationSchema,
  type CaptureLoopPacketInput,
  type BindPlannedActivityInput,
  type CreateLoopInput,
  type DisplaySafeLoopRoleBriefRevision,
  type ImportLoopCapturePacketInput,
  type LinkCompletedActivityInput,
  type LoopCapturePacketSnapshot,
  type LoopActivityContextRequest,
  type LoopRoleBriefDisplaySnapshot,
  type LoopRoleBriefInput,
  type LoopSnapshot,
  type ReviseLoopInput,
  type ReviseLoopRoleBriefInput,
  type TargetProfileMigrationInput,
} from "./loop-policy";

export {
  bindPlannedActivitySchema,
  loopActivityContextRequestSchema,
  createLoopSchema,
  captureLoopPacketSchema,
  getLoopRoleBriefSourceSchema,
  importLoopCapturePacketSchema,
  linkCompletedActivitySchema,
  queryLoopCapturePacketsSchema,
  queryLoopRoleBriefSourceSchema,
  queryLoopsSchema,
  queryRoleBriefMigrationInboxSchema,
  reviseLoopRoleBriefSchema,
  reviseLoopSchema,
  targetProfileMigrationSchema,
} from "./loop-policy";

export class LoopError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "LoopError";
    this.code = code;
    this.retryable = retryable;
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const fingerprint = (input: unknown) => sha256(JSON.stringify(input));

function assertRoleBriefIdentity(loop: LoopSnapshot, roleBrief: LoopRoleBriefInput) {
  if (loop.company !== roleBrief.company || loop.roleTitle !== roleBrief.roleTitle) {
    throw new LoopError(
      "loop_role_brief_identity_mismatch",
      "The Role Brief must describe the same company and role as its Loop.",
    );
  }
}

function roleBriefDisplaySnapshot(roleBrief: LoopRoleBriefInput): LoopRoleBriefDisplaySnapshot {
  const display = Object.fromEntries(Object.entries(roleBrief).filter(([key]) => key !== "ownerNotes" && key !== "source"));
  return loopRoleBriefDisplaySnapshotSchema.parse({
    ...display,
    source: {
      kind: roleBrief.source.kind,
      displayLocator: roleBrief.source.displayLocator,
      capturedAt: roleBrief.source.capturedAt,
    },
  });
}

function displaySafeRoleBrief(row: {
  revision: number;
  sourceFingerprint: string;
  displaySnapshot: unknown;
  createdAt: number;
}): DisplaySafeLoopRoleBriefRevision {
  const snapshot = loopRoleBriefDisplaySnapshotSchema.parse(row.displaySnapshot);
  return {
    ...snapshot,
    source: {
      kind: snapshot.source.kind,
      displayLocator: snapshot.source.displayLocator,
      capturedAt: snapshot.source.capturedAt,
      fingerprint: row.sourceFingerprint,
    },
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

function boundRoleBriefDisplaySnapshot(value: unknown): LoopRoleBriefDisplaySnapshot {
  const revision = displaySafeLoopRoleBriefRevisionSchema.safeParse(value);
  if (!revision.success) return loopRoleBriefDisplaySnapshotSchema.parse(value);
  const snapshot = Object.fromEntries(Object.entries(revision.data).filter(
    ([key]) => key !== "revision" && key !== "createdAt" && key !== "source",
  ));
  const displaySource = Object.fromEntries(Object.entries(revision.data.source).filter(
    ([key]) => key !== "fingerprint",
  ));
  return loopRoleBriefDisplaySnapshotSchema.parse({
    ...snapshot,
    source: displaySource,
  });
}

function displayLoop(row: { revision: number; snapshot: unknown; createdAt: number }) {
  const snapshot = loopSnapshotSchema.parse(row.snapshot);
  return {
    ...snapshot,
    stages: [...snapshot.stages].sort((left, right) => left.order - right.order),
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

async function replayOperation(ownerId: string, operationId: string, requestFingerprint: string) {
  const rows = await getDb().select().from(interviewLoopOperations).where(and(
    eq(interviewLoopOperations.ownerId, ownerId),
    eq(interviewLoopOperations.operationId, operationId),
  )).limit(1);
  const operation = rows[0];
  if (!operation) return null;
  if (operation.requestFingerprint !== requestFingerprint) {
    throw new LoopError(
      "loop_operation_conflict",
      "This Loop operation ID already belongs to a different request.",
    );
  }
  return { ...(operation.receipt as object), duplicate: true };
}

export async function createLoop(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = createLoopSchema.parse(inputValue) as CreateLoopInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  assertRoleBriefIdentity(input.loop, input.roleBrief);

  const receipt = {
    status: "created" as const,
    loopId: input.loop.loopId,
    loopRevision: 1,
    roleBriefRevision: 1,
  };
  const sourceFingerprint = await sha256(input.roleBrief.source.jdText.trim());
  const absent = sql`NOT EXISTS (
    SELECT 1 FROM ${interviewLoops}
    WHERE ${interviewLoops.ownerId} = ${ownerId}
      AND ${interviewLoops.loopId} = ${input.loop.loopId}
  ) AND NOT EXISTS (
    SELECT 1 FROM ${interviewLoopOperations}
    WHERE ${interviewLoopOperations.ownerId} = ${ownerId}
      AND ${interviewLoopOperations.operationId} = ${input.operationId}
  )`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, absent),
      db.insert(interviewLoopRevisions).values({
        ownerId,
        loopId: input.loop.loopId,
        revision: 1,
        operationId: input.operationId,
        requestFingerprint,
        snapshot: input.loop,
        createdAt: nowMs,
      }),
      db.insert(loopRoleBriefRevisions).values({
        ownerId,
        loopId: input.loop.loopId,
        revision: 1,
        operationId: input.operationId,
        requestFingerprint,
        sourceFingerprint,
        displaySnapshot: roleBriefDisplaySnapshot(input.roleBrief),
        privateSnapshot: input.roleBrief,
        createdAt: nowMs,
      }),
      db.insert(interviewLoops).values({
        ownerId,
        loopId: input.loop.loopId,
        currentRevision: 1,
        currentRoleBriefRevision: 1,
        state: input.loop.state,
        company: input.loop.company,
        roleTitle: input.loop.roleTitle,
        status: input.loop.status,
        createdAt: nowMs,
        updatedAt: nowMs,
      }),
      db.insert(interviewLoopOperations).values({
        ownerId,
        operationId: input.operationId,
        loopId: input.loop.loopId,
        action: "create",
        requestFingerprint,
        loopRevision: 1,
        roleBriefRevision: 1,
        receipt,
        createdAt: nowMs,
      }),
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${interviewLoops}
        WHERE ${interviewLoops.ownerId} = ${ownerId}
          AND ${interviewLoops.loopId} = ${input.loop.loopId}
          AND ${interviewLoops.currentRevision} = 1
          AND ${interviewLoops.currentRoleBriefRevision} = 1
      )`),
    ]);
  } catch (error) {
    const racedReplay = await replayOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    const existing = await db.select({ loopId: interviewLoops.loopId }).from(interviewLoops).where(and(
      eq(interviewLoops.ownerId, ownerId),
      eq(interviewLoops.loopId, input.loop.loopId),
    )).limit(1);
    if (existing[0]) throw new LoopError("loop_revision_conflict", "The Loop already exists; reread it before retrying.");
    throw error;
  }
  return { ...receipt, duplicate: false };
}

export async function reviseLoop(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = reviseLoopSchema.parse(inputValue) as ReviseLoopInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;

  const rows = await db.select().from(interviewLoops).where(and(
    eq(interviewLoops.ownerId, ownerId),
    eq(interviewLoops.loopId, input.loopId),
  )).limit(1);
  const current = rows[0];
  if (!current) throw new LoopError("loop_not_found", "That owner-private Loop is unavailable.");
  if (current.currentRevision !== input.expectedRevision) {
    throw new LoopError("loop_revision_conflict", "The Loop changed; reread it before retrying.");
  }
  if (current.company !== input.loop.company || current.roleTitle !== input.loop.roleTitle) {
    throw new LoopError(
      "loop_identity_immutable",
      "A Loop keeps one company-and-role identity. Create a separate Loop for a different hiring process.",
    );
  }

  const revision = input.expectedRevision + 1;
  const receipt = {
    status: "revised" as const,
    loopId: input.loopId,
    loopRevision: revision,
    roleBriefRevision: current.currentRoleBriefRevision,
  };
  const currentCondition = sql`EXISTS (
    SELECT 1 FROM ${interviewLoops}
    WHERE ${interviewLoops.ownerId} = ${ownerId}
      AND ${interviewLoops.loopId} = ${input.loopId}
      AND ${interviewLoops.currentRevision} = ${input.expectedRevision}
  )`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, currentCondition),
      db.insert(interviewLoopRevisions).values({
        ownerId,
        loopId: input.loopId,
        revision,
        operationId: input.operationId,
        requestFingerprint,
        snapshot: input.loop,
        createdAt: nowMs,
      }),
      db.update(interviewLoops).set({
        currentRevision: revision,
        state: input.loop.state,
        company: input.loop.company,
        roleTitle: input.loop.roleTitle,
        status: input.loop.status,
        updatedAt: nowMs,
      }).where(and(
        eq(interviewLoops.ownerId, ownerId),
        eq(interviewLoops.loopId, input.loopId),
        eq(interviewLoops.currentRevision, input.expectedRevision),
      )),
      db.insert(interviewLoopOperations).values({
        ownerId,
        operationId: input.operationId,
        loopId: input.loopId,
        action: "revise",
        requestFingerprint,
        loopRevision: revision,
        roleBriefRevision: current.currentRoleBriefRevision,
        receipt,
        createdAt: nowMs,
      }),
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${interviewLoops}
        WHERE ${interviewLoops.ownerId} = ${ownerId}
          AND ${interviewLoops.loopId} = ${input.loopId}
          AND ${interviewLoops.currentRevision} = ${revision}
      )`),
    ]);
  } catch (error) {
    const racedReplay = await replayOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    const raced = await db.select({ revision: interviewLoops.currentRevision }).from(interviewLoops).where(and(
      eq(interviewLoops.ownerId, ownerId),
      eq(interviewLoops.loopId, input.loopId),
    )).limit(1);
    if (!raced[0]) throw new LoopError("loop_not_found", "That owner-private Loop is unavailable.");
    if (raced[0].revision !== input.expectedRevision) {
      throw new LoopError("loop_revision_conflict", "The Loop changed; reread it before retrying.");
    }
    throw error;
  }
  return { ...receipt, duplicate: false };
}

export async function reviseLoopRoleBrief(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = reviseLoopRoleBriefSchema.parse(inputValue) as ReviseLoopRoleBriefInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;

  const rows = await db.select().from(interviewLoops).where(and(
    eq(interviewLoops.ownerId, ownerId),
    eq(interviewLoops.loopId, input.loopId),
  )).limit(1);
  const current = rows[0];
  if (!current) throw new LoopError("loop_not_found", "That owner-private Loop is unavailable.");
  if (current.currentRoleBriefRevision !== input.expectedRevision) {
    throw new LoopError("loop_role_brief_revision_conflict", "The Role Brief changed; reread it before retrying.");
  }
  assertRoleBriefIdentity({
    loopId: current.loopId,
    state: current.state,
    company: current.company,
    roleTitle: current.roleTitle,
    status: current.status,
    openedAt: current.createdAt,
    outcome: null,
    stages: [],
  }, input.roleBrief);

  const revision = input.expectedRevision + 1;
  const receipt = {
    status: "revised" as const,
    loopId: input.loopId,
    loopRevision: current.currentRevision,
    roleBriefRevision: revision,
  };
  const sourceFingerprint = await sha256(input.roleBrief.source.jdText.trim());
  const currentCondition = sql`EXISTS (
    SELECT 1 FROM ${interviewLoops}
    WHERE ${interviewLoops.ownerId} = ${ownerId}
      AND ${interviewLoops.loopId} = ${input.loopId}
      AND ${interviewLoops.currentRoleBriefRevision} = ${input.expectedRevision}
  )`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, currentCondition),
      db.insert(loopRoleBriefRevisions).values({
        ownerId,
        loopId: input.loopId,
        revision,
        operationId: input.operationId,
        requestFingerprint,
        sourceFingerprint,
        displaySnapshot: roleBriefDisplaySnapshot(input.roleBrief),
        privateSnapshot: input.roleBrief,
        createdAt: nowMs,
      }),
      db.update(interviewLoops).set({
        currentRoleBriefRevision: revision,
        updatedAt: nowMs,
      }).where(and(
        eq(interviewLoops.ownerId, ownerId),
        eq(interviewLoops.loopId, input.loopId),
        eq(interviewLoops.currentRoleBriefRevision, input.expectedRevision),
      )),
      db.insert(interviewLoopOperations).values({
        ownerId,
        operationId: input.operationId,
        loopId: input.loopId,
        action: "revise_role_brief",
        requestFingerprint,
        loopRevision: current.currentRevision,
        roleBriefRevision: revision,
        receipt,
        createdAt: nowMs,
      }),
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${interviewLoops}
        WHERE ${interviewLoops.ownerId} = ${ownerId}
          AND ${interviewLoops.loopId} = ${input.loopId}
          AND ${interviewLoops.currentRoleBriefRevision} = ${revision}
      )`),
    ]);
  } catch (error) {
    const racedReplay = await replayOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    const raced = await db.select({ revision: interviewLoops.currentRoleBriefRevision }).from(interviewLoops).where(and(
      eq(interviewLoops.ownerId, ownerId),
      eq(interviewLoops.loopId, input.loopId),
    )).limit(1);
    if (!raced[0]) throw new LoopError("loop_not_found", "That owner-private Loop is unavailable.");
    if (raced[0].revision !== input.expectedRevision) {
      throw new LoopError("loop_role_brief_revision_conflict", "The Role Brief changed; reread it before retrying.");
    }
    throw error;
  }
  return { ...receipt, duplicate: false };
}

async function readLoopProjection(ownerId: string, input: {
  loopId: string;
  loopRevision?: number;
  roleBriefRevision?: number;
  includeArchived?: boolean;
}) {
  const db = getDb();
  const rows = await db.select().from(interviewLoops).where(and(
    eq(interviewLoops.ownerId, ownerId),
    eq(interviewLoops.loopId, input.loopId),
  )).limit(1);
  const current = rows[0];
  if (!current || (!input.includeArchived && current.state === "archived")) return null;
  const [loopRows, roleBriefRows, activityHistory, activityBindings] = await Promise.all([
    db.select().from(interviewLoopRevisions).where(and(
      eq(interviewLoopRevisions.ownerId, ownerId),
      eq(interviewLoopRevisions.loopId, input.loopId),
      eq(interviewLoopRevisions.revision, input.loopRevision ?? current.currentRevision),
    )).limit(1),
    db.select().from(loopRoleBriefRevisions).where(and(
      eq(loopRoleBriefRevisions.ownerId, ownerId),
      eq(loopRoleBriefRevisions.loopId, input.loopId),
      eq(loopRoleBriefRevisions.revision, input.roleBriefRevision ?? current.currentRoleBriefRevision),
    )).limit(1),
    db.select().from(loopActivityHistory).where(and(
      eq(loopActivityHistory.ownerId, ownerId),
      eq(loopActivityHistory.loopId, input.loopId),
    )).orderBy(desc(loopActivityHistory.completedAt), desc(loopActivityHistory.activityId)).limit(201),
    db.select({
      activityId: loopActivityBindings.activityId,
      stageId: loopActivityBindings.stageId,
      loopRevision: loopActivityBindings.loopRevision,
      roleBriefRevision: loopActivityBindings.roleBriefRevision,
      specialty: loopActivityBindings.specialty,
      questionId: loopActivityBindings.questionId,
      payload: extraActivities.payload,
    }).from(loopActivityBindings).innerJoin(extraActivities, and(
      eq(extraActivities.ownerId, loopActivityBindings.ownerId),
      eq(extraActivities.id, loopActivityBindings.activityId),
    )).where(and(
      eq(loopActivityBindings.ownerId, ownerId),
      eq(loopActivityBindings.loopId, input.loopId),
    )),
  ]);
  if (!loopRows[0] || !roleBriefRows[0]) return null;
  return {
    loop: displayLoop(loopRows[0]),
    roleBrief: displaySafeRoleBrief(roleBriefRows[0]),
    activityHistory: activityHistory.slice(0, 200).map((history) => ({
      activityId: history.activityId,
      loopId: history.loopId,
      stageId: history.stageId,
      roleBriefRevision: history.roleBriefRevision,
      specialty: history.specialty,
      questionId: history.questionId,
      result: history.result,
      completedAt: history.completedAt,
      receipt: history.receipt,
    })),
    activityHistoryTruncated: activityHistory.length > 200,
    activityBindings: activityBindings.map((binding) => ({
      activityId: binding.activityId,
      stageId: binding.stageId,
      loopRevision: binding.loopRevision,
      roleBriefRevision: binding.roleBriefRevision,
      specialty: binding.specialty,
      questionId: binding.questionId,
      title: String((binding.payload as { title?: unknown }).title ?? binding.questionId),
      completed: activityHistory.some((history) => history.activityId === binding.activityId),
    })),
    current: {
      loopRevision: current.currentRevision,
      roleBriefRevision: current.currentRoleBriefRevision,
    },
  };
}

export async function readLoopRoleBriefSource(ownerId: string, inputValue: unknown) {
  const input = queryLoopRoleBriefSourceSchema.parse(inputValue);
  const db = getDb();
  const loopRows = await db.select({
    currentRoleBriefRevision: interviewLoops.currentRoleBriefRevision,
  }).from(interviewLoops).where(and(
    eq(interviewLoops.ownerId, ownerId),
    eq(interviewLoops.loopId, input.loopId),
  )).limit(1);
  const loop = loopRows[0];
  if (!loop) throw new LoopError("loop_not_found", "That owner-private Loop is unavailable.");
  const revision = input.roleBriefRevision ?? loop.currentRoleBriefRevision;
  const revisionRows = await db.select().from(loopRoleBriefRevisions).where(and(
    eq(loopRoleBriefRevisions.ownerId, ownerId),
    eq(loopRoleBriefRevisions.loopId, input.loopId),
    eq(loopRoleBriefRevisions.revision, revision),
  )).limit(1);
  const row = revisionRows[0];
  if (!row) throw new LoopError("loop_role_brief_not_found", "That immutable Role Brief revision is unavailable.");
  const roleBrief = loopRoleBriefInputSchema.parse(row.privateSnapshot);
  return {
    loopId: input.loopId,
    roleBriefRevision: row.revision,
    label: roleBrief.label,
    company: roleBrief.company,
    roleTitle: roleBrief.roleTitle,
    source: {
      ...roleBrief.source,
      fingerprint: row.sourceFingerprint,
    },
    createdAt: row.createdAt,
  };
}

export async function resolveLoopActivityContext(
  ownerId: string,
  inputValue: LoopActivityContextRequest,
) {
  const input = loopActivityContextRequestSchema.parse(inputValue);
  const projection = await readLoopProjection(ownerId, { loopId: input.loopId });
  if (!projection) {
    throw new LoopError("loop_context_not_found", "That active owner-private Loop is unavailable.");
  }
  if (input.stageId && !projection.loop.stages.some((stage) => stage.stageId === input.stageId)) {
    throw new LoopError("loop_stage_not_found", "That Round is not present in the current Loop revision.");
  }
  return {
    loopContext: {
      loopId: input.loopId,
      ...(input.stageId ? { stageId: input.stageId } : {}),
      loopRevision: projection.loop.revision,
      roleBriefRevision: projection.roleBrief.revision,
      company: projection.loop.company,
      roleTitle: projection.loop.roleTitle,
    },
    roleBriefDisplaySnapshot: projection.roleBrief,
  };
}

export async function readBoundLoopActivityContext(ownerId: string, activityId: string) {
  const rows = await getDb().select().from(loopActivityBindings).where(and(
    eq(loopActivityBindings.ownerId, ownerId),
    eq(loopActivityBindings.activityId, activityId),
  )).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    binding: {
      activityId: row.activityId,
      loopId: row.loopId,
      stageId: row.stageId,
      loopRevision: row.loopRevision,
      roleBriefRevision: row.roleBriefRevision,
      specialty: row.specialty,
      questionId: row.questionId,
      revision: row.bindingRevision,
      updatedAt: row.updatedAt,
    },
    roleBrief: boundRoleBriefDisplaySnapshot(row.roleBriefDisplaySnapshot),
  };
}

async function replayActivityBinding(
  ownerId: string,
  operationId: string,
  requestFingerprint: string,
) {
  const rows = await getDb().select().from(loopActivityBindingOperations).where(and(
    eq(loopActivityBindingOperations.ownerId, ownerId),
    eq(loopActivityBindingOperations.operationId, operationId),
  )).limit(1);
  const operation = rows[0];
  if (!operation) return null;
  if (operation.requestFingerprint !== requestFingerprint) {
    throw new LoopError(
      "loop_activity_binding_operation_conflict",
      "This Loop binding operation ID already belongs to a different request.",
    );
  }
  return { ...(operation.receipt as object), duplicate: true };
}

function practiceActivityIdentity(payloadValue: unknown) {
  const payload = payloadValue as Record<string, unknown>;
  const specialty = payload.type;
  const questionId = payload.questionId;
  if (!loopSpecialtySchema.safeParse(specialty).success || typeof questionId !== "string") {
    throw new LoopError("loop_activity_not_practice", "Only a stable Interview practice activity can bind to a Loop.");
  }
  return {
    payload,
    specialty: specialty as "leetcode" | "system_design" | "behavioral",
    questionId,
  };
}

export async function bindPlannedActivityToLoop(
  ownerId: string,
  inputValue: unknown,
  nowMs = Date.now(),
) {
  const input = bindPlannedActivitySchema.parse(inputValue) as BindPlannedActivityInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayActivityBinding(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;

  const [activityRows, timerRows, currentBindings] = await Promise.all([
    db.select().from(extraActivities).where(and(
      eq(extraActivities.ownerId, ownerId),
      eq(extraActivities.id, input.activityId),
    )).limit(1),
    db.select().from(timers).where(and(
      eq(timers.ownerId, ownerId),
      eq(timers.subjectId, input.activityId),
      eq(timers.kind, "activity"),
    )).limit(1),
    db.select().from(loopActivityBindings).where(and(
      eq(loopActivityBindings.ownerId, ownerId),
      eq(loopActivityBindings.activityId, input.activityId),
    )).limit(1),
  ]);
  const activity = activityRows[0];
  if (!activity) throw new LoopError("loop_activity_not_found", "That owner-private planned activity is unavailable.");
  if (activity.revision !== input.expectedActivityRevision) {
    throw new LoopError("loop_activity_revision_conflict", "The planned activity changed; reread it before binding.");
  }
  if (timerRows[0]?.startedAt) {
    throw new LoopError("loop_activity_already_started", "Loop context is immutable after an activity starts.");
  }
  const { payload, specialty, questionId } = practiceActivityIdentity(activity.payload);
  const resolved = await resolveLoopActivityContext(ownerId, {
    loopId: input.loopId,
    ...(input.stageId ? { stageId: input.stageId } : {}),
  });
  const bindingRevision = (currentBindings[0]?.bindingRevision ?? 0) + 1;
  const activityRevision = input.expectedActivityRevision + 1;
  const receipt = {
    status: "bound" as const,
    activityId: input.activityId,
    activityRevision,
    bindingRevision,
    ...resolved.loopContext,
  };
  const unchangedActivity = sql`EXISTS (
    SELECT 1 FROM ${extraActivities}
    WHERE ${extraActivities.ownerId} = ${ownerId}
      AND ${extraActivities.id} = ${input.activityId}
      AND ${extraActivities.revision} = ${input.expectedActivityRevision}
  ) AND NOT EXISTS (
    SELECT 1 FROM ${timers}
    WHERE ${timers.ownerId} = ${ownerId}
      AND ${timers.subjectId} = ${input.activityId}
      AND ${timers.kind} = 'activity'
      AND ${timers.startedAt} IS NOT NULL
  )`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, unchangedActivity),
      db.insert(loopActivityBindings).values({
        ownerId,
        activityId: input.activityId,
        loopId: resolved.loopContext.loopId,
        stageId: resolved.loopContext.stageId ?? null,
        loopRevision: resolved.loopContext.loopRevision,
        roleBriefRevision: resolved.loopContext.roleBriefRevision,
        specialty,
        questionId,
        roleBriefDisplaySnapshot: boundRoleBriefDisplaySnapshot(resolved.roleBriefDisplaySnapshot),
        bindingRevision,
        createdAt: currentBindings[0]?.createdAt ?? nowMs,
        updatedAt: nowMs,
      }).onConflictDoUpdate({
        target: [loopActivityBindings.ownerId, loopActivityBindings.activityId],
        set: {
          loopId: resolved.loopContext.loopId,
          stageId: resolved.loopContext.stageId ?? null,
          loopRevision: resolved.loopContext.loopRevision,
          roleBriefRevision: resolved.loopContext.roleBriefRevision,
          specialty,
          questionId,
          roleBriefDisplaySnapshot: boundRoleBriefDisplaySnapshot(resolved.roleBriefDisplaySnapshot),
          bindingRevision,
          updatedAt: nowMs,
        },
      }),
      db.update(extraActivities).set({
        payload: { ...payload, loopContext: resolved.loopContext },
        revision: activityRevision,
        updatedAt: nowMs,
      }).where(and(
        eq(extraActivities.ownerId, ownerId),
        eq(extraActivities.id, input.activityId),
        eq(extraActivities.revision, input.expectedActivityRevision),
      )),
      db.insert(loopActivityBindingOperations).values({
        ownerId,
        operationId: input.operationId,
        activityId: input.activityId,
        requestFingerprint,
        receipt,
        createdAt: nowMs,
      }),
    ]);
  } catch {
    const raced = await replayActivityBinding(ownerId, input.operationId, requestFingerprint);
    if (raced) return raced;
    throw new LoopError("loop_activity_revision_conflict", "The planned activity changed while binding; reread it before retrying.");
  }
  return { ...receipt, duplicate: false };
}

async function readCompletedActivityLinkCandidate(ownerId: string, input: LinkCompletedActivityInput) {
  const db = getDb();
  const [activityRows, timerRows, outcomeRows, currentBindings, currentHistory, loopRows] = await Promise.all([
    db.select().from(extraActivities).where(and(
      eq(extraActivities.ownerId, ownerId),
      eq(extraActivities.id, input.activityId),
    )).limit(1),
    db.select().from(timers).where(and(
      eq(timers.ownerId, ownerId),
      eq(timers.subjectId, input.activityId),
      eq(timers.kind, "activity"),
    )).limit(1),
    db.select().from(outcomes).where(and(
      eq(outcomes.ownerId, ownerId),
      eq(outcomes.activityId, input.activityId),
    )).limit(1),
    db.select().from(loopActivityBindings).where(and(
      eq(loopActivityBindings.ownerId, ownerId),
      eq(loopActivityBindings.activityId, input.activityId),
    )).limit(1),
    db.select().from(loopActivityHistory).where(and(
      eq(loopActivityHistory.ownerId, ownerId),
      eq(loopActivityHistory.activityId, input.activityId),
    )).limit(1),
    db.select().from(interviewLoops).where(and(
      eq(interviewLoops.ownerId, ownerId),
      eq(interviewLoops.loopId, input.loopId),
    )).limit(1),
  ]);
  const activity = activityRows[0];
  const timer = timerRows[0];
  const outcome = outcomeRows[0];
  const loop = loopRows[0];
  if (!activity) throw new LoopError("loop_activity_not_found", "That owner-private completed activity is unavailable.");
  if (!timer?.startedAt || !timer.completed || !timer.completedAt || !outcome) {
    throw new LoopError(
      "loop_activity_not_completed",
      "Historical linking requires an authoritative completed timer and explicit activity result.",
    );
  }
  if (currentBindings[0] || currentHistory[0]) {
    throw new LoopError("loop_activity_already_bound", "That activity already belongs to a Loop and cannot be moved.");
  }
  if (!loop || loop.state !== "active") {
    throw new LoopError("loop_not_found", "That active owner-private Loop is unavailable.");
  }
  if (loop.currentRevision !== input.expectedLoopRevision) {
    throw new LoopError("loop_revision_conflict", "The Loop changed; reread it before linking the completed activity.");
  }
  if (loop.currentRoleBriefRevision !== input.expectedRoleBriefRevision) {
    throw new LoopError(
      "loop_role_brief_revision_conflict",
      "The Role Brief changed; reread it before linking the completed activity.",
    );
  }
  return { activity, timer, outcome, loop };
}

async function resolveCompletedActivityLinkContext(
  ownerId: string,
  candidate: Awaited<ReturnType<typeof readCompletedActivityLinkCandidate>>,
  input: LinkCompletedActivityInput,
) {
  const db = getDb();
  const [loopRevisionRows, roleBriefRows] = await Promise.all([
    db.select().from(interviewLoopRevisions).where(and(
      eq(interviewLoopRevisions.ownerId, ownerId),
      eq(interviewLoopRevisions.loopId, input.loopId),
      eq(interviewLoopRevisions.revision, input.expectedLoopRevision),
    )).limit(1),
    db.select().from(loopRoleBriefRevisions).where(and(
      eq(loopRoleBriefRevisions.ownerId, ownerId),
      eq(loopRoleBriefRevisions.loopId, input.loopId),
      eq(loopRoleBriefRevisions.revision, input.expectedRoleBriefRevision),
    )).limit(1),
  ]);
  const loopRevision = loopRevisionRows[0];
  const roleBriefRevision = roleBriefRows[0];
  if (!loopRevision || !roleBriefRevision) {
    throw new LoopError("loop_revision_conflict", "The Loop context changed; reread it before linking the completed activity.");
  }
  const snapshot = loopSnapshotSchema.parse(loopRevision.snapshot);
  if (input.stageId && !snapshot.stages.some((stage) => stage.stageId === input.stageId)) {
    throw new LoopError("loop_stage_not_found", "That Round is not present in the current Loop revision.");
  }
  return {
    loopContext: {
      loopId: input.loopId,
      ...(input.stageId ? { stageId: input.stageId } : {}),
      loopRevision: input.expectedLoopRevision,
      roleBriefRevision: input.expectedRoleBriefRevision,
      company: candidate.loop.company,
      roleTitle: candidate.loop.roleTitle,
    },
    roleBriefDisplaySnapshot: displaySafeRoleBrief(roleBriefRevision),
  };
}

export async function linkCompletedActivityToLoop(
  ownerId: string,
  inputValue: unknown,
  nowMs = Date.now(),
) {
  const input = linkCompletedActivitySchema.parse(inputValue) as LinkCompletedActivityInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayActivityBinding(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const candidate = await readCompletedActivityLinkCandidate(ownerId, input);
  const { activity, timer, outcome } = candidate;
  const { payload, specialty, questionId } = practiceActivityIdentity(activity.payload);
  const resolved = await resolveCompletedActivityLinkContext(ownerId, candidate, input);
  const activityRevision = activity.revision + 1;
  const historyReceipt = {
    schemaVersion: 1,
    source: "explicit_completed_activity_link",
    activityId: input.activityId,
    timerRevision: timer.revision,
    outcomeRevision: outcome.revision,
    completedAt: timer.completedAt,
    linkedAt: nowMs,
  };
  const receipt = {
    status: "historically_linked" as const,
    activityId: input.activityId,
    activityRevision,
    bindingRevision: 1,
    result: outcome.outcome,
    completedAt: timer.completedAt,
    linkedAt: nowMs,
    ...resolved.loopContext,
  };
  const unchanged = sql`EXISTS (
    SELECT 1 FROM ${extraActivities}
    WHERE ${extraActivities.ownerId} = ${ownerId}
      AND ${extraActivities.id} = ${input.activityId}
      AND ${extraActivities.revision} = ${activity.revision}
  ) AND EXISTS (
    SELECT 1 FROM ${timers}
    WHERE ${timers.ownerId} = ${ownerId}
      AND ${timers.subjectId} = ${input.activityId}
      AND ${timers.kind} = 'activity'
      AND ${timers.completed} = 1
      AND ${timers.completedAt} = ${timer.completedAt}
      AND ${timers.revision} = ${timer.revision}
  ) AND EXISTS (
    SELECT 1 FROM ${outcomes}
    WHERE ${outcomes.ownerId} = ${ownerId}
      AND ${outcomes.activityId} = ${input.activityId}
      AND ${outcomes.outcome} = ${outcome.outcome}
      AND ${outcomes.revision} = ${outcome.revision}
  ) AND EXISTS (
    SELECT 1 FROM ${interviewLoops}
    WHERE ${interviewLoops.ownerId} = ${ownerId}
      AND ${interviewLoops.loopId} = ${input.loopId}
      AND ${interviewLoops.currentRevision} = ${input.expectedLoopRevision}
      AND ${interviewLoops.currentRoleBriefRevision} = ${input.expectedRoleBriefRevision}
  ) AND NOT EXISTS (
    SELECT 1 FROM ${loopActivityBindings}
    WHERE ${loopActivityBindings.ownerId} = ${ownerId}
      AND ${loopActivityBindings.activityId} = ${input.activityId}
  ) AND NOT EXISTS (
    SELECT 1 FROM ${loopActivityHistory}
    WHERE ${loopActivityHistory.ownerId} = ${ownerId}
      AND ${loopActivityHistory.activityId} = ${input.activityId}
  ) AND NOT EXISTS (
    SELECT 1 FROM ${loopActivityBindingOperations}
    WHERE ${loopActivityBindingOperations.ownerId} = ${ownerId}
      AND ${loopActivityBindingOperations.operationId} = ${input.operationId}
  )`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, unchanged),
      db.insert(loopActivityBindings).values({
        ownerId,
        activityId: input.activityId,
        loopId: resolved.loopContext.loopId,
        stageId: resolved.loopContext.stageId ?? null,
        loopRevision: resolved.loopContext.loopRevision,
        roleBriefRevision: resolved.loopContext.roleBriefRevision,
        specialty,
        questionId,
        roleBriefDisplaySnapshot: boundRoleBriefDisplaySnapshot(resolved.roleBriefDisplaySnapshot),
        bindingRevision: 1,
        createdAt: nowMs,
        updatedAt: nowMs,
      }),
      db.update(extraActivities).set({
        payload: { ...payload, loopContext: resolved.loopContext },
        revision: activityRevision,
        updatedAt: nowMs,
      }).where(and(
        eq(extraActivities.ownerId, ownerId),
        eq(extraActivities.id, input.activityId),
        eq(extraActivities.revision, activity.revision),
      )),
      db.insert(loopActivityHistory).values({
        ownerId,
        activityId: input.activityId,
        loopId: resolved.loopContext.loopId,
        stageId: resolved.loopContext.stageId ?? null,
        roleBriefRevision: resolved.loopContext.roleBriefRevision,
        specialty,
        questionId,
        result: outcome.outcome,
        completedAt: timer.completedAt,
        receipt: historyReceipt,
        createdAt: nowMs,
      }),
      db.insert(loopActivityBindingOperations).values({
        ownerId,
        operationId: input.operationId,
        activityId: input.activityId,
        requestFingerprint,
        receipt,
        createdAt: nowMs,
      }),
    ]);
  } catch {
    const raced = await replayActivityBinding(ownerId, input.operationId, requestFingerprint);
    if (raced) return raced;
    throw new LoopError(
      "loop_completed_activity_link_conflict",
      "The activity or Loop changed while linking; reread both before retrying.",
    );
  }
  return { ...receipt, duplicate: false };
}

export async function queryLoops(ownerId: string, inputValue: unknown) {
  const input = queryLoopsSchema.parse(inputValue);
  const facts = await readLoopJourneyFacts(ownerId);
  if (input.loopId) {
    const projection = await readLoopProjection(ownerId, {
      loopId: input.loopId,
      loopRevision: input.loopRevision,
      roleBriefRevision: input.roleBriefRevision,
      includeArchived: input.includeArchived,
    });
    return { loops: projection ? [projection] : [], truncated: false, facts };
  }
  const rows = await getDb().select({ loopId: interviewLoops.loopId }).from(interviewLoops).where(and(
    eq(interviewLoops.ownerId, ownerId),
    input.includeArchived ? undefined : eq(interviewLoops.state, "active"),
  )).orderBy(desc(interviewLoops.updatedAt), desc(interviewLoops.loopId)).limit(51);
  const projections = await Promise.all(rows.slice(0, 50).map((row) => readLoopProjection(ownerId, {
    loopId: row.loopId,
    includeArchived: input.includeArchived,
  })));
  return { loops: projections.filter((projection) => projection !== null), truncated: rows.length > 50, facts };
}

export async function readLoopJourneyFacts(ownerId: string) {
  const rows = await getDb().select({
    state: interviewLoops.state,
    status: interviewLoops.status,
    currentRevision: interviewLoops.currentRevision,
    snapshot: interviewLoopRevisions.snapshot,
  }).from(interviewLoops).innerJoin(interviewLoopRevisions, and(
    eq(interviewLoopRevisions.ownerId, interviewLoops.ownerId),
    eq(interviewLoopRevisions.loopId, interviewLoops.loopId),
    eq(interviewLoopRevisions.revision, interviewLoops.currentRevision),
  )).where(eq(interviewLoops.ownerId, ownerId));
  const snapshots = rows.map((row) => loopSnapshotSchema.parse(row.snapshot));
  const stages = snapshots.flatMap((loop) => loop.stages);
  const datedStages = stages.filter((stage) => (
    stage.scheduledAt || stage.startedAt || stage.completedAt || stage.cancelledAt
  ));
  const outcomes = { offer: 0, rejected: 0, withdrawn: 0, closed: 0, unresolved: 0 };
  snapshots.forEach((loop) => {
    if (loop.outcome) outcomes[loop.outcome] += 1;
    else outcomes.unresolved += 1;
  });
  return {
    loopCount: snapshots.length,
    activeLoopCount: rows.filter((row) => row.state === "active" && row.status === "active").length,
    stageCount: stages.length,
    completedStageCount: stages.filter((stage) => stage.status === "completed").length,
    scheduledStageCount: stages.filter((stage) => stage.status === "scheduled").length,
    interviewDateCount: new Set(datedStages.map((stage) => (
      stage.completedAt ?? stage.startedAt ?? stage.scheduledAt ?? stage.cancelledAt
    ))).size,
    outcomes,
  };
}

async function readTargetRoleBrief(ownerId: string, targetId: string, targetRevision: number) {
  const rows = await getDb().select({
    currentRevision: behavioralTargetProfiles.currentRevision,
    privateSnapshot: behavioralTargetProfileRevisions.privateSnapshot,
  }).from(behavioralTargetProfiles).innerJoin(
    behavioralTargetProfileRevisions,
    and(
      eq(behavioralTargetProfileRevisions.ownerId, behavioralTargetProfiles.ownerId),
      eq(behavioralTargetProfileRevisions.targetId, behavioralTargetProfiles.targetId),
      eq(behavioralTargetProfileRevisions.revision, targetRevision),
    ),
  ).where(and(
    eq(behavioralTargetProfiles.ownerId, ownerId),
    eq(behavioralTargetProfiles.targetId, targetId),
  )).limit(1);
  const row = rows[0];
  if (!row) throw new LoopError("role_brief_migration_target_not_found", "That owner-private Target Profile revision is unavailable.");
  if (row.currentRevision !== targetRevision) {
    throw new LoopError("role_brief_migration_target_revision_conflict", "The Target Profile changed; reread the migration inbox before retrying.");
  }
  const target = behavioralTargetProfileInputSchema.parse(row.privateSnapshot);
  return loopRoleBriefInputSchema.parse(Object.fromEntries(
    Object.entries(target).filter(([key]) => key !== "targetId"),
  ));
}

async function replayTargetMigration(ownerId: string, operationId: string, requestFingerprint: string) {
  const rows = await getDb().select().from(loopTargetProfileMigrations).where(and(
    eq(loopTargetProfileMigrations.ownerId, ownerId),
    eq(loopTargetProfileMigrations.operationId, operationId),
  )).limit(1);
  const migration = rows[0];
  if (!migration) return null;
  if (migration.requestFingerprint !== requestFingerprint) {
    throw new LoopError("role_brief_migration_operation_conflict", "This migration operation ID already belongs to a different request.");
  }
  return { ...(migration.receipt as object), duplicate: true };
}

export async function migrateTargetProfile(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = targetProfileMigrationSchema.parse(inputValue) as TargetProfileMigrationInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayTargetMigration(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const prior = await db.select().from(loopTargetProfileMigrations).where(and(
    eq(loopTargetProfileMigrations.ownerId, ownerId),
    eq(loopTargetProfileMigrations.targetId, input.targetId),
  )).limit(1);
  if (prior[0]) throw new LoopError("role_brief_migration_already_decided", "This standalone Target Profile already has an explicit migration decision.");
  const roleBrief = await readTargetRoleBrief(ownerId, input.targetId, input.targetRevision);
  const sourceFingerprint = await sha256(roleBrief.source.jdText.trim());

  if (input.action === "archive") {
    const receipt = {
      status: "decided" as const,
      action: input.action,
      targetId: input.targetId,
      targetRevision: input.targetRevision,
      loopId: null,
      roleBriefRevision: null,
    };
    try {
      await db.insert(loopTargetProfileMigrations).values({
        ownerId,
        targetId: input.targetId,
        targetRevision: input.targetRevision,
        operationId: input.operationId,
        requestFingerprint,
        action: input.action,
        loopId: null,
        roleBriefRevision: null,
        receipt,
        createdAt: nowMs,
      });
    } catch {
      const raced = await replayTargetMigration(ownerId, input.operationId, requestFingerprint);
      if (raced) return raced;
      throw new LoopError("role_brief_migration_already_decided", "This standalone Target Profile already has an explicit migration decision.");
    }
    return { ...receipt, duplicate: false };
  }

  if (input.action === "create_loop") {
    assertRoleBriefIdentity(input.loop, roleBrief);
    const receipt = {
      status: "migrated" as const,
      action: input.action,
      targetId: input.targetId,
      targetRevision: input.targetRevision,
      loopId: input.loop.loopId,
      loopRevision: 1,
      roleBriefRevision: 1,
    };
    const absent = sql`NOT EXISTS (
      SELECT 1 FROM ${interviewLoops}
      WHERE ${interviewLoops.ownerId} = ${ownerId}
        AND ${interviewLoops.loopId} = ${input.loop.loopId}
    ) AND NOT EXISTS (
      SELECT 1 FROM ${loopTargetProfileMigrations}
      WHERE ${loopTargetProfileMigrations.ownerId} = ${ownerId}
        AND ${loopTargetProfileMigrations.targetId} = ${input.targetId}
    )`;
    try {
      await db.batch([
        d1TransactionalInvariantGuard(db, absent),
        db.insert(interviewLoopRevisions).values({
          ownerId,
          loopId: input.loop.loopId,
          revision: 1,
          operationId: input.operationId,
          requestFingerprint,
          snapshot: input.loop,
          createdAt: nowMs,
        }),
        db.insert(loopRoleBriefRevisions).values({
          ownerId,
          loopId: input.loop.loopId,
          revision: 1,
          operationId: input.operationId,
          requestFingerprint,
          sourceFingerprint,
          displaySnapshot: roleBriefDisplaySnapshot(roleBrief),
          privateSnapshot: roleBrief,
          createdAt: nowMs,
        }),
        db.insert(interviewLoops).values({
          ownerId,
          loopId: input.loop.loopId,
          currentRevision: 1,
          currentRoleBriefRevision: 1,
          state: input.loop.state,
          company: input.loop.company,
          roleTitle: input.loop.roleTitle,
          status: input.loop.status,
          createdAt: nowMs,
          updatedAt: nowMs,
        }),
        db.insert(interviewLoopOperations).values({
          ownerId,
          operationId: input.operationId,
          loopId: input.loop.loopId,
          action: "create",
          requestFingerprint,
          loopRevision: 1,
          roleBriefRevision: 1,
          receipt,
          createdAt: nowMs,
        }),
        db.insert(loopTargetProfileMigrations).values({
          ownerId,
          targetId: input.targetId,
          targetRevision: input.targetRevision,
          operationId: input.operationId,
          requestFingerprint,
          action: input.action,
          loopId: input.loop.loopId,
          roleBriefRevision: 1,
          receipt,
          createdAt: nowMs,
        }),
      ]);
    } catch (error) {
      const raced = await replayTargetMigration(ownerId, input.operationId, requestFingerprint);
      if (raced) return raced;
      const existingLoop = await db.select({ id: interviewLoops.loopId }).from(interviewLoops).where(and(
        eq(interviewLoops.ownerId, ownerId),
        eq(interviewLoops.loopId, input.loop.loopId),
      )).limit(1);
      if (existingLoop[0]) throw new LoopError("loop_revision_conflict", "The destination Loop already exists; reread before retrying.");
      throw error;
    }
    return { ...receipt, duplicate: false };
  }

  const loopRows = await db.select().from(interviewLoops).where(and(
    eq(interviewLoops.ownerId, ownerId),
    eq(interviewLoops.loopId, input.loopId),
  )).limit(1);
  const loop = loopRows[0];
  if (!loop) throw new LoopError("loop_not_found", "That owner-private Loop is unavailable.");
  if (loop.currentRoleBriefRevision !== input.expectedRoleBriefRevision) {
    throw new LoopError("loop_role_brief_revision_conflict", "The Role Brief changed; reread it before retrying.");
  }
  assertRoleBriefIdentity({
    loopId: loop.loopId,
    state: loop.state,
    company: loop.company,
    roleTitle: loop.roleTitle,
    status: loop.status,
    openedAt: loop.createdAt,
    outcome: null,
    stages: [],
  }, roleBrief);
  const roleBriefRevision = input.expectedRoleBriefRevision + 1;
  const receipt = {
    status: "migrated" as const,
    action: input.action,
    targetId: input.targetId,
    targetRevision: input.targetRevision,
    loopId: input.loopId,
    loopRevision: loop.currentRevision,
    roleBriefRevision,
  };
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${interviewLoops}
        WHERE ${interviewLoops.ownerId} = ${ownerId}
          AND ${interviewLoops.loopId} = ${input.loopId}
          AND ${interviewLoops.currentRoleBriefRevision} = ${input.expectedRoleBriefRevision}
      ) AND NOT EXISTS (
        SELECT 1 FROM ${loopTargetProfileMigrations}
        WHERE ${loopTargetProfileMigrations.ownerId} = ${ownerId}
          AND ${loopTargetProfileMigrations.targetId} = ${input.targetId}
      )`),
      db.insert(loopRoleBriefRevisions).values({
        ownerId,
        loopId: input.loopId,
        revision: roleBriefRevision,
        operationId: input.operationId,
        requestFingerprint,
        sourceFingerprint,
        displaySnapshot: roleBriefDisplaySnapshot(roleBrief),
        privateSnapshot: roleBrief,
        createdAt: nowMs,
      }),
      db.update(interviewLoops).set({ currentRoleBriefRevision: roleBriefRevision, updatedAt: nowMs }).where(and(
        eq(interviewLoops.ownerId, ownerId),
        eq(interviewLoops.loopId, input.loopId),
        eq(interviewLoops.currentRoleBriefRevision, input.expectedRoleBriefRevision),
      )),
      db.insert(interviewLoopOperations).values({
        ownerId,
        operationId: input.operationId,
        loopId: input.loopId,
        action: "revise_role_brief",
        requestFingerprint,
        loopRevision: loop.currentRevision,
        roleBriefRevision,
        receipt,
        createdAt: nowMs,
      }),
      db.insert(loopTargetProfileMigrations).values({
        ownerId,
        targetId: input.targetId,
        targetRevision: input.targetRevision,
        operationId: input.operationId,
        requestFingerprint,
        action: input.action,
        loopId: input.loopId,
        roleBriefRevision,
        receipt,
        createdAt: nowMs,
      }),
    ]);
  } catch {
    const raced = await replayTargetMigration(ownerId, input.operationId, requestFingerprint);
    if (raced) return raced;
    throw new LoopError("loop_role_brief_revision_conflict", "The Role Brief or migration decision changed; reread before retrying.");
  }
  return { ...receipt, duplicate: false };
}

export async function queryRoleBriefMigrationInbox(ownerId: string, inputValue: unknown) {
  const input = queryRoleBriefMigrationInboxSchema.parse(inputValue);
  const targets = await getDb().select({
    targetId: behavioralTargetProfiles.targetId,
    targetRevision: behavioralTargetProfiles.currentRevision,
    state: behavioralTargetProfiles.state,
    label: behavioralTargetProfiles.label,
    updatedAt: behavioralTargetProfiles.updatedAt,
  }).from(behavioralTargetProfiles).where(and(
    eq(behavioralTargetProfiles.ownerId, ownerId),
    input.includeArchivedTargets ? undefined : eq(behavioralTargetProfiles.state, "active"),
  )).orderBy(desc(behavioralTargetProfiles.updatedAt)).limit(101);
  const decisions = await getDb().select().from(loopTargetProfileMigrations).where(
    eq(loopTargetProfileMigrations.ownerId, ownerId),
  );
  const decisionsByTarget = new Map(decisions.map((decision) => [decision.targetId, decision]));
  const items = (await Promise.all(targets.map(async (target) => {
    const decision = decisionsByTarget.get(target.targetId);
    if (decision && !input.includeDecided) return null;
    const revision = await readBehavioralTargetRevision(ownerId, target.targetId, target.targetRevision);
    if (!revision) return null;
    return {
      target: revision,
      decision: decision ? {
        action: decision.action,
        loopId: decision.loopId,
        roleBriefRevision: decision.roleBriefRevision,
        decidedAt: decision.createdAt,
      } : null,
    };
  }))).filter((item) => item !== null);
  return { items: items.slice(0, 100), truncated: targets.length > 100 };
}

async function replayCaptureOperation(ownerId: string, operationId: string, requestFingerprint: string) {
  const rows = await getDb().select().from(loopCapturePacketOperations).where(and(
    eq(loopCapturePacketOperations.ownerId, ownerId),
    eq(loopCapturePacketOperations.operationId, operationId),
  )).limit(1);
  const operation = rows[0];
  if (!operation) return null;
  if (operation.requestFingerprint !== requestFingerprint) {
    throw new LoopError("loop_capture_operation_conflict", "This Loop capture operation ID already belongs to a different request.");
  }
  return { ...(operation.receipt as object), duplicate: true };
}

export async function captureLoopPacket(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = captureLoopPacketSchema.parse(inputValue) as CaptureLoopPacketInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayCaptureOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const receipt = {
    status: "captured" as const,
    packetId: input.packet.packetId,
    capturedAt: input.packet.capturedAt,
    backfilledAt: null,
    loopId: null,
  };
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, sql`NOT EXISTS (
        SELECT 1 FROM ${loopCapturePackets}
        WHERE ${loopCapturePackets.ownerId} = ${ownerId}
          AND ${loopCapturePackets.packetId} = ${input.packet.packetId}
      )`),
      db.insert(loopCapturePackets).values({
        ownerId,
        packetId: input.packet.packetId,
        operationId: input.operationId,
        requestFingerprint,
        privateSnapshot: input.packet,
        status: "captured",
        capturedAt: input.packet.capturedAt,
        backfilledAt: null,
        loopId: null,
        createdAt: nowMs,
        updatedAt: nowMs,
      }),
      db.insert(loopCapturePacketOperations).values({
        ownerId,
        operationId: input.operationId,
        packetId: input.packet.packetId,
        action: "capture",
        requestFingerprint,
        receipt,
        createdAt: nowMs,
      }),
    ]);
  } catch {
    const raced = await replayCaptureOperation(ownerId, input.operationId, requestFingerprint);
    if (raced) return raced;
    throw new LoopError("loop_capture_packet_conflict", "That capture packet already exists; reread before retrying.");
  }
  return { ...receipt, duplicate: false };
}

export async function queryLoopCapturePackets(ownerId: string, inputValue: unknown) {
  const input = queryLoopCapturePacketsSchema.parse(inputValue);
  const rows = await getDb().select().from(loopCapturePackets).where(and(
    eq(loopCapturePackets.ownerId, ownerId),
    input.packetId ? eq(loopCapturePackets.packetId, input.packetId) : undefined,
    input.includeImported ? undefined : eq(loopCapturePackets.status, "captured"),
  )).orderBy(desc(loopCapturePackets.capturedAt)).limit(101);
  return {
    packets: rows.slice(0, 100).map((row) => ({
      packet: loopCapturePacketSnapshotSchema.parse(row.privateSnapshot),
      status: row.status,
      capturedAt: row.capturedAt,
      backfilledAt: row.backfilledAt,
      loopId: row.loopId,
    })),
    truncated: rows.length > 100,
  };
}

export async function importLoopCapturePacket(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = importLoopCapturePacketSchema.parse(inputValue) as ImportLoopCapturePacketInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayCaptureOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const [packetRows, loopRows] = await Promise.all([
    db.select().from(loopCapturePackets).where(and(
      eq(loopCapturePackets.ownerId, ownerId),
      eq(loopCapturePackets.packetId, input.packetId),
    )).limit(1),
    db.select().from(interviewLoops).where(and(
      eq(interviewLoops.ownerId, ownerId),
      eq(interviewLoops.loopId, input.loopId),
    )).limit(1),
  ]);
  const packetRow = packetRows[0];
  const loop = loopRows[0];
  if (!packetRow) throw new LoopError("loop_capture_packet_not_found", "That owner-private capture packet is unavailable.");
  if (!loop) throw new LoopError("loop_not_found", "That owner-private Loop is unavailable.");
  if (packetRow.status !== "captured") throw new LoopError("loop_capture_packet_already_imported", "That capture packet was already imported.");
  if (input.backfilledAt < packetRow.capturedAt) {
    throw new LoopError("loop_capture_backfilled_before_capture", "Backfilled time cannot precede the original capture time.");
  }
  if (loop.currentRevision !== input.expectedLoopRevision) {
    throw new LoopError("loop_revision_conflict", "The Loop changed; reread it before importing the capture packet.");
  }
  const revisionRows = await db.select().from(interviewLoopRevisions).where(and(
    eq(interviewLoopRevisions.ownerId, ownerId),
    eq(interviewLoopRevisions.loopId, input.loopId),
    eq(interviewLoopRevisions.revision, input.expectedLoopRevision),
  )).limit(1);
  const currentSnapshot = loopSnapshotSchema.parse(revisionRows[0]?.snapshot);
  const packet = loopCapturePacketSnapshotSchema.parse(packetRow.privateSnapshot) as LoopCapturePacketSnapshot;
  if (packet.company !== currentSnapshot.company || packet.roleTitle !== currentSnapshot.roleTitle) {
    throw new LoopError("loop_capture_identity_mismatch", "The capture packet must describe the same company and role as its Loop.");
  }
  if (currentSnapshot.stages.some((stage) => stage.stageId === packet.stage.stageId)) {
    throw new LoopError("loop_capture_stage_conflict", "That Loop already contains the captured stage identity.");
  }
  const revisedSnapshot = loopSnapshotSchema.parse({
    ...currentSnapshot,
    stages: [...currentSnapshot.stages, packet.stage],
  });
  const revision = input.expectedLoopRevision + 1;
  const receipt = {
    status: "imported" as const,
    packetId: input.packetId,
    capturedAt: packetRow.capturedAt,
    backfilledAt: input.backfilledAt,
    loopId: input.loopId,
    loopRevision: revision,
  };
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${interviewLoops}
        WHERE ${interviewLoops.ownerId} = ${ownerId}
          AND ${interviewLoops.loopId} = ${input.loopId}
          AND ${interviewLoops.currentRevision} = ${input.expectedLoopRevision}
      ) AND EXISTS (
        SELECT 1 FROM ${loopCapturePackets}
        WHERE ${loopCapturePackets.ownerId} = ${ownerId}
          AND ${loopCapturePackets.packetId} = ${input.packetId}
          AND ${loopCapturePackets.status} = 'captured'
      )`),
      db.insert(interviewLoopRevisions).values({
        ownerId,
        loopId: input.loopId,
        revision,
        operationId: input.operationId,
        requestFingerprint,
        snapshot: revisedSnapshot,
        createdAt: nowMs,
      }),
      db.update(interviewLoops).set({ currentRevision: revision, updatedAt: nowMs }).where(and(
        eq(interviewLoops.ownerId, ownerId),
        eq(interviewLoops.loopId, input.loopId),
        eq(interviewLoops.currentRevision, input.expectedLoopRevision),
      )),
      db.update(loopCapturePackets).set({
        status: "imported",
        backfilledAt: input.backfilledAt,
        loopId: input.loopId,
        updatedAt: nowMs,
      }).where(and(
        eq(loopCapturePackets.ownerId, ownerId),
        eq(loopCapturePackets.packetId, input.packetId),
        eq(loopCapturePackets.status, "captured"),
      )),
      db.insert(interviewLoopOperations).values({
        ownerId,
        operationId: input.operationId,
        loopId: input.loopId,
        action: "revise",
        requestFingerprint,
        loopRevision: revision,
        roleBriefRevision: loop.currentRoleBriefRevision,
        receipt,
        createdAt: nowMs,
      }),
      db.insert(loopCapturePacketOperations).values({
        ownerId,
        operationId: input.operationId,
        packetId: input.packetId,
        action: "import",
        requestFingerprint,
        receipt,
        createdAt: nowMs,
      }),
    ]);
  } catch {
    const raced = await replayCaptureOperation(ownerId, input.operationId, requestFingerprint);
    if (raced) return raced;
    throw new LoopError("loop_capture_import_conflict", "The Loop or capture packet changed; reread before retrying.");
  }
  return { ...receipt, duplicate: false };
}
