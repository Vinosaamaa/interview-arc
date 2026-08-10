import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import { z } from "zod";

import { queryBehavioralEvidence } from "./behavioral-evidence";
import { behavioralFinalAnswerSnapshotInputSchema } from "./behavioral-final-answer";
import {
  behavioralTargetReviewSchema,
  targetVariantStaleReasons,
} from "./behavioral-practice-preflight-policy";
import { resolveBehavioralTarget } from "./behavioral-target-profile";
import { behavioralTargetStableIdSchema } from "./behavioral-target-profile-policy";
import { readProblemSolutionProfile } from "./durable-practice";
import { getDb } from "./index";
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

export async function readBehavioralPracticePreflight(
  ownerId: string,
  inputValue: BehavioralPracticePreflightInput,
) {
  const input = behavioralPracticePreflightInputSchema.parse(inputValue);
  const db = getDb();
  const latestSnapshotRevisions = db.select({
    ownerId: behavioralFinalAnswerSnapshots.ownerId,
    activityId: behavioralFinalAnswerSnapshots.activityId,
    latestSnapshotRevision: max(behavioralFinalAnswerSnapshots.snapshotRevision).as("latest_snapshot_revision"),
  }).from(behavioralFinalAnswerSnapshots).where(and(
    eq(behavioralFinalAnswerSnapshots.ownerId, ownerId),
    sql`json_extract(${behavioralFinalAnswerSnapshots.snapshot}, '$.question.questionId') = ${input.questionId}`,
  )).groupBy(
    behavioralFinalAnswerSnapshots.ownerId,
    behavioralFinalAnswerSnapshots.activityId,
  ).as("latest_behavioral_answer_revisions");
  const [solutionProfile, evidence, resolvedTarget, rows] = await Promise.all([
    readProblemSolutionProfile(ownerId, "behavioral", input.questionId, { revisionLimit: 1 }),
    queryBehavioralEvidence(ownerId, input.questionId),
    resolveBehavioralTarget(ownerId, {
      ...(input.activityId ? { activityId: input.activityId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    }),
    db.select({
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
    )).orderBy(
      desc(behavioralFinalAnswerSnapshots.finalizedAt),
      desc(behavioralFinalAnswerSnapshots.snapshotRevision),
    ).limit(VARIANT_SCAN_LIMIT),
  ]);

  const allTargetSnapshots = rows.map((row) => ({
    row,
    snapshot: behavioralFinalAnswerSnapshotInputSchema.parse(row.snapshot),
  })).filter(({ snapshot }) => snapshot.scope === "target_tailored");
  const snapshots = allTargetSnapshots.slice(0, VARIANT_LIMIT);
  const targetIds = [...new Set(snapshots.flatMap(({ snapshot }) => snapshot.target?.targetId ?? []))];
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
  const acceptedTargetVariants = snapshots.map(({ row, snapshot }) => {
    const target = snapshot.target!;
    const finalization = row.finalization as { behavioralReview?: unknown } | null;
    const reviewResult = behavioralTargetReviewSchema.safeParse(finalization?.behavioralReview);
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
    return {
      activityId: row.activityId,
      snapshotRevision: row.snapshotRevision,
      answer: snapshot.answer,
      question: snapshot.question,
      solutionProfile: snapshot.solutionProfile,
      story: snapshot.story ?? null,
      acceptedEvidenceIds: snapshot.acceptedEvidenceIds,
      target,
      review: reviewResult.success ? reviewResult.data : null,
      finalizedAt: row.finalizedAt,
      stale: staleReasons.length > 0,
      staleReasons,
    };
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
  return {
    schemaVersion: 1 as const,
    boundary: input.boundary,
    questionId: input.questionId,
    targetResolution: {
      source: resolvedTarget.source,
      binding: resolvedTarget.binding,
      target: targetContext,
    },
    targeting: targetContext
      ? {
          mode: "target_tailored" as const,
          competencySignals: targetContext.competencySignals,
          seniorityIndicators: targetContext.seniorityIndicators,
          domainVocabulary: targetContext.domainVocabulary,
        }
      : {
          mode: "universal" as const,
          competencySignals: [],
          seniorityIndicators: [],
          domainVocabulary: [],
        },
    solutionProfile,
    evidence,
    acceptedTargetVariants,
    reviewContract: {
      schemaVersion: 1 as const,
      sections: ["universalQuality", "targetAlignment", "assistance", "evidenceGaps"] as const,
    },
    limits: { acceptedTargetVariants: VARIANT_LIMIT },
    truncated: {
      acceptedTargetVariants: allTargetSnapshots.length > VARIANT_LIMIT,
    },
  };
}
