import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
const VARIANT_SCAN_LIMIT = 101;

export async function readBehavioralPracticePreflight(
  ownerId: string,
  inputValue: BehavioralPracticePreflightInput,
) {
  const input = behavioralPracticePreflightInputSchema.parse(inputValue);
  const db = getDb();
  const [solutionProfile, evidence, resolvedTarget, rows] = await Promise.all([
    readProblemSolutionProfile(ownerId, "behavioral", input.questionId),
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
    }).from(behavioralFinalAnswerSnapshots).leftJoin(
      activityFinalizations,
      and(
        eq(activityFinalizations.ownerId, behavioralFinalAnswerSnapshots.ownerId),
        eq(activityFinalizations.activityId, behavioralFinalAnswerSnapshots.activityId),
      ),
    ).where(and(
      eq(behavioralFinalAnswerSnapshots.ownerId, ownerId),
      sql`json_extract(${behavioralFinalAnswerSnapshots.snapshot}, '$.scope') = 'target_tailored'`,
      sql`json_extract(${behavioralFinalAnswerSnapshots.snapshot}, '$.question.questionId') = ${input.questionId}`,
    )).orderBy(
      desc(behavioralFinalAnswerSnapshots.finalizedAt),
      desc(behavioralFinalAnswerSnapshots.snapshotRevision),
    ).limit(VARIANT_SCAN_LIMIT),
  ]);

  const latestByActivity = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latestByActivity.has(row.activityId)) latestByActivity.set(row.activityId, row);
  const selectedRows = [...latestByActivity.values()].slice(0, VARIANT_LIMIT);
  const snapshots = selectedRows.map((row) => ({
    row,
    snapshot: behavioralFinalAnswerSnapshotInputSchema.parse(row.snapshot),
  }));
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

  return {
    schemaVersion: 1 as const,
    boundary: input.boundary,
    questionId: input.questionId,
    targetResolution: resolvedTarget,
    targeting: resolvedTarget.target
      ? {
          mode: "target_tailored" as const,
          competencySignals: resolvedTarget.target.competencySignals,
          seniorityIndicators: resolvedTarget.target.seniorityIndicators,
          domainVocabulary: resolvedTarget.target.domainVocabulary,
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
      acceptedTargetVariants: rows.length >= VARIANT_SCAN_LIMIT || latestByActivity.size > VARIANT_LIMIT,
    },
  };
}
