import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import { z } from "zod";

import { queryBehavioralEvidence } from "./behavioral-evidence";
import {
  behavioralFinalAnswerSnapshotInputSchema,
  type BehavioralFinalAnswerSnapshotInput,
} from "./behavioral-final-answer";
import {
  behavioralTargetReviewSchema,
  targetVariantStaleReasons,
} from "./behavioral-practice-preflight-policy";
import { resolveBehavioralTarget } from "./behavioral-target-profile";
import { behavioralTargetStableIdSchema } from "./behavioral-target-profile-policy";
import { readProblemSolutionProfile } from "./durable-practice";
import { getDb } from "./index";
import { readBoundLoopActivityContext } from "./loops";
import {
  activityFinalizations,
  behavioralFinalAnswerSnapshots,
  behavioralTargetProfiles,
} from "./schema";

export const behavioralPracticeBoundaries = [
  "start_resume",
  "new_question",
  "post_mutation",
  "reconnect_handoff",
  "finalization",
] as const;

export const behavioralPracticePreflightInputSchema = z.object({
  boundary: z.enum(behavioralPracticeBoundaries),
  questionId: behavioralTargetStableIdSchema,
  activityId: behavioralTargetStableIdSchema.optional(),
  sessionId: behavioralTargetStableIdSchema.optional(),
}).strict().refine((value) => Boolean(value.activityId || value.sessionId), {
  message: "Behavioral preflight requires an authoritative activity or session scope.",
});

export type BehavioralPracticePreflightInput = z.infer<typeof behavioralPracticePreflightInputSchema>;

const VARIANT_LIMIT = 50;
const VARIANT_SCAN_LIMIT = VARIANT_LIMIT + 1;

type AcceptedVariantRow = {
  activityId: string;
  snapshotRevision: number;
  finalizedAt: number;
  finalization: unknown;
};

function projectAcceptedTailoredVariant(
  row: AcceptedVariantRow,
  snapshot: BehavioralFinalAnswerSnapshotInput,
  context: { target: NonNullable<BehavioralFinalAnswerSnapshotInput["target"]> }
    | { roleBrief: NonNullable<BehavioralFinalAnswerSnapshotInput["roleBrief"]> },
  staleReasons: string[],
) {
  const finalization = row.finalization as { behavioralReview?: unknown } | null;
  const reviewResult = behavioralTargetReviewSchema.safeParse(finalization?.behavioralReview);
  return {
    activityId: row.activityId,
    snapshotRevision: row.snapshotRevision,
    answer: snapshot.answer,
    question: snapshot.question,
    solutionProfile: snapshot.solutionProfile,
    story: snapshot.story ?? null,
    acceptedEvidenceIds: snapshot.acceptedEvidenceIds,
    ...context,
    review: reviewResult.success ? reviewResult.data : null,
    finalizedAt: row.finalizedAt,
    stale: staleReasons.length > 0,
    staleReasons,
  };
}

function readAcceptedTailoredVariantRows(
  ownerId: string,
  questionId: string,
  context: "target" | "roleBrief",
) {
  const db = getDb();
  const latestSnapshotRevisions = db.select({
    ownerId: behavioralFinalAnswerSnapshots.ownerId,
    activityId: behavioralFinalAnswerSnapshots.activityId,
    latestSnapshotRevision: max(behavioralFinalAnswerSnapshots.snapshotRevision).as("latest_snapshot_revision"),
  }).from(behavioralFinalAnswerSnapshots).where(and(
    eq(behavioralFinalAnswerSnapshots.ownerId, ownerId),
    sql`json_extract(${behavioralFinalAnswerSnapshots.snapshot}, '$.question.questionId') = ${questionId}`,
  )).groupBy(
    behavioralFinalAnswerSnapshots.ownerId,
    behavioralFinalAnswerSnapshots.activityId,
  ).as("latest_behavioral_answer_revisions");
  const contextCondition = context === "target"
    ? sql`json_type(${behavioralFinalAnswerSnapshots.snapshot}, '$.target') IS NOT NULL`
    : sql`json_type(${behavioralFinalAnswerSnapshots.snapshot}, '$.roleBrief') IS NOT NULL`;
  return db.select({
    activityId: behavioralFinalAnswerSnapshots.activityId,
    snapshotRevision: behavioralFinalAnswerSnapshots.snapshotRevision,
    snapshot: behavioralFinalAnswerSnapshots.snapshot,
    finalizedAt: behavioralFinalAnswerSnapshots.finalizedAt,
    finalization: activityFinalizations.payload,
  }).from(behavioralFinalAnswerSnapshots).innerJoin(
    latestSnapshotRevisions,
    and(
      eq(latestSnapshotRevisions.ownerId, behavioralFinalAnswerSnapshots.ownerId),
      eq(latestSnapshotRevisions.activityId, behavioralFinalAnswerSnapshots.activityId),
      eq(latestSnapshotRevisions.latestSnapshotRevision, behavioralFinalAnswerSnapshots.snapshotRevision),
    ),
  ).leftJoin(
    activityFinalizations,
    and(
      eq(activityFinalizations.ownerId, behavioralFinalAnswerSnapshots.ownerId),
      eq(activityFinalizations.activityId, behavioralFinalAnswerSnapshots.activityId),
    ),
  ).where(and(
    eq(behavioralFinalAnswerSnapshots.ownerId, ownerId),
    sql`json_extract(${behavioralFinalAnswerSnapshots.snapshot}, '$.scope') = 'target_tailored'`,
    contextCondition,
  )).orderBy(
    desc(behavioralFinalAnswerSnapshots.finalizedAt),
    desc(behavioralFinalAnswerSnapshots.snapshotRevision),
  ).limit(VARIANT_SCAN_LIMIT);
}

export async function readBehavioralPracticePreflight(
  ownerId: string,
  inputValue: BehavioralPracticePreflightInput,
) {
  const input = behavioralPracticePreflightInputSchema.parse(inputValue);
  const db = getDb();
  const [solutionProfile, evidence, resolvedTarget, boundLoop, legacyRows, roleBriefRows] = await Promise.all([
    readProblemSolutionProfile(ownerId, "behavioral", input.questionId, { revisionLimit: 1 }),
    queryBehavioralEvidence(ownerId, input.questionId),
    resolveBehavioralTarget(ownerId, {
      ...(input.activityId ? { activityId: input.activityId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    }),
    input.activityId ? readBoundLoopActivityContext(ownerId, input.activityId) : null,
    readAcceptedTailoredVariantRows(ownerId, input.questionId, "target"),
    readAcceptedTailoredVariantRows(ownerId, input.questionId, "roleBrief"),
  ]);

  const allLegacyTargetSnapshots = legacyRows.map((row) => ({
    row,
    snapshot: behavioralFinalAnswerSnapshotInputSchema.parse(row.snapshot),
  })).filter(({ snapshot }) => snapshot.scope === "target_tailored" && Boolean(snapshot.target));
  const allLoopRoleBriefSnapshots = roleBriefRows.map((row) => ({
    row,
    snapshot: behavioralFinalAnswerSnapshotInputSchema.parse(row.snapshot),
  })).filter(({ snapshot }) => snapshot.scope === "target_tailored" && Boolean(snapshot.roleBrief));
  const legacyTargetSnapshots = allLegacyTargetSnapshots.slice(0, VARIANT_LIMIT);
  const loopRoleBriefSnapshots = allLoopRoleBriefSnapshots.slice(0, VARIANT_LIMIT);
  const targetIds = [...new Set(legacyTargetSnapshots.flatMap(({ snapshot }) => snapshot.target?.targetId ?? []))];
  const targetRows = targetIds.length
    ? await db.select({
        targetId: behavioralTargetProfiles.targetId,
        currentRevision: behavioralTargetProfiles.currentRevision,
      }).from(behavioralTargetProfiles).where(and(
        eq(behavioralTargetProfiles.ownerId, ownerId),
        inArray(behavioralTargetProfiles.targetId, targetIds),
      ))
    : [];
  const currentTargetRevisions = new Map(targetRows.map((row) => [row.targetId, row.currentRevision]));
  const currentSolutionProfileRevision = solutionProfile.profile?.currentRevision ?? null;
  const boundBehavioralLoop = boundLoop
    && boundLoop.binding.specialty === "behavioral"
    && boundLoop.binding.questionId === input.questionId
    ? boundLoop
    : null;
  const acceptedTargetVariants = legacyTargetSnapshots.map(({ row, snapshot }) => {
    const target = snapshot.target!;
    const staleReasons = targetVariantStaleReasons({
      targetId: target.targetId,
      targetRevision: target.revision,
      solutionProfileRevision: snapshot.solutionProfile.revision,
    }, {
      resolvedTargetId: resolvedTarget.target?.targetId ?? null,
      resolvedTargetRevision: resolvedTarget.target?.revision ?? null,
      currentTargetRevision: currentTargetRevisions.get(target.targetId) ?? null,
      currentSolutionProfileRevision,
    });
    return projectAcceptedTailoredVariant(row, snapshot, { target }, staleReasons);
  });
  const acceptedRoleBriefVariants = loopRoleBriefSnapshots.map(({ row, snapshot }) => {
    const roleBrief = snapshot.roleBrief!;
    const staleReasons: string[] = [];
    if (!boundBehavioralLoop) staleReasons.push("loop_role_brief_unbound");
    else {
      if (boundBehavioralLoop.binding.loopId !== roleBrief.loopId) staleReasons.push("loop_changed");
      if (boundBehavioralLoop.binding.roleBriefRevision !== roleBrief.revision) staleReasons.push("role_brief_revised");
    }
    if (currentSolutionProfileRevision !== snapshot.solutionProfile.revision) {
      staleReasons.push("solution_profile_revised");
    }
    return projectAcceptedTailoredVariant(row, snapshot, { roleBrief }, staleReasons);
  });

  const targetContext = resolvedTarget.target
    ? {
        targetId: resolvedTarget.target.targetId,
        revision: resolvedTarget.target.revision,
        label: resolvedTarget.target.label,
        company: resolvedTarget.target.company,
        roleTitle: resolvedTarget.target.roleTitle,
        targetLevel: resolvedTarget.target.targetLevel,
        competencySignals: resolvedTarget.target.competencySignals,
        seniorityIndicators: resolvedTarget.target.seniorityIndicators,
        domainVocabulary: resolvedTarget.target.domainVocabulary,
      }
    : null;
  const roleBriefContext = boundBehavioralLoop
    ? {
        loopId: boundBehavioralLoop.binding.loopId,
        loopRevision: boundBehavioralLoop.binding.loopRevision,
        roleBriefRevision: boundBehavioralLoop.binding.roleBriefRevision,
        stageId: boundBehavioralLoop.binding.stageId,
        label: boundBehavioralLoop.roleBrief.label,
        company: boundBehavioralLoop.roleBrief.company,
        roleTitle: boundBehavioralLoop.roleBrief.roleTitle,
        targetLevel: boundBehavioralLoop.roleBrief.targetLevel,
        competencySignals: boundBehavioralLoop.roleBrief.competencySignals,
        seniorityIndicators: boundBehavioralLoop.roleBrief.seniorityIndicators,
        domainVocabulary: boundBehavioralLoop.roleBrief.domainVocabulary,
      }
    : null;
  return {
    schemaVersion: 1 as const,
    boundary: input.boundary,
    questionId: input.questionId,
    targetResolution: {
      source: resolvedTarget.source,
      binding: resolvedTarget.binding,
      target: targetContext,
    },
    roleBriefResolution: {
      source: roleBriefContext ? "activity" as const : "none" as const,
      binding: roleBriefContext ? boundBehavioralLoop!.binding : null,
      roleBrief: roleBriefContext,
    },
    targeting: roleBriefContext
      ? {
          mode: "target_tailored" as const,
          source: "loop_role_brief" as const,
          competencySignals: roleBriefContext.competencySignals,
          seniorityIndicators: roleBriefContext.seniorityIndicators,
          domainVocabulary: roleBriefContext.domainVocabulary,
        }
      : targetContext
      ? {
          mode: "target_tailored" as const,
          source: "legacy_target_profile" as const,
          competencySignals: targetContext.competencySignals,
          seniorityIndicators: targetContext.seniorityIndicators,
          domainVocabulary: targetContext.domainVocabulary,
        }
      : {
          mode: "universal" as const,
          source: "none" as const,
          competencySignals: [],
          seniorityIndicators: [],
          domainVocabulary: [],
        },
    solutionProfile,
    evidence,
    acceptedTargetVariants,
    acceptedRoleBriefVariants,
    reviewContract: {
      schemaVersion: 1 as const,
      sections: ["universalQuality", "targetAlignment", "assistance", "evidenceGaps"] as const,
    },
    limits: { acceptedTargetVariants: VARIANT_LIMIT, acceptedRoleBriefVariants: VARIANT_LIMIT },
    truncated: {
      acceptedTargetVariants: allLegacyTargetSnapshots.length > VARIANT_LIMIT,
      acceptedRoleBriefVariants: allLoopRoleBriefSnapshots.length > VARIANT_LIMIT,
    },
  };
}
