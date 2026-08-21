import { and, desc, eq, sql } from "drizzle-orm";

import { d1TransactionalInvariantGuard } from "./d1-transactional-guard";
import { getDb } from "./index";
import {
  interviewLoopRevisions,
  interviewLoops,
  loopActivityBindings,
  loopInterviewMaterialOperations,
  loopInterviewMaterialRevisions,
  loopInterviewMaterials,
  loopRoleBriefRevisions,
} from "./schema";
import {
  createLoopInterviewMaterialSchema,
  loopInterviewMaterialSnapshotSchema,
  loopRoleBriefInputSchema,
  loopSnapshotSchema,
  queryLoopInterviewMaterialsSchema,
  reviseLoopInterviewMaterialSchema,
  websiteCreateLoopInterviewMaterialSchema,
  websiteReviseLoopInterviewMaterialSchema,
  type CreateLoopInterviewMaterialInput,
  type LoopInterviewMaterialSnapshot,
  type ReviseLoopInterviewMaterialInput,
  type WebsiteCreateLoopInterviewMaterialInput,
  type WebsiteReviseLoopInterviewMaterialInput,
} from "./loop-policy";

export {
  createLoopInterviewMaterialSchema,
  queryLoopInterviewMaterialsSchema,
  reviseLoopInterviewMaterialSchema,
  websiteCreateLoopInterviewMaterialSchema,
  websiteReviseLoopInterviewMaterialSchema,
} from "./loop-policy";

export class LoopMaterialError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "LoopMaterialError";
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

const requestFingerprint = (input: unknown) => sha256(JSON.stringify(input));
const bindingKey = (stageId?: string) => stageId ? `stage:${stageId}` : "loop";
const normalizedProse = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

function assertMaterialIsSynthesis(material: LoopInterviewMaterialSnapshot, rawJobDescription: string) {
  const source = normalizedProse(rawJobDescription);
  const candidateFragments = material.sections.flatMap((section) => [
    ...(section.body ? [section.body] : []),
    ...section.bullets,
  ]).map(normalizedProse);
  if (candidateFragments.some((fragment) => fragment.length >= 240 && source.includes(fragment))) {
    throw new LoopMaterialError(
      "loop_material_raw_jd_copy",
      "Interview material must synthesize the source instead of copying a long raw job-description passage.",
    );
  }
}

function displayMaterial(row: {
  revision: number;
  snapshot: unknown;
  revisionCreatedAt: number;
  recordCreatedAt: number;
  updatedAt: number;
}) {
  return {
    ...loopInterviewMaterialSnapshotSchema.parse(row.snapshot),
    revision: row.revision,
    createdAt: row.recordCreatedAt,
    revisionCreatedAt: row.revisionCreatedAt,
    updatedAt: row.updatedAt,
  };
}

async function replayMaterialOperation(ownerId: string, operationId: string, fingerprint: string) {
  const rows = await getDb().select().from(loopInterviewMaterialOperations).where(and(
    eq(loopInterviewMaterialOperations.ownerId, ownerId),
    eq(loopInterviewMaterialOperations.operationId, operationId),
  )).limit(1);
  const operation = rows[0];
  if (!operation) return null;
  if (operation.requestFingerprint !== fingerprint) {
    throw new LoopMaterialError(
      "loop_material_operation_conflict",
      "This interview-material operation ID already belongs to a different request.",
    );
  }
  return { ...(operation.receipt as object), duplicate: true };
}

async function validateMaterialContext(
  ownerId: string,
  input: {
    expectedLoopRevision: number;
    expectedRoleBriefRevision: number;
    material: LoopInterviewMaterialSnapshot;
  },
) {
  const db = getDb();
  const [currentRows, loopRevisionRows, roleBriefRows] = await Promise.all([
    db.select().from(interviewLoops).where(and(
      eq(interviewLoops.ownerId, ownerId),
      eq(interviewLoops.loopId, input.material.loopId),
    )).limit(1),
    db.select().from(interviewLoopRevisions).where(and(
      eq(interviewLoopRevisions.ownerId, ownerId),
      eq(interviewLoopRevisions.loopId, input.material.loopId),
      eq(interviewLoopRevisions.revision, input.expectedLoopRevision),
    )).limit(1),
    db.select().from(loopRoleBriefRevisions).where(and(
      eq(loopRoleBriefRevisions.ownerId, ownerId),
      eq(loopRoleBriefRevisions.loopId, input.material.loopId),
      eq(loopRoleBriefRevisions.revision, input.expectedRoleBriefRevision),
    )).limit(1),
  ]);
  const current = currentRows[0];
  if (!current || current.state === "archived") {
    throw new LoopMaterialError("loop_material_loop_not_found", "That active owner-private Loop is unavailable.");
  }
  if (current.currentRevision !== input.expectedLoopRevision
    || current.currentRoleBriefRevision !== input.expectedRoleBriefRevision
    || !loopRevisionRows[0]
    || !roleBriefRows[0]) {
    throw new LoopMaterialError(
      "loop_material_context_conflict",
      "The Loop or Role Brief changed; reread both before writing interview material.",
    );
  }
  const loop = loopSnapshotSchema.parse(loopRevisionRows[0].snapshot);
  const roleBrief = loopRoleBriefInputSchema.parse(roleBriefRows[0].privateSnapshot);
  assertMaterialIsSynthesis(input.material, "jdText" in roleBrief.source ? roleBrief.source.jdText : "");
  if (input.material.stageId) {
    const stage = loop.stages.find((candidate) => candidate.stageId === input.material.stageId);
    if (!stage) {
      throw new LoopMaterialError("loop_material_stage_not_found", "That Round is not present in the current Loop revision.");
    }
    if (stage.status !== "scheduled" && stage.status !== "completed") {
      throw new LoopMaterialError(
        "loop_material_stage_not_confirmed",
        "Round interview material requires an explicitly scheduled or completed Round.",
      );
    }
  }
  const sourceBindings = await Promise.all(input.material.provenance.activityIds.map((activityId) => (
    db.select({
      loopId: loopActivityBindings.loopId,
      stageId: loopActivityBindings.stageId,
    }).from(loopActivityBindings).where(and(
      eq(loopActivityBindings.ownerId, ownerId),
      eq(loopActivityBindings.activityId, activityId),
    )).limit(1)
  )));
  sourceBindings.forEach((rows) => {
    const binding = rows[0];
    if (!binding || binding.loopId !== input.material.loopId
      || (input.material.stageId && binding.stageId !== input.material.stageId)) {
      throw new LoopMaterialError(
        "loop_material_activity_source_conflict",
        "Every activity provenance reference must belong to this exact Loop and Round.",
      );
    }
  });
}

async function createLoopInterviewMaterialCommand(
  ownerId: string,
  input: CreateLoopInterviewMaterialInput | WebsiteCreateLoopInterviewMaterialInput,
  nowMs = Date.now(),
) {
  const fingerprint = await requestFingerprint(input);
  const replay = await replayMaterialOperation(ownerId, input.operationId, fingerprint);
  if (replay) return replay;
  await validateMaterialContext(ownerId, input);
  const db = getDb();
  const scopeKey = bindingKey(input.material.stageId);
  const receipt = {
    status: "created" as const,
    materialId: input.material.materialId,
    loopId: input.material.loopId,
    stageId: input.material.stageId ?? null,
    materialRevision: 1,
  };
  const absent = sql`NOT EXISTS (
    SELECT 1 FROM ${loopInterviewMaterials}
    WHERE ${loopInterviewMaterials.ownerId} = ${ownerId}
      AND (${loopInterviewMaterials.materialId} = ${input.material.materialId}
        OR (${loopInterviewMaterials.loopId} = ${input.material.loopId}
          AND ${loopInterviewMaterials.bindingKey} = ${scopeKey}
          AND ${loopInterviewMaterials.kind} = ${input.material.kind}))
  ) AND EXISTS (
    SELECT 1 FROM ${interviewLoops}
    WHERE ${interviewLoops.ownerId} = ${ownerId}
      AND ${interviewLoops.loopId} = ${input.material.loopId}
      AND ${interviewLoops.currentRevision} = ${input.expectedLoopRevision}
      AND ${interviewLoops.currentRoleBriefRevision} = ${input.expectedRoleBriefRevision}
      AND ${interviewLoops.state} = 'active'
  )`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, absent),
      db.insert(loopInterviewMaterialRevisions).values({
        ownerId,
        materialId: input.material.materialId,
        revision: 1,
        operationId: input.operationId,
        requestFingerprint: fingerprint,
        snapshot: input.material,
        createdAt: nowMs,
      }),
      db.insert(loopInterviewMaterials).values({
        ownerId,
        materialId: input.material.materialId,
        loopId: input.material.loopId,
        stageId: input.material.stageId ?? null,
        bindingKey: scopeKey,
        kind: input.material.kind,
        currentRevision: 1,
        state: input.material.state,
        label: input.material.label,
        createdAt: nowMs,
        updatedAt: nowMs,
      }),
      db.insert(loopInterviewMaterialOperations).values({
        ownerId,
        operationId: input.operationId,
        materialId: input.material.materialId,
        action: "create",
        requestFingerprint: fingerprint,
        materialRevision: 1,
        receipt,
        createdAt: nowMs,
      }),
    ]);
  } catch {
    const racedReplay = await replayMaterialOperation(ownerId, input.operationId, fingerprint);
    if (racedReplay) return racedReplay;
    const existing = await db.select({
      materialId: loopInterviewMaterials.materialId,
      bindingKey: loopInterviewMaterials.bindingKey,
    }).from(loopInterviewMaterials).where(and(
      eq(loopInterviewMaterials.ownerId, ownerId),
      eq(loopInterviewMaterials.loopId, input.material.loopId),
    ));
    if (existing.some((row) => row.materialId === input.material.materialId)) {
      throw new LoopMaterialError("loop_material_already_exists", "That interview material already exists; revise it instead.");
    }
    if (existing.some((row) => row.bindingKey === scopeKey)) {
      throw new LoopMaterialError(
        "loop_material_scope_conflict",
        "This Loop or Round already has interview prep material; revise the existing record instead of duplicating it.",
      );
    }
    throw new LoopMaterialError(
      "loop_material_create_conflict",
      "The Loop or material changed while saving; reread both before retrying.",
    );
  }
  return { ...receipt, duplicate: false };
}

export function createLoopInterviewMaterial(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  return createLoopInterviewMaterialCommand(
    ownerId,
    createLoopInterviewMaterialSchema.parse(inputValue) as CreateLoopInterviewMaterialInput,
    nowMs,
  );
}

export function createLoopInterviewMaterialFromWebsite(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  return createLoopInterviewMaterialCommand(
    ownerId,
    websiteCreateLoopInterviewMaterialSchema.parse(inputValue) as WebsiteCreateLoopInterviewMaterialInput,
    nowMs,
  );
}

async function reviseLoopInterviewMaterialCommand(
  ownerId: string,
  input: ReviseLoopInterviewMaterialInput | WebsiteReviseLoopInterviewMaterialInput,
  nowMs = Date.now(),
) {
  const fingerprint = await requestFingerprint(input);
  const replay = await replayMaterialOperation(ownerId, input.operationId, fingerprint);
  if (replay) return replay;
  const db = getDb();
  const currentRows = await db.select().from(loopInterviewMaterials).where(and(
    eq(loopInterviewMaterials.ownerId, ownerId),
    eq(loopInterviewMaterials.materialId, input.materialId),
  )).limit(1);
  const current = currentRows[0];
  if (!current) throw new LoopMaterialError("loop_material_not_found", "That owner-private interview material is unavailable.");
  if (current.currentRevision !== input.expectedRevision) {
    throw new LoopMaterialError("loop_material_revision_conflict", "The interview material changed; reread it before retrying.");
  }
  if (current.loopId !== input.material.loopId
    || current.stageId !== (input.material.stageId ?? null)
    || current.kind !== input.material.kind) {
    throw new LoopMaterialError(
      "loop_material_identity_immutable",
      "Interview material keeps one Loop, Round, and kind identity across revisions.",
    );
  }
  await validateMaterialContext(ownerId, input);
  const revision = input.expectedRevision + 1;
  const receipt = {
    status: "revised" as const,
    materialId: input.materialId,
    loopId: input.material.loopId,
    stageId: input.material.stageId ?? null,
    materialRevision: revision,
  };
  const unchanged = sql`EXISTS (
    SELECT 1 FROM ${loopInterviewMaterials}
    WHERE ${loopInterviewMaterials.ownerId} = ${ownerId}
      AND ${loopInterviewMaterials.materialId} = ${input.materialId}
      AND ${loopInterviewMaterials.currentRevision} = ${input.expectedRevision}
  ) AND EXISTS (
    SELECT 1 FROM ${interviewLoops}
    WHERE ${interviewLoops.ownerId} = ${ownerId}
      AND ${interviewLoops.loopId} = ${input.material.loopId}
      AND ${interviewLoops.currentRevision} = ${input.expectedLoopRevision}
      AND ${interviewLoops.currentRoleBriefRevision} = ${input.expectedRoleBriefRevision}
      AND ${interviewLoops.state} = 'active'
  )`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, unchanged),
      db.insert(loopInterviewMaterialRevisions).values({
        ownerId,
        materialId: input.materialId,
        revision,
        operationId: input.operationId,
        requestFingerprint: fingerprint,
        snapshot: input.material,
        createdAt: nowMs,
      }),
      db.update(loopInterviewMaterials).set({
        currentRevision: revision,
        state: input.material.state,
        label: input.material.label,
        updatedAt: nowMs,
      }).where(and(
        eq(loopInterviewMaterials.ownerId, ownerId),
        eq(loopInterviewMaterials.materialId, input.materialId),
        eq(loopInterviewMaterials.currentRevision, input.expectedRevision),
      )),
      db.insert(loopInterviewMaterialOperations).values({
        ownerId,
        operationId: input.operationId,
        materialId: input.materialId,
        action: "revise",
        requestFingerprint: fingerprint,
        materialRevision: revision,
        receipt,
        createdAt: nowMs,
      }),
    ]);
  } catch {
    const racedReplay = await replayMaterialOperation(ownerId, input.operationId, fingerprint);
    if (racedReplay) return racedReplay;
    const raced = await db.select({ revision: loopInterviewMaterials.currentRevision }).from(loopInterviewMaterials).where(and(
      eq(loopInterviewMaterials.ownerId, ownerId),
      eq(loopInterviewMaterials.materialId, input.materialId),
    )).limit(1);
    if (!raced[0]) throw new LoopMaterialError("loop_material_not_found", "That owner-private interview material is unavailable.");
    if (raced[0].revision !== input.expectedRevision) {
      throw new LoopMaterialError("loop_material_revision_conflict", "The interview material changed; reread it before retrying.");
    }
    throw new LoopMaterialError(
      "loop_material_revise_conflict",
      "The Loop or material changed while saving; reread both before retrying.",
    );
  }
  return { ...receipt, duplicate: false };
}

export function reviseLoopInterviewMaterial(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  return reviseLoopInterviewMaterialCommand(
    ownerId,
    reviseLoopInterviewMaterialSchema.parse(inputValue) as ReviseLoopInterviewMaterialInput,
    nowMs,
  );
}

export function reviseLoopInterviewMaterialFromWebsite(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  return reviseLoopInterviewMaterialCommand(
    ownerId,
    websiteReviseLoopInterviewMaterialSchema.parse(inputValue) as WebsiteReviseLoopInterviewMaterialInput,
    nowMs,
  );
}

const materialSelection = {
  materialId: loopInterviewMaterials.materialId,
  loopId: loopInterviewMaterials.loopId,
  stageId: loopInterviewMaterials.stageId,
  kind: loopInterviewMaterials.kind,
  state: loopInterviewMaterials.state,
  revision: loopInterviewMaterialRevisions.revision,
  snapshot: loopInterviewMaterialRevisions.snapshot,
  revisionCreatedAt: loopInterviewMaterialRevisions.createdAt,
  recordCreatedAt: loopInterviewMaterials.createdAt,
  updatedAt: loopInterviewMaterials.updatedAt,
};

export async function queryLoopInterviewMaterials(ownerId: string, inputValue: unknown) {
  const input = queryLoopInterviewMaterialsSchema.parse(inputValue);
  const db = getDb();
  const rows = await db.select(materialSelection).from(loopInterviewMaterials).innerJoin(
    loopInterviewMaterialRevisions,
    and(
      eq(loopInterviewMaterialRevisions.ownerId, loopInterviewMaterials.ownerId),
      eq(loopInterviewMaterialRevisions.materialId, loopInterviewMaterials.materialId),
      input.revision
        ? eq(loopInterviewMaterialRevisions.revision, input.revision)
        : eq(loopInterviewMaterialRevisions.revision, loopInterviewMaterials.currentRevision),
    ),
  ).innerJoin(
    interviewLoops,
    and(
      eq(interviewLoops.ownerId, loopInterviewMaterials.ownerId),
      eq(interviewLoops.loopId, loopInterviewMaterials.loopId),
    ),
  ).where(and(
    eq(loopInterviewMaterials.ownerId, ownerId),
    input.materialId ? eq(loopInterviewMaterials.materialId, input.materialId) : undefined,
    input.loopId ? eq(loopInterviewMaterials.loopId, input.loopId) : undefined,
    input.stageId ? eq(loopInterviewMaterials.stageId, input.stageId) : undefined,
    input.includeArchived ? undefined : eq(loopInterviewMaterials.state, "active"),
    input.includeArchived ? undefined : eq(interviewLoops.state, "active"),
  )).orderBy(desc(loopInterviewMaterials.updatedAt), desc(loopInterviewMaterials.materialId)).limit(101);
  return {
    materials: rows.slice(0, 100).map(displayMaterial),
    truncated: rows.length > 100,
  };
}

export async function queryCurrentLoopMaterialsForProjection(
  ownerId: string,
  loopId: string,
  includeArchived = false,
) {
  return (await queryLoopInterviewMaterials(ownerId, { loopId, includeArchived })).materials;
}
