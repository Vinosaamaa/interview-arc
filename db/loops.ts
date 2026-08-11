import { and, desc, eq, sql } from "drizzle-orm";

import { d1TransactionalInvariantGuard } from "./d1-transactional-guard";
import { getDb } from "./index";
import {
  interviewLoopOperations,
  interviewLoopRevisions,
  interviewLoops,
  loopRoleBriefRevisions,
} from "./schema";
import {
  createLoopSchema,
  loopRoleBriefDisplaySnapshotSchema,
  loopSnapshotSchema,
  queryLoopsSchema,
  reviseLoopRoleBriefSchema,
  reviseLoopSchema,
  type CreateLoopInput,
  type DisplaySafeLoopRoleBriefRevision,
  type LoopRoleBriefDisplaySnapshot,
  type LoopRoleBriefInput,
  type LoopSnapshot,
  type ReviseLoopInput,
  type ReviseLoopRoleBriefInput,
} from "./loop-policy";

export {
  createLoopSchema,
  queryLoopsSchema,
  reviseLoopRoleBriefSchema,
  reviseLoopSchema,
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
  const [loopRows, roleBriefRows] = await Promise.all([
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
  ]);
  if (!loopRows[0] || !roleBriefRows[0]) return null;
  return {
    loop: displayLoop(loopRows[0]),
    roleBrief: displaySafeRoleBrief(roleBriefRows[0]),
    current: {
      loopRevision: current.currentRevision,
      roleBriefRevision: current.currentRoleBriefRevision,
    },
  };
}

export async function queryLoops(ownerId: string, inputValue: unknown) {
  const input = queryLoopsSchema.parse(inputValue);
  if (input.loopId) {
    const projection = await readLoopProjection(ownerId, {
      loopId: input.loopId,
      loopRevision: input.loopRevision,
      roleBriefRevision: input.roleBriefRevision,
      includeArchived: input.includeArchived,
    });
    return { loops: projection ? [projection] : [], truncated: false };
  }
  const rows = await getDb().select({ loopId: interviewLoops.loopId }).from(interviewLoops).where(and(
    eq(interviewLoops.ownerId, ownerId),
    input.includeArchived ? undefined : eq(interviewLoops.state, "active"),
  )).orderBy(desc(interviewLoops.updatedAt), desc(interviewLoops.loopId)).limit(51);
  const projections = await Promise.all(rows.slice(0, 50).map((row) => readLoopProjection(ownerId, {
    loopId: row.loopId,
    includeArchived: input.includeArchived,
  })));
  return { loops: projections.filter((projection) => projection !== null), truncated: rows.length > 50 };
}
