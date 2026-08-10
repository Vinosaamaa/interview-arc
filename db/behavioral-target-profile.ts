import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { d1TransactionalInvariantGuard } from "./d1-transactional-guard";
import { getDb } from "./index";
import {
  behavioralTargetBindingMutations,
  behavioralTargetBindings,
  behavioralTargetProfileOperations,
  behavioralTargetProfileRevisions,
  behavioralTargetProfiles,
  extraActivities,
  liveSessions,
} from "./schema";

const stableIdSchema = z.string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use a lowercase stable ID.");
const boundedText = (max: number) => z.string().trim().min(1).max(max);
const boundedList = (items: number, length: number) => z.array(boundedText(length)).max(items);

const verifiedCompanySignalSchema = z.object({
  signal: boundedText(500),
  sourceLabel: boundedText(240),
  verifiedAt: z.number().int().positive(),
}).strict();

export const behavioralTargetProfileInputSchema = z.object({
  targetId: stableIdSchema,
  label: boundedText(240),
  state: z.enum(["active", "archived"]),
  company: boundedText(240),
  roleTitle: boundedText(240),
  targetLevel: boundedText(120).optional(),
  location: boundedText(240).optional(),
  team: boundedText(240).optional(),
  source: z.object({
    kind: z.literal("pasted_jd"),
    displayLocator: boundedText(240),
    capturedAt: z.number().int().positive(),
    jdText: boundedText(100_000),
  }).strict(),
  responsibilities: boundedList(100, 1_000),
  requiredQualifications: boundedList(100, 1_000),
  preferredQualifications: boundedList(100, 1_000),
  competencySignals: boundedList(100, 500),
  seniorityIndicators: boundedList(100, 500),
  domainVocabulary: boundedList(100, 200),
  verifiedCompanySignals: z.array(verifiedCompanySignalSchema).max(50),
  unresolvedAmbiguities: boundedList(100, 1_000),
  ownerNotes: boundedList(100, 1_000),
}).strict();

export const behavioralTargetProfileWriteSchema = z.object({
  operationId: stableIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  target: behavioralTargetProfileInputSchema,
}).strict();

export const behavioralTargetBindingWriteSchema = z.object({
  mutationId: stableIdSchema,
  scope: z.object({
    type: z.enum(["session", "activity"]),
    id: stableIdSchema,
  }).strict(),
  action: z.enum(["set", "clear"]),
  targetId: stableIdSchema.optional(),
  targetRevision: z.number().int().positive().optional(),
  expectedRevision: z.number().int().nonnegative(),
  authorization: z.literal("explicit_user_instruction"),
}).strict().superRefine((input, context) => {
  if (input.action === "set" && (!input.targetId || !input.targetRevision)) {
    context.addIssue({ code: "custom", path: ["targetId"], message: "Set requires an exact target revision." });
  }
  if (input.action === "clear" && (input.targetId || input.targetRevision)) {
    context.addIssue({ code: "custom", path: ["targetId"], message: "Clear must not include target identity." });
  }
});

export type BehavioralTargetProfileInput = z.infer<typeof behavioralTargetProfileInputSchema>;
export type BehavioralTargetProfileWrite = z.infer<typeof behavioralTargetProfileWriteSchema>;
export type BehavioralTargetBindingWrite = z.infer<typeof behavioralTargetBindingWriteSchema>;

const behavioralTargetProfileDisplaySnapshotSchema = behavioralTargetProfileInputSchema
  .omit({ source: true })
  .extend({
    source: behavioralTargetProfileInputSchema.shape.source.omit({ jdText: true }),
  });

type BehavioralTargetProfileDisplaySnapshot = z.infer<typeof behavioralTargetProfileDisplaySnapshotSchema>;

export type DisplaySafeBehavioralTargetRevision = Omit<BehavioralTargetProfileDisplaySnapshot, "source"> & {
  revision: number;
  source: {
    kind: "pasted_jd";
    displayLocator: string;
    capturedAt: number;
    fingerprint: string;
  };
  createdAt: number;
};

export class BehavioralTargetProfileError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "BehavioralTargetProfileError";
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

async function requestFingerprint(input: BehavioralTargetProfileWrite) {
  return sha256(JSON.stringify(input));
}

function displaySafeRevision(row: {
  revision: number;
  sourceFingerprint: string;
  displaySnapshot: unknown;
  createdAt: number;
}): DisplaySafeBehavioralTargetRevision {
  const snapshot = behavioralTargetProfileDisplaySnapshotSchema.parse(row.displaySnapshot);
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

function displaySnapshot(target: BehavioralTargetProfileInput): BehavioralTargetProfileDisplaySnapshot {
  return {
    ...target,
    source: {
      kind: target.source.kind,
      displayLocator: target.source.displayLocator,
      capturedAt: target.source.capturedAt,
    },
  };
}

export async function upsertBehavioralTargetProfile(
  ownerId: string,
  inputValue: BehavioralTargetProfileWrite,
  nowMs = Date.now(),
) {
  const input = behavioralTargetProfileWriteSchema.parse(inputValue);
  const db = getDb();
  const fingerprint = await requestFingerprint(input);
  const sourceFingerprint = await sha256(input.target.source.jdText.trim());

  const operationRows = await db.select().from(behavioralTargetProfileOperations).where(and(
    eq(behavioralTargetProfileOperations.ownerId, ownerId),
    eq(behavioralTargetProfileOperations.operationId, input.operationId),
  ));
  const operation = operationRows[0];
  if (operation) {
    if (operation.requestFingerprint !== fingerprint) {
      throw new BehavioralTargetProfileError(
        "behavioral_target_operation_conflict",
        "This Target Profile operation ID already belongs to a different request.",
      );
    }
    return { ...(operation.receipt as object), duplicate: true };
  }

  const currentRows = await db.select().from(behavioralTargetProfiles).where(and(
    eq(behavioralTargetProfiles.ownerId, ownerId),
    eq(behavioralTargetProfiles.targetId, input.target.targetId),
  ));
  const current = currentRows[0];
  const currentRevision = current?.currentRevision ?? 0;
  if (input.expectedRevision !== currentRevision) {
    throw new BehavioralTargetProfileError(
      "behavioral_target_revision_conflict",
      "The Target Profile revision changed; reread it before retrying.",
    );
  }
  const currentRevisionRows = current
    ? await db.select({ privateSnapshot: behavioralTargetProfileRevisions.privateSnapshot })
      .from(behavioralTargetProfileRevisions).where(and(
        eq(behavioralTargetProfileRevisions.ownerId, ownerId),
        eq(behavioralTargetProfileRevisions.targetId, input.target.targetId),
        eq(behavioralTargetProfileRevisions.revision, currentRevision),
      )).limit(1)
    : [];
  const currentSnapshot = currentRevisionRows[0]
    ? behavioralTargetProfileInputSchema.parse(currentRevisionRows[0].privateSnapshot)
    : null;
  const unchanged = currentSnapshot
    ? JSON.stringify(currentSnapshot) === JSON.stringify(input.target)
    : false;
  const revisionCondition = current
    ? sql`EXISTS (
        SELECT 1 FROM ${behavioralTargetProfiles}
        WHERE ${behavioralTargetProfiles.ownerId} = ${ownerId}
          AND ${behavioralTargetProfiles.targetId} = ${input.target.targetId}
          AND ${behavioralTargetProfiles.currentRevision} = ${currentRevision}
      )`
    : sql`NOT EXISTS (
        SELECT 1 FROM ${behavioralTargetProfiles}
        WHERE ${behavioralTargetProfiles.ownerId} = ${ownerId}
          AND ${behavioralTargetProfiles.targetId} = ${input.target.targetId}
      )`;
  if (unchanged) {
    const receipt = {
      status: "unchanged" as const,
      targetId: input.target.targetId,
      revision: currentRevision,
    };
    try {
      await db.batch([
        d1TransactionalInvariantGuard(db, revisionCondition),
        db.insert(behavioralTargetProfileOperations).values({
          ownerId,
          operationId: input.operationId,
          targetId: input.target.targetId,
          requestFingerprint: fingerprint,
          targetRevision: currentRevision,
          status: receipt.status,
          receipt,
          createdAt: nowMs,
        }),
      ]);
    } catch {
      const racedRows = await db.select().from(behavioralTargetProfileOperations).where(and(
        eq(behavioralTargetProfileOperations.ownerId, ownerId),
        eq(behavioralTargetProfileOperations.operationId, input.operationId),
      )).limit(1);
      const raced = racedRows[0];
      if (raced) {
        if (raced.requestFingerprint !== fingerprint) {
          throw new BehavioralTargetProfileError(
            "behavioral_target_operation_conflict",
            "This Target Profile operation ID already belongs to a different request.",
          );
        }
        return { ...(raced.receipt as object), duplicate: true };
      }
      throw new BehavioralTargetProfileError(
        "behavioral_target_revision_conflict",
        "The Target Profile revision changed; reread it before retrying.",
      );
    }
    return { ...receipt, duplicate: false };
  }
  const revision = currentRevision + 1;
  const status = current ? "revised" as const : "created" as const;
  const receipt = { status, targetId: input.target.targetId, revision };
  const revisionInsert = db.insert(behavioralTargetProfileRevisions).values({
    ownerId,
    targetId: input.target.targetId,
    revision,
    operationId: input.operationId,
    requestFingerprint: fingerprint,
    sourceFingerprint,
    displaySnapshot: displaySnapshot(input.target),
    privateSnapshot: input.target,
    createdAt: nowMs,
  });
  const profileWrite = current
    ? db.update(behavioralTargetProfiles).set({
      currentRevision: revision,
      state: input.target.state,
      label: input.target.label,
      updatedAt: nowMs,
    }).where(and(
      eq(behavioralTargetProfiles.ownerId, ownerId),
      eq(behavioralTargetProfiles.targetId, input.target.targetId),
      eq(behavioralTargetProfiles.currentRevision, currentRevision),
    ))
    : db.insert(behavioralTargetProfiles).values({
      ownerId,
      targetId: input.target.targetId,
      currentRevision: revision,
      state: input.target.state,
      label: input.target.label,
      createdAt: nowMs,
      updatedAt: nowMs,
    });
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, revisionCondition),
      revisionInsert,
      profileWrite,
      db.insert(behavioralTargetProfileOperations).values({
        ownerId,
        operationId: input.operationId,
        targetId: input.target.targetId,
        requestFingerprint: fingerprint,
        targetRevision: revision,
        status,
        receipt,
        createdAt: nowMs,
      }),
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${behavioralTargetProfiles}
        WHERE ${behavioralTargetProfiles.ownerId} = ${ownerId}
          AND ${behavioralTargetProfiles.targetId} = ${input.target.targetId}
          AND ${behavioralTargetProfiles.currentRevision} = ${revision}
      )`),
    ]);
  } catch (error) {
    const racedOperationRows = await db.select().from(behavioralTargetProfileOperations).where(and(
      eq(behavioralTargetProfileOperations.ownerId, ownerId),
      eq(behavioralTargetProfileOperations.operationId, input.operationId),
    ));
    const racedOperation = racedOperationRows[0];
    if (racedOperation) {
      if (racedOperation.requestFingerprint !== fingerprint) {
        throw new BehavioralTargetProfileError(
          "behavioral_target_operation_conflict",
          "This Target Profile operation ID already belongs to a different request.",
        );
      }
      return { ...(racedOperation.receipt as object), duplicate: true };
    }
    const racedTargetRows = await db.select({
      currentRevision: behavioralTargetProfiles.currentRevision,
    }).from(behavioralTargetProfiles).where(and(
      eq(behavioralTargetProfiles.ownerId, ownerId),
      eq(behavioralTargetProfiles.targetId, input.target.targetId),
    ));
    if ((racedTargetRows[0]?.currentRevision ?? 0) !== currentRevision) {
      throw new BehavioralTargetProfileError(
        "behavioral_target_revision_conflict",
        "The Target Profile revision changed; reread it before retrying.",
      );
    }
    throw error;
  }
  return { ...receipt, duplicate: false };
}

export async function queryBehavioralTargetProfiles(ownerId: string, input: {
  targetId?: string;
  revision?: number;
  includeArchived?: boolean;
}) {
  const parsed = z.object({
    targetId: stableIdSchema.optional(),
    revision: z.number().int().positive().optional(),
    includeArchived: z.boolean().optional(),
  }).strict().refine((value) => !value.revision || Boolean(value.targetId), {
    message: "A historical revision requires targetId.",
  }).parse(input);
  const db = getDb();
  if (parsed.targetId) {
    const profileRows = await db.select().from(behavioralTargetProfiles).where(and(
      eq(behavioralTargetProfiles.ownerId, ownerId),
      eq(behavioralTargetProfiles.targetId, parsed.targetId),
    ));
    const profile = profileRows[0];
    if (!profile || (!parsed.includeArchived && profile.state === "archived")) {
      return { targets: [], truncated: false };
    }
    const revisionRows = await db.select().from(behavioralTargetProfileRevisions).where(and(
      eq(behavioralTargetProfileRevisions.ownerId, ownerId),
      eq(behavioralTargetProfileRevisions.targetId, parsed.targetId),
      eq(behavioralTargetProfileRevisions.revision, parsed.revision ?? profile.currentRevision),
    ));
    return {
      targets: revisionRows[0] ? [displaySafeRevision(revisionRows[0])] : [],
      truncated: false,
    };
  }
  const rows = await db.select({
    revision: behavioralTargetProfileRevisions.revision,
    sourceFingerprint: behavioralTargetProfileRevisions.sourceFingerprint,
      displaySnapshot: behavioralTargetProfileRevisions.displaySnapshot,
    createdAt: behavioralTargetProfileRevisions.createdAt,
  }).from(behavioralTargetProfiles).innerJoin(
    behavioralTargetProfileRevisions,
    and(
      eq(behavioralTargetProfileRevisions.ownerId, behavioralTargetProfiles.ownerId),
      eq(behavioralTargetProfileRevisions.targetId, behavioralTargetProfiles.targetId),
      eq(behavioralTargetProfileRevisions.revision, behavioralTargetProfiles.currentRevision),
    ),
  ).where(and(
    eq(behavioralTargetProfiles.ownerId, ownerId),
    parsed.includeArchived ? undefined : eq(behavioralTargetProfiles.state, "active"),
  )).orderBy(desc(behavioralTargetProfiles.updatedAt), desc(behavioralTargetProfiles.targetId)).limit(51);
  return {
    targets: rows.slice(0, 50).map(displaySafeRevision),
    truncated: rows.length > 50,
  };
}

export async function readBehavioralTargetRevision(
  ownerId: string,
  targetId: string,
  revision: number,
) {
  const rows = await getDb().select({
    revision: behavioralTargetProfileRevisions.revision,
    sourceFingerprint: behavioralTargetProfileRevisions.sourceFingerprint,
    displaySnapshot: behavioralTargetProfileRevisions.displaySnapshot,
    createdAt: behavioralTargetProfileRevisions.createdAt,
  }).from(behavioralTargetProfileRevisions).where(and(
    eq(behavioralTargetProfileRevisions.ownerId, ownerId),
    eq(behavioralTargetProfileRevisions.targetId, targetId),
    eq(behavioralTargetProfileRevisions.revision, revision),
  )).limit(1);
  return rows[0] ? displaySafeRevision(rows[0]) : null;
}

async function bindingRequestFingerprint(input: BehavioralTargetBindingWrite) {
  return sha256(JSON.stringify(input));
}

async function assertBindingScopeExists(ownerId: string, input: BehavioralTargetBindingWrite) {
  const db = getDb();
  if (input.scope.type === "session") {
    const rows = await db.select({ id: liveSessions.id }).from(liveSessions).where(and(
      eq(liveSessions.ownerId, ownerId),
      eq(liveSessions.id, input.scope.id),
    )).limit(1);
    if (rows[0]) return;
  } else {
    const rows = await db.select({ payload: extraActivities.payload }).from(extraActivities).where(and(
      eq(extraActivities.ownerId, ownerId),
      eq(extraActivities.id, input.scope.id),
    )).limit(1);
    const payload = rows[0]?.payload as { type?: unknown } | undefined;
    if (payload?.type === "behavioral") return;
  }
  throw new BehavioralTargetProfileError(
    "behavioral_target_scope_not_found",
    "The target binding scope is not an owner-scoped behavioral activity or practice session.",
  );
}

async function readBinding(ownerId: string, scopeType: "session" | "activity", scopeId: string) {
  const rows = await getDb().select().from(behavioralTargetBindings).where(and(
    eq(behavioralTargetBindings.ownerId, ownerId),
    eq(behavioralTargetBindings.scopeType, scopeType),
    eq(behavioralTargetBindings.scopeId, scopeId),
  )).limit(1);
  return rows[0] ?? null;
}

async function assertCurrentTargetRevision(
  ownerId: string,
  targetId: string,
  targetRevision: number,
) {
  const rows = await getDb().select({
    state: behavioralTargetProfiles.state,
    currentRevision: behavioralTargetProfiles.currentRevision,
  }).from(behavioralTargetProfiles).where(and(
    eq(behavioralTargetProfiles.ownerId, ownerId),
    eq(behavioralTargetProfiles.targetId, targetId),
  )).limit(1);
  if (rows[0]?.state !== "active" || rows[0]?.currentRevision !== targetRevision) {
    throw new BehavioralTargetProfileError(
      "behavioral_target_revision_not_found",
      "The exact active owner-private Target Profile revision is unavailable.",
    );
  }
  return rows[0];
}

export async function setBehavioralTargetBinding(
  ownerId: string,
  inputValue: BehavioralTargetBindingWrite,
  nowMs = Date.now(),
) {
  const input = behavioralTargetBindingWriteSchema.parse(inputValue);
  const db = getDb();
  const fingerprint = await bindingRequestFingerprint(input);
  const priorMutationRows = await db.select().from(behavioralTargetBindingMutations).where(and(
    eq(behavioralTargetBindingMutations.ownerId, ownerId),
    eq(behavioralTargetBindingMutations.mutationId, input.mutationId),
  )).limit(1);
  const priorMutation = priorMutationRows[0];
  if (priorMutation) {
    if (priorMutation.requestFingerprint !== fingerprint) {
      throw new BehavioralTargetProfileError(
        "behavioral_target_binding_operation_conflict",
        "This target-binding mutation ID already belongs to a different request.",
      );
    }
    return { ...(priorMutation.receipt as object), duplicate: true };
  }
  await assertBindingScopeExists(ownerId, input);
  if (input.action === "set") {
    await assertCurrentTargetRevision(ownerId, input.targetId!, input.targetRevision!);
  }
  const current = await readBinding(ownerId, input.scope.type, input.scope.id);
  const actualRevision = current?.revision ?? 0;
  if (actualRevision !== input.expectedRevision) {
    throw new BehavioralTargetProfileError(
      "behavioral_target_binding_revision_conflict",
      "The target binding changed; reread it before retrying.",
    );
  }
  const revision = input.expectedRevision + 1;
  const binding = {
    scopeType: input.scope.type,
    scopeId: input.scope.id,
    targetId: input.action === "set" ? input.targetId! : null,
    targetRevision: input.action === "set" ? input.targetRevision! : null,
    revision,
  };
  const receipt = { status: input.action === "set" ? "set" as const : "cleared" as const, binding };
  const revisionCondition = input.expectedRevision === 0
    ? sql`NOT EXISTS (
        SELECT 1 FROM ${behavioralTargetBindings}
        WHERE ${behavioralTargetBindings.ownerId} = ${ownerId}
          AND ${behavioralTargetBindings.scopeType} = ${input.scope.type}
          AND ${behavioralTargetBindings.scopeId} = ${input.scope.id}
      )`
    : sql`EXISTS (
        SELECT 1 FROM ${behavioralTargetBindings}
        WHERE ${behavioralTargetBindings.ownerId} = ${ownerId}
          AND ${behavioralTargetBindings.scopeType} = ${input.scope.type}
          AND ${behavioralTargetBindings.scopeId} = ${input.scope.id}
          AND ${behavioralTargetBindings.revision} = ${input.expectedRevision}
      )`;
  const scopeCondition = input.scope.type === "session"
    ? sql`EXISTS (
        SELECT 1 FROM ${liveSessions}
        WHERE ${liveSessions.ownerId} = ${ownerId}
          AND ${liveSessions.id} = ${input.scope.id}
      )`
    : sql`EXISTS (
        SELECT 1 FROM ${extraActivities}
        WHERE ${extraActivities.ownerId} = ${ownerId}
          AND ${extraActivities.id} = ${input.scope.id}
          AND json_extract(${extraActivities.payload}, '$.type') = 'behavioral'
      )`;
  const writeCondition = input.action === "set"
    ? sql`${revisionCondition} AND ${scopeCondition} AND EXISTS (
        SELECT 1 FROM ${behavioralTargetProfiles}
        WHERE ${behavioralTargetProfiles.ownerId} = ${ownerId}
          AND ${behavioralTargetProfiles.targetId} = ${input.targetId!}
          AND ${behavioralTargetProfiles.currentRevision} = ${input.targetRevision!}
          AND ${behavioralTargetProfiles.state} = 'active'
      )`
    : sql`${revisionCondition} AND ${scopeCondition}`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, writeCondition),
      db.insert(behavioralTargetBindingMutations).values({
        ownerId,
        mutationId: input.mutationId,
        scopeType: input.scope.type,
        scopeId: input.scope.id,
        requestFingerprint: fingerprint,
        receipt,
        createdAt: nowMs,
      }),
      db.insert(behavioralTargetBindings).values({
        ownerId,
        ...binding,
        updatedAt: nowMs,
      }).onConflictDoUpdate({
        target: [behavioralTargetBindings.ownerId, behavioralTargetBindings.scopeType, behavioralTargetBindings.scopeId],
        set: {
          targetId: binding.targetId,
          targetRevision: binding.targetRevision,
          revision,
          updatedAt: nowMs,
        },
        setWhere: eq(behavioralTargetBindings.revision, input.expectedRevision),
      }),
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${behavioralTargetBindings}
        WHERE ${behavioralTargetBindings.ownerId} = ${ownerId}
          AND ${behavioralTargetBindings.scopeType} = ${input.scope.type}
          AND ${behavioralTargetBindings.scopeId} = ${input.scope.id}
          AND ${behavioralTargetBindings.revision} = ${revision}
      )`),
    ]);
  } catch (error) {
    const racedMutationRows = await db.select().from(behavioralTargetBindingMutations).where(and(
      eq(behavioralTargetBindingMutations.ownerId, ownerId),
      eq(behavioralTargetBindingMutations.mutationId, input.mutationId),
    )).limit(1);
    const racedMutation = racedMutationRows[0];
    if (racedMutation) {
      if (racedMutation.requestFingerprint !== fingerprint) {
        throw new BehavioralTargetProfileError(
          "behavioral_target_binding_operation_conflict",
          "This target-binding mutation ID already belongs to a different request.",
        );
      }
      return { ...(racedMutation.receipt as object), duplicate: true };
    }
    const racedBinding = await readBinding(ownerId, input.scope.type, input.scope.id);
    if ((racedBinding?.revision ?? 0) !== input.expectedRevision) {
      throw new BehavioralTargetProfileError(
        "behavioral_target_binding_revision_conflict",
        "The target binding changed; reread it before retrying.",
      );
    }
    if (input.action === "set") {
      await assertCurrentTargetRevision(ownerId, input.targetId!, input.targetRevision!);
    }
    await assertBindingScopeExists(ownerId, input);
    throw error;
  }
  return { ...receipt, duplicate: false };
}

const targetResolutionColumns = {
  bindingOwnerId: behavioralTargetBindings.ownerId,
  bindingScopeType: behavioralTargetBindings.scopeType,
  bindingScopeId: behavioralTargetBindings.scopeId,
  bindingTargetId: behavioralTargetBindings.targetId,
  bindingTargetRevision: behavioralTargetBindings.targetRevision,
  bindingRevision: behavioralTargetBindings.revision,
  bindingUpdatedAt: behavioralTargetBindings.updatedAt,
  targetRevision: behavioralTargetProfileRevisions.revision,
  sourceFingerprint: behavioralTargetProfileRevisions.sourceFingerprint,
  displaySnapshot: behavioralTargetProfileRevisions.displaySnapshot,
  targetCreatedAt: behavioralTargetProfileRevisions.createdAt,
};

type TargetResolutionRow = {
  bindingOwnerId: string | null;
  bindingScopeType: "session" | "activity" | null;
  bindingScopeId: string | null;
  bindingTargetId: string | null;
  bindingTargetRevision: number | null;
  bindingRevision: number | null;
  bindingUpdatedAt: number | null;
  targetRevision: number | null;
  sourceFingerprint: string | null;
  displaySnapshot: unknown;
  targetCreatedAt: number | null;
};

function resolvedBinding(row: TargetResolutionRow, source: "activity" | "session") {
  if (
    !row.bindingOwnerId
    || row.bindingScopeType !== source
    || !row.bindingScopeId
    || !row.bindingTargetId
    || !row.bindingTargetRevision
    || !row.bindingRevision
    || row.targetRevision !== row.bindingTargetRevision
    || !row.sourceFingerprint
    || !row.displaySnapshot
    || row.targetCreatedAt === null
  ) return null;
  return {
    source,
    binding: {
      ownerId: row.bindingOwnerId,
      scopeType: row.bindingScopeType,
      scopeId: row.bindingScopeId,
      targetId: row.bindingTargetId,
      targetRevision: row.bindingTargetRevision,
      revision: row.bindingRevision,
      updatedAt: row.bindingUpdatedAt ?? 0,
    },
    target: displaySafeRevision({
      revision: row.targetRevision,
      sourceFingerprint: row.sourceFingerprint,
      displaySnapshot: row.displaySnapshot,
      createdAt: row.targetCreatedAt,
    }),
  };
}

async function readActivityResolution(ownerId: string, activityId: string) {
  const rows = await getDb().select({
    payload: extraActivities.payload,
    ...targetResolutionColumns,
  }).from(extraActivities).leftJoin(
    behavioralTargetBindings,
    and(
      eq(behavioralTargetBindings.ownerId, extraActivities.ownerId),
      eq(behavioralTargetBindings.scopeType, "activity"),
      eq(behavioralTargetBindings.scopeId, extraActivities.id),
    ),
  ).leftJoin(
    behavioralTargetProfileRevisions,
    and(
      eq(behavioralTargetProfileRevisions.ownerId, behavioralTargetBindings.ownerId),
      eq(behavioralTargetProfileRevisions.targetId, behavioralTargetBindings.targetId),
      eq(behavioralTargetProfileRevisions.revision, behavioralTargetBindings.targetRevision),
    ),
  ).where(and(
    eq(extraActivities.ownerId, ownerId),
    eq(extraActivities.id, activityId),
  )).limit(1);
  const payload = rows[0]?.payload as { type?: unknown; sessionId?: unknown } | undefined;
  if (payload?.type !== "behavioral") {
    throw new BehavioralTargetProfileError(
      "behavioral_target_activity_not_found",
      "The activity is not an owner-scoped behavioral activity.",
    );
  }
  return {
    parentSessionId: typeof payload.sessionId === "string" && payload.sessionId
      ? payload.sessionId
      : null,
    resolved: resolvedBinding(rows[0] as TargetResolutionRow, "activity"),
  };
}

async function readSessionResolution(ownerId: string, sessionId: string) {
  const rows = await getDb().select({
    sessionId: liveSessions.id,
    ...targetResolutionColumns,
  }).from(liveSessions).leftJoin(
    behavioralTargetBindings,
    and(
      eq(behavioralTargetBindings.ownerId, liveSessions.ownerId),
      eq(behavioralTargetBindings.scopeType, "session"),
      eq(behavioralTargetBindings.scopeId, liveSessions.id),
    ),
  ).leftJoin(
    behavioralTargetProfileRevisions,
    and(
      eq(behavioralTargetProfileRevisions.ownerId, behavioralTargetBindings.ownerId),
      eq(behavioralTargetProfileRevisions.targetId, behavioralTargetBindings.targetId),
      eq(behavioralTargetProfileRevisions.revision, behavioralTargetBindings.targetRevision),
    ),
  ).where(and(
    eq(liveSessions.ownerId, ownerId),
    eq(liveSessions.id, sessionId),
  )).limit(1);
  if (!rows[0]) {
    throw new BehavioralTargetProfileError(
      "behavioral_target_session_not_found",
      "The session is not owner-scoped or does not exist.",
    );
  }
  return resolvedBinding(rows[0] as TargetResolutionRow, "session");
}

export async function resolveBehavioralTarget(ownerId: string, input: {
  activityId?: string;
  sessionId?: string;
}) {
  const parsed = z.object({
    activityId: stableIdSchema.optional(),
    sessionId: stableIdSchema.optional(),
  }).strict().refine((value) => Boolean(value.activityId || value.sessionId), {
    message: "Resolve requires an activity or session.",
  }).parse(input);
  const activityResolution = parsed.activityId
    ? await readActivityResolution(ownerId, parsed.activityId)
    : null;
  const parentSessionId = activityResolution?.parentSessionId ?? null;
  if (parsed.activityId && parsed.sessionId && parsed.sessionId !== parentSessionId) {
    throw new BehavioralTargetProfileError(
      "behavioral_target_scope_mismatch",
      "The supplied session does not own this behavioral activity.",
    );
  }
  if (activityResolution?.resolved) return activityResolution.resolved;
  const sessionId = parsed.activityId ? parentSessionId : parsed.sessionId;
  if (sessionId) {
    const sessionResolution = await readSessionResolution(ownerId, sessionId);
    if (sessionResolution) return sessionResolution;
  }
  return { source: "none" as const, binding: null, target: null };
}
