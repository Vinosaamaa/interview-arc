import { and, desc, eq, sql } from "drizzle-orm";
import { classifyD1TransactionalFailure, d1TransactionalInvariantGuard } from "./d1-transactional-guard";
import { getDb } from "./index";
import { classifyInteractionModeAtomicFailure, InteractionModeError } from "./interaction-mode-policy";
import {
  practiceInteractionModeMutations,
  practiceInteractionModeStates,
  practiceInteractionModeTransitions,
  practiceTranscriptTurns,
} from "./schema";

export type InteractionModeSource = "explicit_user_instruction" | "workflow_transition";

export type InteractionModeMutationReceipt = {
  mutationId: string;
  activityId: string;
  transitionId: string;
  fromInteractionModeId: string | null;
  toInteractionModeId: string;
  fromRevision: number;
  toRevision: number;
  registryVersion: string;
  triggerTurnId: string | null;
  source: InteractionModeSource;
  reason: string;
  occurredAt: number;
};

const transitionReadLimit = 100;

async function readCurrentPracticeInteractionMode(ownerId: string, activityId: string) {
  const rows = await getDb().select().from(practiceInteractionModeStates).where(and(
    eq(practiceInteractionModeStates.ownerId, ownerId),
    eq(practiceInteractionModeStates.activityId, activityId),
  )).limit(1);
  return rows[0] ?? null;
}

export async function readPracticeInteractionMode(ownerId: string, activityId: string) {
  const db = getDb();
  const [currentRows, latestTransitions] = await Promise.all([
    readCurrentPracticeInteractionMode(ownerId, activityId),
    db.select().from(practiceInteractionModeTransitions).where(and(
      eq(practiceInteractionModeTransitions.ownerId, ownerId),
      eq(practiceInteractionModeTransitions.activityId, activityId),
    )).orderBy(desc(practiceInteractionModeTransitions.toRevision)).limit(transitionReadLimit + 1),
  ]);
  const current = currentRows;
  const transitionHistoryTruncated = latestTransitions.length > transitionReadLimit;
  const transitions = latestTransitions.slice(0, transitionReadLimit).reverse();
  return {
    state: current ? "recorded" as const : "needs_selection" as const,
    current: current ? {
      activityId: current.activityId,
      interactionModeId: current.interactionModeId,
      registryVersion: current.registryVersion,
      revision: current.revision,
      source: current.source,
      lastMutationId: current.lastMutationId,
      updatedAt: current.updatedAt,
    } : null,
    transitionHistory: {
      order: "chronological" as const,
      limit: transitionReadLimit,
      returnedCount: transitions.length,
      truncated: transitionHistoryTruncated,
      oldestReturnedRevision: transitions[0]?.toRevision ?? null,
      latestReturnedRevision: transitions.at(-1)?.toRevision ?? null,
    },
    transitions: transitions.map((transition) => ({
      transitionId: transition.transitionId,
      mutationId: transition.mutationId,
      fromInteractionModeId: transition.fromInteractionModeId,
      toInteractionModeId: transition.toInteractionModeId,
      fromRevision: transition.fromRevision,
      toRevision: transition.toRevision,
      registryVersion: transition.registryVersion,
      triggerTurnId: transition.triggerTurnId,
      source: transition.source,
      reason: transition.reason,
      occurredAt: transition.occurredAt,
      createdAt: transition.createdAt,
    })),
  };
}

async function readMutation(ownerId: string, mutationId: string) {
  const rows = await getDb().select().from(practiceInteractionModeMutations).where(and(
    eq(practiceInteractionModeMutations.ownerId, ownerId),
    eq(practiceInteractionModeMutations.mutationId, mutationId),
  )).limit(1);
  return rows[0] ?? null;
}

async function triggerTurnExists(ownerId: string, activityId: string, triggerTurnId: string) {
  const rows = await getDb().select({ turnId: practiceTranscriptTurns.turnId })
    .from(practiceTranscriptTurns)
    .where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, activityId),
      eq(practiceTranscriptTurns.turnId, triggerTurnId),
      eq(practiceTranscriptTurns.speaker, "user"),
    )).limit(1);
  return Boolean(rows[0]);
}

function mutationConflict() {
  return new InteractionModeError(
    "interaction_mode_mutation_identity_conflict",
    "That interaction-mode mutation identifier was already used for different content.",
    { retryable: false },
  );
}

async function validateMutationPreconditions(input: {
  ownerId: string;
  activityId: string;
  expectedRevision: number;
  triggerTurnId?: string;
}) {
  const [current, validTrigger] = await Promise.all([
    readCurrentPracticeInteractionMode(input.ownerId, input.activityId),
    input.triggerTurnId
      ? triggerTurnExists(input.ownerId, input.activityId, input.triggerTurnId)
      : Promise.resolve(true),
  ]);
  const actualRevision = current?.revision ?? 0;
  if (actualRevision !== input.expectedRevision) {
    throw new InteractionModeError(
      "interaction_mode_stale_revision",
      "Interaction mode changed in another surface. Read it again before retrying.",
      { expectedRevision: input.expectedRevision, actualRevision, retryable: false },
    );
  }
  if (!validTrigger) {
    throw new InteractionModeError(
      "interaction_mode_trigger_turn_mismatch",
      "The trigger turn is not an owner-scoped user turn in this activity.",
      { triggerTurnId: input.triggerTurnId, retryable: false },
    );
  }
  return current;
}

export async function setPracticeInteractionModeAtomic(input: {
  ownerId: string;
  activityId: string;
  interactionModeId: string;
  registryVersion: string;
  expectedRevision: number;
  mutationId: string;
  requestFingerprint: string;
  triggerTurnId?: string;
  source: InteractionModeSource;
  reason: string;
  occurredAt: number;
  now: number;
}) {
  const priorMutation = await readMutation(input.ownerId, input.mutationId);
  if (priorMutation) {
    if (priorMutation.requestFingerprint !== input.requestFingerprint) throw mutationConflict();
    return {
      duplicate: true,
      receipt: priorMutation.receipt as InteractionModeMutationReceipt,
      ...(await readPracticeInteractionMode(input.ownerId, input.activityId)),
    };
  }

  const before = await validateMutationPreconditions(input);
  if (before?.interactionModeId === input.interactionModeId) {
    throw new InteractionModeError(
      "interaction_mode_already_active",
      `Interaction mode “${input.interactionModeId}” is already active.`,
      { actualRevision: before.revision, retryable: false },
    );
  }

  const db = getDb();
  const toRevision = input.expectedRevision + 1;
  const transitionId = `interaction-mode:${input.mutationId}`;
  const receipt: InteractionModeMutationReceipt = {
    mutationId: input.mutationId,
    activityId: input.activityId,
    transitionId,
    fromInteractionModeId: before?.interactionModeId ?? null,
    toInteractionModeId: input.interactionModeId,
    fromRevision: input.expectedRevision,
    toRevision,
    registryVersion: input.registryVersion,
    triggerTurnId: input.triggerTurnId ?? null,
    source: input.source,
    reason: input.reason,
    occurredAt: input.occurredAt,
  };
  const revisionCondition = input.expectedRevision === 0
    ? sql`NOT EXISTS (
        SELECT 1 FROM ${practiceInteractionModeStates}
        WHERE ${practiceInteractionModeStates.ownerId} = ${input.ownerId}
          AND ${practiceInteractionModeStates.activityId} = ${input.activityId}
      )`
    : sql`EXISTS (
        SELECT 1 FROM ${practiceInteractionModeStates}
        WHERE ${practiceInteractionModeStates.ownerId} = ${input.ownerId}
          AND ${practiceInteractionModeStates.activityId} = ${input.activityId}
          AND ${practiceInteractionModeStates.revision} = ${input.expectedRevision}
      )`;
  const triggerCondition = input.triggerTurnId
    ? sql`EXISTS (
        SELECT 1 FROM ${practiceTranscriptTurns}
        WHERE ${practiceTranscriptTurns.ownerId} = ${input.ownerId}
          AND ${practiceTranscriptTurns.activityId} = ${input.activityId}
          AND ${practiceTranscriptTurns.turnId} = ${input.triggerTurnId}
          AND ${practiceTranscriptTurns.speaker} = 'user'
      )`
    : sql`1 = 1`;

  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, revisionCondition),
      d1TransactionalInvariantGuard(db, triggerCondition),
      db.insert(practiceInteractionModeMutations).values({
        ownerId: input.ownerId,
        mutationId: input.mutationId,
        activityId: input.activityId,
        requestFingerprint: input.requestFingerprint,
        transitionId,
        toRevision,
        interactionModeId: input.interactionModeId,
        registryVersion: input.registryVersion,
        receipt,
        createdAt: input.now,
      }).onConflictDoNothing(),
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${practiceInteractionModeMutations}
        WHERE ${practiceInteractionModeMutations.ownerId} = ${input.ownerId}
          AND ${practiceInteractionModeMutations.mutationId} = ${input.mutationId}
          AND ${practiceInteractionModeMutations.requestFingerprint} = ${input.requestFingerprint}
      )`),
      db.insert(practiceInteractionModeStates).values({
        ownerId: input.ownerId,
        activityId: input.activityId,
        interactionModeId: input.interactionModeId,
        registryVersion: input.registryVersion,
        revision: toRevision,
        source: input.source,
        lastMutationId: input.mutationId,
        updatedAt: input.now,
      }).onConflictDoUpdate({
        target: [practiceInteractionModeStates.ownerId, practiceInteractionModeStates.activityId],
        set: {
          interactionModeId: input.interactionModeId,
          registryVersion: input.registryVersion,
          revision: toRevision,
          source: input.source,
          lastMutationId: input.mutationId,
          updatedAt: input.now,
        },
        setWhere: eq(practiceInteractionModeStates.revision, input.expectedRevision),
      }),
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${practiceInteractionModeStates}
        WHERE ${practiceInteractionModeStates.ownerId} = ${input.ownerId}
          AND ${practiceInteractionModeStates.activityId} = ${input.activityId}
          AND ${practiceInteractionModeStates.revision} = ${toRevision}
          AND ${practiceInteractionModeStates.lastMutationId} = ${input.mutationId}
      )`),
      db.insert(practiceInteractionModeTransitions).values({
        ownerId: input.ownerId,
        activityId: input.activityId,
        transitionId,
        mutationId: input.mutationId,
        fromInteractionModeId: receipt.fromInteractionModeId,
        toInteractionModeId: input.interactionModeId,
        fromRevision: input.expectedRevision,
        toRevision,
        registryVersion: input.registryVersion,
        triggerTurnId: input.triggerTurnId ?? null,
        source: input.source,
        reason: input.reason,
        occurredAt: input.occurredAt,
        createdAt: input.now,
      }).onConflictDoNothing(),
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${practiceInteractionModeTransitions}
        WHERE ${practiceInteractionModeTransitions.ownerId} = ${input.ownerId}
          AND ${practiceInteractionModeTransitions.activityId} = ${input.activityId}
          AND ${practiceInteractionModeTransitions.transitionId} = ${transitionId}
          AND ${practiceInteractionModeTransitions.mutationId} = ${input.mutationId}
          AND ${practiceInteractionModeTransitions.toRevision} = ${toRevision}
          AND ${practiceInteractionModeTransitions.toInteractionModeId} = ${input.interactionModeId}
      )`),
    ]);
  } catch (error) {
    const racedMutation = await readMutation(input.ownerId, input.mutationId);
    if (racedMutation) {
      if (racedMutation.requestFingerprint !== input.requestFingerprint) throw mutationConflict();
      return {
        duplicate: true,
        receipt: racedMutation.receipt as InteractionModeMutationReceipt,
        ...(await readPracticeInteractionMode(input.ownerId, input.activityId)),
      };
    }
    await validateMutationPreconditions(input);
    const failure = classifyInteractionModeAtomicFailure(classifyD1TransactionalFailure(error));
    throw new InteractionModeError(failure.code, failure.message, {
      retryable: failure.retryable,
    });
  }

  return {
    duplicate: false,
    receipt,
    ...(await readPracticeInteractionMode(input.ownerId, input.activityId)),
  };
}
