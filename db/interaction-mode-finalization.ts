import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "./index";
import {
  practiceInteractionModeClassifications,
  practiceInteractionModeTransitions,
  practiceInteractionModeTurnOverrides,
  practiceTranscriptTurns,
  timerIntervals,
} from "./schema";
import { interactionModeRegistry } from "./interaction-mode-policy";
import {
  classifyInteractionModePractice,
  interactionModeClassificationCorrectionSchema,
  interactionModeClassificationFingerprint,
  interactionModeClassificationInputSchema,
  interactionModeClassificationSchema,
  type InteractionModeClassification,
} from "./interaction-mode-classification";

export class InteractionModeFinalizationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "InteractionModeFinalizationError";
  }
}

export type InteractionModeClassificationWritePlan = {
  operationId: string;
  requestFingerprint: string;
  snapshotRevision: number;
  classification: InteractionModeClassification;
  correctionOfRevision: number | null;
  correctionReason: string | null;
  replay: boolean;
  dependencies: {
    transitionCount: number;
    timerIntervals: Array<{ startedAt: number; endedAt: number | null }>;
    turnOverrides: Array<{
      responseTurnId: string;
      mutationId: string;
      overrideInteractionModeId: string;
    }>;
  } | null;
};

export async function prepareInteractionModeClassificationWrite(input: {
  ownerId: string;
  activityId: string;
  complete: boolean;
  operationId?: string;
  evidence?: unknown;
  correction?: unknown;
}): Promise<InteractionModeClassificationWritePlan | null> {
  const hasFields = Boolean(input.operationId || input.evidence || input.correction);
  if (!input.complete) {
    if (hasFields) {
      throw new InteractionModeFinalizationError(
        "interaction_mode_classification_incomplete",
        "Interaction-mode classification belongs only to a completed finalization.",
      );
    }
    return null;
  }
  if (!input.operationId || !input.evidence) {
    throw new InteractionModeFinalizationError(
      "interaction_mode_classification_required",
      "Every new completed finalization requires a stable interaction-mode classification operation and evidence selection.",
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,199}$/.test(input.operationId)) {
    throw new InteractionModeFinalizationError(
      "interaction_mode_classification_invalid_operation",
      "The interaction-mode classification operation ID must be a lowercase stable ID.",
    );
  }
  const evidence = interactionModeClassificationInputSchema.parse(input.evidence);
  const correction = input.correction
    ? interactionModeClassificationCorrectionSchema.parse(input.correction)
    : null;
  const requestFingerprint = await interactionModeClassificationFingerprint({
    activityId: input.activityId,
    evidence,
    correction,
  });
  const db = getDb();
  const existingOperation = await db.select().from(practiceInteractionModeClassifications).where(and(
    eq(practiceInteractionModeClassifications.ownerId, input.ownerId),
    eq(practiceInteractionModeClassifications.operationId, input.operationId),
  )).limit(1);
  if (existingOperation[0]) {
    if (existingOperation[0].requestFingerprint !== requestFingerprint) {
      throw new InteractionModeFinalizationError(
        "interaction_mode_classification_operation_conflict",
        "That classification operation ID is already bound to different immutable evidence.",
      );
    }
    return {
      operationId: input.operationId,
      requestFingerprint,
      snapshotRevision: existingOperation[0].snapshotRevision,
      classification: interactionModeClassificationSchema.parse(existingOperation[0].classification),
      correctionOfRevision: existingOperation[0].correctionOfRevision,
      correctionReason: existingOperation[0].correctionReason,
      replay: true,
      dependencies: null,
    };
  }
  const [priorRows, transitions, turnOverrides, intervals, turns] = await Promise.all([
    db.select().from(practiceInteractionModeClassifications).where(and(
      eq(practiceInteractionModeClassifications.ownerId, input.ownerId),
      eq(practiceInteractionModeClassifications.activityId, input.activityId),
    )).orderBy(desc(practiceInteractionModeClassifications.snapshotRevision)).limit(1),
    db.select().from(practiceInteractionModeTransitions).where(and(
      eq(practiceInteractionModeTransitions.ownerId, input.ownerId),
      eq(practiceInteractionModeTransitions.activityId, input.activityId),
    )).orderBy(asc(practiceInteractionModeTransitions.occurredAt), asc(practiceInteractionModeTransitions.toRevision)),
    db.select().from(practiceInteractionModeTurnOverrides).where(and(
      eq(practiceInteractionModeTurnOverrides.ownerId, input.ownerId),
      eq(practiceInteractionModeTurnOverrides.activityId, input.activityId),
    )).orderBy(asc(practiceInteractionModeTurnOverrides.createdAt)),
    db.select({ startedAt: timerIntervals.startedAt, endedAt: timerIntervals.endedAt })
      .from(timerIntervals)
      .where(and(
        eq(timerIntervals.ownerId, input.ownerId),
        eq(timerIntervals.subjectId, input.activityId),
        eq(timerIntervals.kind, "activity"),
      ))
      .orderBy(asc(timerIntervals.startedAt)),
    db.select({
      turnId: practiceTranscriptTurns.turnId,
      speaker: practiceTranscriptTurns.speaker,
      occurredAt: practiceTranscriptTurns.occurredAt,
    }).from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, input.ownerId),
      eq(practiceTranscriptTurns.activityId, input.activityId),
    )).orderBy(asc(practiceTranscriptTurns.occurredAt), asc(practiceTranscriptTurns.sequence)),
  ]);
  const prior = priorRows[0];
  if (prior && !correction) {
    throw new InteractionModeFinalizationError(
      "interaction_mode_classification_correction_required",
      "A classification already exists. Append an explicit correction instead of replacing history.",
    );
  }
  if (!prior && correction) {
    throw new InteractionModeFinalizationError(
      "interaction_mode_classification_correction_missing",
      "There is no prior classification revision to correct.",
    );
  }
  if (prior && correction?.replacesSnapshotRevision !== prior.snapshotRevision) {
    throw new InteractionModeFinalizationError(
      "interaction_mode_classification_stale_correction",
      "The correction must replace the current classification revision.",
    );
  }
  let classification: InteractionModeClassification;
  try {
    const overrideByTurn = new Map(turnOverrides.map((override) => [
      override.responseTurnId,
      override.overrideInteractionModeId,
    ]));
    classification = classifyInteractionModePractice({
      registryModeIds: interactionModeRegistry.modes.filter((mode) => !mode.deprecated).map((mode) => mode.id),
      transitions,
      timerIntervals: intervals,
      turns: turns.map((turn) => ({
        ...turn,
        overrideInteractionModeId: overrideByTurn.get(turn.turnId) ?? null,
      })),
      evidence,
    });
  } catch (error) {
    throw new InteractionModeFinalizationError(
      "interaction_mode_classification_evidence_mismatch",
      error instanceof Error ? error.message : "Classification evidence does not match the authoritative transcript.",
    );
  }
  return {
    operationId: input.operationId,
    requestFingerprint,
    snapshotRevision: (prior?.snapshotRevision ?? 0) + 1,
    classification,
    correctionOfRevision: correction?.replacesSnapshotRevision ?? null,
    correctionReason: correction?.reason ?? null,
    replay: false,
    dependencies: {
      transitionCount: transitions.length,
      timerIntervals: intervals,
      turnOverrides: turnOverrides.map((override) => ({
        responseTurnId: override.responseTurnId,
        mutationId: override.mutationId,
        overrideInteractionModeId: override.overrideInteractionModeId,
      })),
    },
  };
}
