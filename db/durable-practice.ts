import { and, asc, desc, eq, exists, gt, inArray, isNotNull, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { getDb } from "./index";
import { solutionProfileMissingRequirements } from "../app/solution-profile-policy";
import {
  activityDeliveryAnalyses,
  activityAudioClips,
  activityFinalizations,
  activityResumeContexts,
  activitySolutionLinks,
  behavioralClaims,
  behavioralEvidenceItems,
  behavioralEvidenceQuestionLinks,
  behavioralFinalAnswerSnapshots,
  behavioralProjectActivityLinks,
  behavioralProjectQuestionBindingRevisions,
  behavioralProjectQuestionBindings,
  behavioralStories,
  behavioralStoryRevisions,
  behavioralTargetBindings,
  contentBank,
  deferredVoiceCaptureDecisions,
  extraActivities,
  leetcodeCodeAttempts,
  leetcodeCodeAttemptReviewBackfills,
  liveTurnReservations,
  loopActivityBindings,
  ownerBankQuestions,
  practiceInteractionModeClassifications,
  practiceInteractionModeTransitions,
  practiceInteractionModeTurnOverrides,
  practiceNotes,
  practiceTranscriptTurns,
  problemPreferences,
  problemSolutionProfiles,
  problemSolutionRevisions,
  provisionalSolutionProfiles,
  reviewSchedules,
  resumeRevisions,
  resumeSources,
  specialistTasks,
  timerIntervals,
  typedPracticeExchangeDeletions,
  voiceCaptureIntents,
  voiceExchangeReservations,
  voiceResponseGroupMembers,
  voiceResponseGroupRepairEvents,
  voiceResponseGroups,
  voiceSpecialistResponses,
} from "./schema";
import { orderContiguousTurns } from "./timed-conversation";
import {
  canonicalVoiceBatchTurns,
  finishDispositionForVoiceStatus,
  sameCanonicalExchange,
  sameVoiceBatchReservation,
  voiceResponseGroupDigest,
  sameVoiceCommitTurn,
  type CanonicalExchangeIdentity,
  voiceCaptureAllowsCommit,
  type VoiceFinishGuard,
  type VoiceIntentStatus,
  voiceFinishGuardMessage,
} from "./practice-exchange-policy";
import {
  deriveQuestionMetadataTags,
  mergePersonalLeetCodeQuestionMetadata,
  questionMetadataUpdateFields,
  readStoredQuestionMetadata,
  validateLeetCodeQuestionMetadata,
  type LeetCodeQuestionMetadata,
} from "./question-metadata";
import { reviewIntervalDays, type ReviewReason } from "./review-cadence";
import {
  assertCodeAttemptReviewParity,
  codeAttemptEvaluationEvidence,
  codeLineCount,
  normalizeCodeAttemptReview,
  pendingCodeAttemptReviewIds,
  planCodeAttemptWrite,
  type CodeAttemptReviewV1,
  type CodeAttemptReviewWrite,
} from "./code-attempt-review";
import {
  d1TransactionalInvariantGuard,
  isD1TransactionalInvariantFailure,
} from "./d1-transactional-guard";
import { readD1RowsInBatches } from "./d1-read-batching.ts";
import {
  listTypedExchangePairs,
  resolveTypedExchangePair,
  typedExchangeDeletionFingerprint,
  TypedExchangeDeletionError,
  type TypedExchangeTurn,
} from "./typed-exchange-deletion";
import {
  BehavioralFinalAnswerError,
  behavioralFinalAnswerFingerprint,
  behavioralFinalAnswerSnapshotInputSchema,
  projectBehavioralFinalAnswer,
  renderBehavioralFinalAnswerHtml,
  renderBehavioralFinalAnswerMarkdown,
  validateBehavioralFinalAnswerCorrection,
  type BehavioralFinalAnswerCorrection,
  type BehavioralFinalAnswerSnapshotInput,
  type StoredBehavioralFinalAnswerSnapshot,
} from "./behavioral-final-answer";
import {
  behavioralAttemptAnalysisSchema,
  projectBehavioralAttemptAnalysis,
  renderBehavioralAttemptAnalysisHtml,
  renderBehavioralAttemptAnalysisMarkdown,
  type BehavioralAttemptAnalysis,
} from "./behavioral-attempt-analysis";
import {
  behavioralPracticeScenariosSchema,
  behavioralPracticeScenariosFingerprint,
  projectBehavioralPracticeScenarios,
  renderBehavioralPracticeScenariosHtml,
  renderBehavioralPracticeScenariosMarkdown,
  type BehavioralPracticeScenario,
} from "./behavioral-practice-scenario";
import { behavioralStoryInputSchema } from "./behavioral-story-policy";
import {
  resolveBehavioralTarget,
} from "./behavioral-target-profile";
import { readBoundLoopActivityContext } from "./loops";
import {
  behavioralTargetReviewSchema,
  type BehavioralTargetReview,
} from "./behavioral-practice-preflight-policy";
import {
  InteractionModeFinalizationError,
  prepareInteractionModeClassificationWrite,
} from "./interaction-mode-finalization";
import {
  interactionModeClassificationSchema,
  type InteractionModeClassificationInput,
} from "./interaction-mode-classification";
import {
  renderActivityResumeContextHtml,
  renderActivityResumeContextMarkdown,
  resumeContextSelectionSchema,
  storedActivityResumeContextSchema,
  type ActivityResumeContext,
  type ResumeContextSelection,
} from "./activity-resume-context";
import {
  prepareBehavioralProjectFinalizationLink,
  projectProfileMissingRequirements,
  readCurrentBehavioralProjectBinding,
} from "./behavioral-project-deep-dive";
import type { BehavioralProjectFocus } from "./behavioral-project-deep-dive-policy";
import {
  assertPracticeRecordFinalizationPreconditions,
  persistFinalizedPracticeRecord,
  readCurrentPracticeRecord,
  type PracticeRecordSemanticInput,
} from "./practice-records";

export type Specialty = "leetcode" | "system_design" | "behavioral";
export type SpecialistTaskType = Specialty | "loop_recorder" | "learning_specialist" | "resume_cover_letter";
export type NoteKind = "remember" | "insight" | "mistake" | "pattern" | "question";
export type TranscriptSpeaker = "user" | "specialist";
export type TranscriptSource = "codex" | "dictation" | "audio_transcript";
export type VoiceCaptureDecision = "activity_related" | "unrelated" | "uncertain";
export type { ReviewReason } from "./review-cadence";
export type { CodeAttemptReviewV1 } from "./code-attempt-review";

export class VoiceResponseGroupConflictError extends Error {
  readonly code = "voice_response_group_conflict";
  readonly retryable = false;
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "VoiceResponseGroupConflictError";
    this.details = details;
  }
}

export type DeliveryAnalysisPayload = {
  schemaVersion: 1;
  summary: string;
  durationSeconds?: number;
  wordsPerMinute?: number;
  fillerWords?: Array<{ word: string; count: number }>;
  longPauses?: Array<{ startSeconds: number; durationSeconds: number }>;
  strengths: string[];
  improvements: string[];
  observations: Array<{
    dimension: "pace" | "pauses" | "fillers" | "clarity" | "organization" | "vocal_variation" | "perceived_confidence";
    evidence: string;
    coaching: string;
  }>;
};

export type SpecialistFinalization = {
  title: string;
  complete: boolean;
  summary?: string;
  transcriptScope: "full_activity" | "activity_exchanges" | "none_observed";
  review: {
    didWell: string[];
    improve: string[];
  };
  behavioralReview?: BehavioralTargetReview;
  behavioralAnalysis?: BehavioralAttemptAnalysis;
  modelAnswer: string;
  finalAnswerOperationId?: string;
  finalAnswerSnapshot?: BehavioralFinalAnswerSnapshotInput;
  finalAnswerCorrection?: BehavioralFinalAnswerCorrection;
  resumeContext?: ResumeContextSelection;
  interactionModeClassificationOperationId?: string;
  interactionModeEvidence?: InteractionModeClassificationInput;
  interactionModeClassificationCorrection?: {
    replacesSnapshotRevision: number;
    reason: string;
  };
  solution?: string;
  improvedAnswer?: string;
  complexity?: { time?: string; space?: string };
  alternatives?: Array<{ title: string; summary: string; time?: string; space?: string }>;
  edgeCases?: string[];
  references: Array<{ title: string; url: string; accessedAt: string }>;
  questionMetadata?: LeetCodeQuestionMetadata;
  solutionProfileAction?: "create_or_revise" | "reuse_current";
  solutionProfileDecision?: {
    reason: string;
    changedSections: string[];
    researchPerformed: boolean;
    sourcesChecked: string[];
  };
  solutionProfile?: {
    schemaVersion: 1;
    summary: string;
    sections: Array<{ sectionKey?: string; title: string; body: string }>;
    tags: string[];
    references: Array<{ title: string; url: string; accessedAt: string }>;
    behavioralAnswer?: {
      preferred: {
        label: string;
        answer: string;
        evidence: string[];
        evidenceGaps: string[];
      };
      alternatives: Array<{
        label: string;
        answer: string;
        whenToUse?: string;
        evidence: string[];
        evidenceGaps: string[];
      }>;
    };
    practiceScenarios?: BehavioralPracticeScenario[];
    projectDeepDive?: {
      projectId: string;
      bindingRevision: number;
      focus: BehavioralProjectFocus;
      sourceClaimId?: string;
    };
  };
  practiceRecord?: PracticeRecordSemanticInput;
};

const TRANSCRIPT_SECTION = /transcript|conversation|raw exchange|verbatim/i;

function normalizedTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase().replace(/[^a-z0-9+#.:]+/g, "-")).filter(Boolean))]
    .slice(0, 256);
}

async function enrichPersonalLeetCodeQuestion(
  ownerId: string,
  questionId: string,
  tags: string[],
  metadata: LeetCodeQuestionMetadata | undefined,
  nowMs: number,
) {
  const db = getDb();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = await db.select().from(ownerBankQuestions).where(and(
      eq(ownerBankQuestions.ownerId, ownerId),
      eq(ownerBankQuestions.specialty, "leetcode"),
      eq(ownerBankQuestions.questionId, questionId),
    ));
    const question = rows[0];
    if (!question) return;
    const existingMetadata = readStoredQuestionMetadata(question);
    const mergedMetadata = metadata
      ? mergePersonalLeetCodeQuestionMetadata(existingMetadata, metadata)
      : existingMetadata;
    const updated = await db.update(ownerBankQuestions).set({
      tags: normalizedTags([
        ...((question.tags ?? []) as string[]),
        ...tags,
        ...deriveQuestionMetadataTags({
          problemNumber: mergedMetadata.problemNumber ?? undefined,
          difficulty: mergedMetadata.difficulty ?? undefined,
          acceptanceRate: mergedMetadata.acceptanceRate ?? undefined,
          topics: mergedMetadata.topics,
          companyTags: mergedMetadata.companyTags,
          companySignals: mergedMetadata.companySignals,
          capturedAt: new Date(mergedMetadata.metadataCapturedAt ?? nowMs).toISOString(),
          sources: mergedMetadata.metadataReferences.length
            ? mergedMetadata.metadataReferences
            : [{ title: questionId, url: `https://leetcode.com/problems/${questionId}/`, accessedAt: new Date(mergedMetadata.metadataCapturedAt ?? nowMs).toISOString() }],
        }),
      ]),
      ...questionMetadataUpdateFields(mergedMetadata),
      updatedAt: nowMs,
    }).where(and(
      eq(ownerBankQuestions.ownerId, ownerId),
      eq(ownerBankQuestions.specialty, "leetcode"),
      eq(ownerBankQuestions.questionId, questionId),
      eq(ownerBankQuestions.updatedAt, question.updatedAt),
    )).returning({ questionId: ownerBankQuestions.questionId });
    if (updated.length > 0) return;
  }
  throw new Error("The personal LeetCode question changed during finalization; retry the finalization.");
}

function validateSolutionProfile(
  specialty: Specialty,
  payload: SpecialistFinalization["solutionProfile"],
  projectBinding: typeof behavioralProjectQuestionBindings.$inferSelect | null = null,
) {
  if (!payload) throw new Error("A complete finalization needs a reusable Solution Profile.");
  if (specialty !== "behavioral" && payload.projectDeepDive) {
    throw new Error("Project Deep Dive metadata is supported only for behavioral Solution Profiles.");
  }
  validatePracticeScenariosForSpecialty(specialty, payload.practiceScenarios);
  const missing = [
    ...solutionProfileMissingRequirements(specialty, payload),
    ...(specialty === "behavioral" ? projectProfileMissingRequirements(payload, projectBinding) : []),
  ];
  if (missing.length) throw new Error(`A complete finalization needs a reusable Solution Profile; missing: ${missing.join(", ")}.`);
}

function validatePracticeScenariosForSpecialty(
  specialty: Specialty,
  scenarios: BehavioralPracticeScenario[] | undefined,
) {
  if (!scenarios) return;
  if (specialty !== "behavioral") {
    throw new Error("Practice scenarios are supported only for behavioral Solution Profiles.");
  }
  behavioralPracticeScenariosSchema.parse(scenarios);
}

function normalizedSolutionProfile(
  payload: NonNullable<SpecialistFinalization["solutionProfile"]>,
  fallbackReferences: SpecialistFinalization["references"],
) {
  return {
    ...payload,
    tags: normalizedTags(payload.tags),
    references: payload.references.length ? payload.references : fallbackReferences,
  };
}

export function profileFingerprint(payload: NonNullable<SpecialistFinalization["solutionProfile"]>) {
  return JSON.stringify({
    summary: payload.summary.trim(),
    sections: payload.sections.map((section) => ({
      ...(section.sectionKey ? { sectionKey: section.sectionKey.trim() } : {}),
      title: section.title.trim(),
      body: section.body.trim(),
    })),
    tags: normalizedTags(payload.tags).sort(),
    references: payload.references.map((reference) => ({ title: reference.title.trim(), url: reference.url.trim() }))
      .sort((left, right) => left.url.localeCompare(right.url)),
    behavioralAnswer: payload.behavioralAnswer,
    practiceScenarios: behavioralPracticeScenariosFingerprint(payload.practiceScenarios),
    projectDeepDive: payload.projectDeepDive,
  });
}

export async function saveProvisionalSolutionProfile(
  ownerId: string,
  specialty: Specialty,
  questionId: string,
  title: string,
  payload: NonNullable<SpecialistFinalization["solutionProfile"]>,
  input: {
    activityId?: string;
    decision?: SpecialistFinalization["solutionProfileDecision"];
    references?: SpecialistFinalization["references"];
  },
  nowMs: number,
) {
  if (!payload.summary.trim() || payload.sections.length === 0) {
    throw new Error("A provisional profile needs a summary and reusable reference sections.");
  }
  if (specialty === "behavioral" && payload.sections.some((section) => TRANSCRIPT_SECTION.test(section.title))) {
    throw new Error("Behavioral provisional profiles cannot contain a transcript.");
  }
  if (specialty !== "behavioral" && payload.projectDeepDive) {
    throw new Error("Project Deep Dive metadata is supported only for behavioral Solution Profiles.");
  }
  validatePracticeScenariosForSpecialty(specialty, payload.practiceScenarios);
  const db = getDb();
  const projectBinding = specialty === "behavioral"
    ? await readCurrentBehavioralProjectBinding(ownerId, questionId)
    : null;
  const projectMissing = specialty === "behavioral"
    ? projectProfileMissingRequirements(payload, projectBinding)
    : [];
  if (projectMissing.length) {
    throw new Error(`The provisional Project Deep Dive profile is incomplete; missing: ${projectMissing.join(", ")}.`);
  }
  const profile = normalizedSolutionProfile(payload, input.references ?? []);
  const [current, existing] = await Promise.all([
    db.select({ questionId: problemSolutionProfiles.questionId }).from(problemSolutionProfiles).where(and(
      eq(problemSolutionProfiles.ownerId, ownerId),
      eq(problemSolutionProfiles.specialty, specialty),
      eq(problemSolutionProfiles.questionId, questionId),
    )),
    db.select().from(provisionalSolutionProfiles).where(and(
      eq(provisionalSolutionProfiles.ownerId, ownerId),
      eq(provisionalSolutionProfiles.specialty, specialty),
      eq(provisionalSolutionProfiles.questionId, questionId),
    )),
  ]);
  if (current[0]) throw new Error("A finalized Solution Profile already exists; load and reuse or revise it.");
  if (existing[0]) {
    const existingPayload = existing[0].payload as NonNullable<SpecialistFinalization["solutionProfile"]>;
    if (profileFingerprint(existingPayload) === profileFingerprint(profile)) return;
    throw new Error("A provisional Solution Profile already exists; load it instead of replacing it.");
  }
  await db.insert(provisionalSolutionProfiles).values({
    ownerId,
    specialty,
    questionId,
    title,
    tags: profile.tags,
    payload: profile,
    preparedByActivityId: input.activityId ?? null,
    decision: input.decision ?? null,
    updatedAt: nowMs,
  });
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

const typedExchangeTurnSelection = {
  turnId: practiceTranscriptTurns.turnId,
  specialty: practiceTranscriptTurns.specialty,
  speaker: practiceTranscriptTurns.speaker,
  body: practiceTranscriptTurns.body,
  source: practiceTranscriptTurns.source,
  sequence: practiceTranscriptTurns.sequence,
  occurredAt: practiceTranscriptTurns.occurredAt,
  updatedAt: practiceTranscriptTurns.updatedAt,
};

function typedExchangeIdentityDeletedPredicate(
  ownerId: string,
  activityId: string,
  turnIds: string[],
) {
  return and(
    eq(typedPracticeExchangeDeletions.ownerId, ownerId),
    eq(typedPracticeExchangeDeletions.activityId, activityId),
    or(
      inArray(typedPracticeExchangeDeletions.userTurnId, turnIds),
      inArray(typedPracticeExchangeDeletions.responseTurnId, turnIds),
    ),
  );
}

function typedExchangeIdentityNotDeletedCondition(
  db: ReturnType<typeof getDb>,
  ownerId: string,
  activityId: string,
  turnIds: string[],
) {
  return notExists(db.select({ one: sql<number>`1` })
    .from(typedPracticeExchangeDeletions)
    .where(typedExchangeIdentityDeletedPredicate(ownerId, activityId, turnIds)));
}

function typedExchangeIdentityNotDeletedGuard(
  db: ReturnType<typeof getDb>,
  ownerId: string,
  activityId: string,
  turnIds: string[],
) {
  return d1TransactionalInvariantGuard(
    db,
    typedExchangeIdentityNotDeletedCondition(db, ownerId, activityId, turnIds),
  );
}

async function readTypedExchangePair(
  db: ReturnType<typeof getDb>,
  ownerId: string,
  activityId: string,
  userTurnId: string,
  responseTurnId?: string,
) {
  const userRows = await db.select(typedExchangeTurnSelection).from(practiceTranscriptTurns).where(and(
    eq(practiceTranscriptTurns.ownerId, ownerId),
    eq(practiceTranscriptTurns.activityId, activityId),
    eq(practiceTranscriptTurns.turnId, userTurnId),
  )).limit(1);
  const userTurn = userRows[0] as TypedExchangeTurn | undefined;
  if (!userTurn) return resolveTypedExchangePair([], userTurnId, responseTurnId);
  const responseRows = responseTurnId
    ? await db.select(typedExchangeTurnSelection).from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, activityId),
      eq(practiceTranscriptTurns.turnId, responseTurnId),
    )).limit(1)
    : await db.select(typedExchangeTurnSelection).from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, activityId),
      eq(practiceTranscriptTurns.sequence, userTurn.sequence + 1),
    ));
  return resolveTypedExchangePair(
    [userTurn, ...(responseRows as TypedExchangeTurn[]).filter((turn) => turn.turnId !== userTurnId)],
    userTurnId,
    responseTurnId,
  );
}

function typedExchangeDependencyPredicates(ownerId: string, activityId: string, turnIds: string[]) {
  return {
    codeAttempts: and(
      eq(leetcodeCodeAttempts.ownerId, ownerId),
      eq(leetcodeCodeAttempts.activityId, activityId),
      or(
        inArray(leetcodeCodeAttempts.originatingTurnId, turnIds),
        inArray(leetcodeCodeAttempts.reviewResponseTurnId, turnIds),
      ),
    ),
    reviewBackfills: and(
      eq(leetcodeCodeAttemptReviewBackfills.ownerId, ownerId),
      eq(leetcodeCodeAttemptReviewBackfills.activityId, activityId),
      inArray(leetcodeCodeAttemptReviewBackfills.reviewResponseTurnId, turnIds),
    ),
    audioClips: and(
      eq(activityAudioClips.ownerId, ownerId),
      eq(activityAudioClips.activityId, activityId),
      inArray(activityAudioClips.transcriptTurnId, turnIds),
    ),
    deliveryAnalyses: and(
      eq(activityDeliveryAnalyses.ownerId, ownerId),
      eq(activityDeliveryAnalyses.activityId, activityId),
      inArray(activityDeliveryAnalyses.transcriptTurnId, turnIds),
    ),
    voiceResponses: and(
      eq(voiceSpecialistResponses.ownerId, ownerId),
      eq(voiceSpecialistResponses.activityId, activityId),
      or(
        inArray(voiceSpecialistResponses.userTurnId, turnIds),
        inArray(voiceSpecialistResponses.responseTurnId, turnIds),
      ),
    ),
    voiceGroupMembers: and(
      eq(voiceResponseGroupMembers.ownerId, ownerId),
      eq(voiceResponseGroupMembers.activityId, activityId),
      or(
        inArray(voiceResponseGroupMembers.userTurnId, turnIds),
        inArray(voiceResponseGroupMembers.responseTurnId, turnIds),
      ),
    ),
    voiceGroups: and(
      eq(voiceResponseGroups.ownerId, ownerId),
      eq(voiceResponseGroups.activityId, activityId),
      inArray(voiceResponseGroups.responseTurnId, turnIds),
    ),
    voiceRepairEvents: and(
      eq(voiceResponseGroupRepairEvents.ownerId, ownerId),
      eq(voiceResponseGroupRepairEvents.activityId, activityId),
      inArray(voiceResponseGroupRepairEvents.responseTurnId, turnIds),
    ),
    voiceReservations: and(
      eq(voiceExchangeReservations.ownerId, ownerId),
      or(
        inArray(voiceExchangeReservations.identity, turnIds),
        inArray(voiceExchangeReservations.responseTurnId, turnIds),
      ),
    ),
    finalizations: and(
      eq(activityFinalizations.ownerId, ownerId),
      eq(activityFinalizations.activityId, activityId),
      inArray(activityFinalizations.status, ["ready", "published"]),
    ),
    liveReservations: and(
      eq(liveTurnReservations.ownerId, ownerId),
      eq(liveTurnReservations.activityId, activityId),
      inArray(liveTurnReservations.turnId, turnIds),
    ),
  };
}

type ActivityTranscriptState = { turnCount: number; deletionCount: number };

async function readActivityTranscriptState(
  db: ReturnType<typeof getDb>,
  ownerId: string,
  activityId: string,
): Promise<ActivityTranscriptState> {
  const [turnRows, deletionRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, activityId),
    )),
    db.select({ count: sql<number>`count(*)` }).from(typedPracticeExchangeDeletions).where(and(
      eq(typedPracticeExchangeDeletions.ownerId, ownerId),
      eq(typedPracticeExchangeDeletions.activityId, activityId),
    )),
  ]);
  return { turnCount: turnRows[0]?.count ?? 0, deletionCount: deletionRows[0]?.count ?? 0 };
}

function exactActivityTranscriptStateCondition(
  ownerId: string,
  activityId: string,
  state: ActivityTranscriptState,
) {
  return sql`(
    SELECT count(*) FROM ${practiceTranscriptTurns}
    WHERE ${practiceTranscriptTurns.ownerId} = ${ownerId}
      AND ${practiceTranscriptTurns.activityId} = ${activityId}
  ) = ${state.turnCount} AND (
    SELECT count(*) FROM ${typedPracticeExchangeDeletions}
    WHERE ${typedPracticeExchangeDeletions.ownerId} = ${ownerId}
      AND ${typedPracticeExchangeDeletions.activityId} = ${activityId}
  ) = ${state.deletionCount}`;
}

export async function appendTranscriptTurns(
  ownerId: string,
  activityId: string,
  specialty: Specialty,
  turns: Array<{
    turnId: string;
    speaker: TranscriptSpeaker;
    body: string;
    source?: TranscriptSource;
    sequence: number;
    occurredAt: number;
  }>,
  nowMs: number,
) {
  const db = getDb();
  const orderedTurns = orderContiguousTurns(turns);
  if (!orderedTurns.contiguous) {
    throw new Error("Transcript turn sequences must be unique, contiguous, and ordered by their stable sequence.");
  }
  for (const turn of orderedTurns.ordered) {
    const existing = (await db.select().from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, activityId),
      eq(practiceTranscriptTurns.turnId, turn.turnId),
    )))[0];
    if (existing) {
      if (existing.specialty !== specialty
          || existing.speaker !== turn.speaker
          || existing.body !== turn.body
          || existing.source !== (turn.source ?? "codex")
          || existing.sequence !== turn.sequence
          || existing.occurredAt !== turn.occurredAt) {
        throw new Error("A stable transcript turnId cannot be rewritten with different content or identity.");
      }
      try {
        await db.batch([typedExchangeIdentityNotDeletedGuard(db, ownerId, activityId, [turn.turnId])]);
      } catch (error) {
        if (isD1TransactionalInvariantFailure(error)) {
          throw new TypedExchangeDeletionError(
            "typed_exchange_identity_deleted",
            "A deleted typed exchange cannot be recreated through transcript append.",
          );
        }
        throw error;
      }
      continue;
    }
    try {
      await db.batch([
        typedExchangeIdentityNotDeletedGuard(db, ownerId, activityId, [turn.turnId]),
        db.insert(practiceTranscriptTurns).values({
        ownerId,
        activityId,
        turnId: turn.turnId,
        specialty,
        speaker: turn.speaker,
        body: turn.body,
        source: turn.source ?? "codex",
        sequence: turn.sequence,
        occurredAt: turn.occurredAt,
        updatedAt: nowMs,
        }).onConflictDoNothing(),
      ]);
    } catch (error) {
      if (isD1TransactionalInvariantFailure(error)) {
        throw new TypedExchangeDeletionError(
          "typed_exchange_identity_deleted",
          "A deleted typed exchange cannot be recreated through transcript append.",
        );
      }
      throw error;
    }
    const stored = (await db.select().from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, activityId),
      eq(practiceTranscriptTurns.turnId, turn.turnId),
    )))[0];
    if (!stored
        || stored.specialty !== specialty
        || stored.speaker !== turn.speaker
        || stored.body !== turn.body
        || stored.source !== (turn.source ?? "codex")
        || stored.sequence !== turn.sequence
        || stored.occurredAt !== turn.occurredAt) {
      throw new Error("A stable transcript turnId conflicts with another durable exchange.");
    }
  }
}

export async function saveTypedPracticeExchange(
  ownerId: string,
  input: {
    activityId: string;
    specialty: Specialty;
    userTurn: {
      turnId: string;
      body: string;
      occurredAt: number;
    };
    specialistTurn: {
      turnId: string;
      body: string;
      occurredAt: number;
    };
  },
  nowMs: number,
) {
  if (input.userTurn.turnId === input.specialistTurn.turnId) {
    throw new Error("The user and specialist turns require different stable turn IDs.");
  }
  const db = getDb();
  const requestedIds = [input.userTurn.turnId, input.specialistTurn.turnId];
  const deletedIdentity = await db.select({ operationId: typedPracticeExchangeDeletions.operationId })
    .from(typedPracticeExchangeDeletions)
    .where(typedExchangeIdentityDeletedPredicate(ownerId, input.activityId, requestedIds));
  if (deletedIdentity.length) {
    throw new TypedExchangeDeletionError(
      "typed_exchange_identity_deleted",
      "A deleted typed exchange cannot be recreated with the same stable turn IDs.",
      { operationId: deletedIdentity[0]?.operationId },
    );
  }
  const existing = await db.select().from(practiceTranscriptTurns).where(and(
    eq(practiceTranscriptTurns.ownerId, ownerId),
    eq(practiceTranscriptTurns.activityId, input.activityId),
    inArray(practiceTranscriptTurns.turnId, requestedIds),
  ));
  const latest = await db
    .select({ sequence: practiceTranscriptTurns.sequence })
    .from(practiceTranscriptTurns)
    .where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, input.activityId),
    ))
    .orderBy(desc(practiceTranscriptTurns.sequence))
    .limit(1);
  const firstSequence = existing.length
    ? Math.min(...existing.map((turn) => turn.sequence))
    : (latest[0]?.sequence ?? -1) + 1;
  const values = [
    {
      ownerId,
      activityId: input.activityId,
      turnId: input.userTurn.turnId,
      specialty: input.specialty,
      speaker: "user" as const,
      body: input.userTurn.body,
      source: "codex" as const,
      sequence: firstSequence,
      occurredAt: input.userTurn.occurredAt,
      updatedAt: nowMs,
    },
    {
      ownerId,
      activityId: input.activityId,
      turnId: input.specialistTurn.turnId,
      specialty: input.specialty,
      speaker: "specialist" as const,
      body: input.specialistTurn.body,
      source: "codex" as const,
      sequence: firstSequence + 1,
      occurredAt: input.specialistTurn.occurredAt,
      updatedAt: nowMs,
    },
  ];
  const identityNotDeletedGuard = typedExchangeIdentityNotDeletedGuard(
    db,
    ownerId,
    input.activityId,
    requestedIds,
  );
  try {
    await db.batch([
      identityNotDeletedGuard,
      db.insert(practiceTranscriptTurns).values(values[0]).onConflictDoNothing(),
      db.insert(practiceTranscriptTurns).values(values[1]).onConflictDoNothing(),
    ]);
  } catch (error) {
    if (isD1TransactionalInvariantFailure(error)) {
      throw new TypedExchangeDeletionError(
        "typed_exchange_identity_deleted",
        "A deleted typed exchange cannot be recreated with the same stable turn IDs.",
      );
    }
    throw error;
  }
  const stored = await db.select().from(practiceTranscriptTurns).where(and(
    eq(practiceTranscriptTurns.ownerId, ownerId),
    eq(practiceTranscriptTurns.activityId, input.activityId),
    inArray(practiceTranscriptTurns.turnId, requestedIds),
  ));
  const matches = values.every((value) => stored.some((turn) =>
    turn.turnId === value.turnId
    && turn.specialty === value.specialty
    && turn.speaker === value.speaker
    && turn.body === value.body
    && turn.source === value.source
    && turn.sequence === value.sequence
    && turn.occurredAt === value.occurredAt));
  if (!matches || stored.length !== 2) {
    throw new Error("A typed practice exchange conflicts with an existing stable turn ID.");
  }
  return {
    duplicate: existing.length === 2,
    userTurn: stored.find((turn) => turn.turnId === input.userTurn.turnId)!,
    specialistTurn: stored.find((turn) => turn.turnId === input.specialistTurn.turnId)!,
  };
}

export type TypedExchangeDeletionReceipt = {
  status: "deleted";
  operationId: string;
  activityId: string;
  userTurnId: string;
  responseTurnId: string;
  deletedTurnIds: string[];
  preserved: ["activity", "timer", "session", "result", "notes", "code_attempts", "voice_evidence"];
  deletedAt: number;
  duplicate: boolean;
};

function storedTypedExchangeDeletionReceipt(
  row: typeof typedPracticeExchangeDeletions.$inferSelect,
  duplicate: boolean,
) {
  return {
    ...(row.receipt as Omit<TypedExchangeDeletionReceipt, "duplicate">),
    duplicate,
  };
}

export async function deleteTypedPracticeExchange(
  ownerId: string,
  input: {
    operationId: string;
    activityId: string;
    userTurnId: string;
    responseTurnId?: string;
    expectedRevision: number;
    authorization: "explicit_user_instruction";
    reason: string;
  },
  nowMs: number,
): Promise<TypedExchangeDeletionReceipt> {
  if (input.authorization !== "explicit_user_instruction") {
    throw new TypedExchangeDeletionError(
      "typed_exchange_authorization_required",
      "Typed exchange deletion requires the explicit user authorization literal.",
    );
  }
  const reason = input.reason.trim();
  if (!reason) {
    throw new TypedExchangeDeletionError(
      "typed_exchange_reason_required",
      "Typed exchange deletion requires a non-empty audit reason.",
    );
  }
  const db = getDb();
  const requestFingerprint = await typedExchangeDeletionFingerprint({ ...input, reason });
  const operationRows = await db.select().from(typedPracticeExchangeDeletions).where(and(
    eq(typedPracticeExchangeDeletions.ownerId, ownerId),
    eq(typedPracticeExchangeDeletions.operationId, input.operationId),
  ));
  if (operationRows[0]) {
    if (operationRows[0].requestFingerprint !== requestFingerprint) {
      throw new TypedExchangeDeletionError(
        "typed_exchange_operation_conflict",
        "That deletion operation ID was already used with a different immutable payload.",
        { operationId: input.operationId },
      );
    }
    return storedTypedExchangeDeletionReceipt(operationRows[0], true);
  }

  const priorDeletionRows = await db.select().from(typedPracticeExchangeDeletions).where(
    typedExchangeIdentityDeletedPredicate(
      ownerId,
      input.activityId,
      [input.userTurnId, ...(input.responseTurnId ? [input.responseTurnId] : [])],
    ),
  );
  if (priorDeletionRows[0]) {
    throw new TypedExchangeDeletionError(
      "typed_exchange_already_deleted",
      "That typed exchange was already deleted; use its original stable operation ID for an exact retry.",
      {
        existingOperationId: priorDeletionRows[0].operationId,
        receipt: storedTypedExchangeDeletionReceipt(priorDeletionRows[0], true),
      },
    );
  }

  const pair = await readTypedExchangePair(
    db,
    ownerId,
    input.activityId,
    input.userTurnId,
    input.responseTurnId,
  );
  if (pair.revision !== input.expectedRevision) {
    throw new TypedExchangeDeletionError(
      "typed_exchange_revision_conflict",
      `The typed exchange changed from revision ${input.expectedRevision} to ${pair.revision}; read the activity record before retrying.`,
      { expectedRevision: input.expectedRevision, actualRevision: pair.revision },
    );
  }
  const turnIds = [pair.userTurn.turnId, pair.responseTurn.turnId];
  const dependencyPredicates = typedExchangeDependencyPredicates(ownerId, input.activityId, turnIds);
  const [
    codeAttempts,
    reviewBackfills,
    audioClips,
    deliveryAnalyses,
    voiceResponses,
    voiceGroupMembers,
    voiceGroups,
    voiceRepairEvents,
    voiceReservations,
    finalizations,
    liveReservations,
  ] = await Promise.all([
    db.select({ id: leetcodeCodeAttempts.id }).from(leetcodeCodeAttempts)
      .where(dependencyPredicates.codeAttempts),
    db.select({ attemptId: leetcodeCodeAttemptReviewBackfills.attemptId })
      .from(leetcodeCodeAttemptReviewBackfills)
      .where(dependencyPredicates.reviewBackfills),
    db.select({ id: activityAudioClips.id }).from(activityAudioClips)
      .where(dependencyPredicates.audioClips),
    db.select({ id: activityDeliveryAnalyses.id }).from(activityDeliveryAnalyses)
      .where(dependencyPredicates.deliveryAnalyses),
    db.select({ captureId: voiceSpecialistResponses.captureId }).from(voiceSpecialistResponses)
      .where(dependencyPredicates.voiceResponses),
    db.select({ captureId: voiceResponseGroupMembers.captureId }).from(voiceResponseGroupMembers)
      .where(dependencyPredicates.voiceGroupMembers),
    db.select({ responseTurnId: voiceResponseGroups.responseTurnId }).from(voiceResponseGroups)
      .where(dependencyPredicates.voiceGroups),
    db.select({ id: voiceResponseGroupRepairEvents.id }).from(voiceResponseGroupRepairEvents)
      .where(dependencyPredicates.voiceRepairEvents),
    db.select({ identity: voiceExchangeReservations.identity }).from(voiceExchangeReservations)
      .where(dependencyPredicates.voiceReservations),
    db.select({ status: activityFinalizations.status }).from(activityFinalizations)
      .where(dependencyPredicates.finalizations),
    db.select({ turnId: liveTurnReservations.turnId }).from(liveTurnReservations)
      .where(dependencyPredicates.liveReservations),
  ]);
  const dependentCounts = {
    codeAttempts: codeAttempts.length + reviewBackfills.length,
    audio: audioClips.length + deliveryAnalyses.length,
    voice: voiceResponses.length + voiceGroupMembers.length + voiceGroups.length
      + voiceRepairEvents.length + voiceReservations.length,
    finalized: finalizations.length,
    live: liveReservations.length,
  };
  if (Object.values(dependentCounts).some((count) => count > 0)) {
    throw new TypedExchangeDeletionError(
      "typed_exchange_has_dependent_evidence",
      "The typed exchange owns or anchors durable evidence and cannot be deleted without corrupting another record.",
      dependentCounts,
    );
  }

  const receipt: Omit<TypedExchangeDeletionReceipt, "duplicate"> = {
    status: "deleted",
    operationId: input.operationId,
    activityId: input.activityId,
    userTurnId: pair.userTurn.turnId,
    responseTurnId: pair.responseTurn.turnId,
    deletedTurnIds: turnIds,
    preserved: ["activity", "timer", "session", "result", "notes", "code_attempts", "voice_evidence"],
    deletedAt: nowMs,
  };
  const noDependentEvidenceCondition = and(
    notExists(db.select({ one: sql<number>`1` }).from(leetcodeCodeAttempts)
      .where(dependencyPredicates.codeAttempts)),
    notExists(db.select({ one: sql<number>`1` }).from(leetcodeCodeAttemptReviewBackfills)
      .where(dependencyPredicates.reviewBackfills)),
    notExists(db.select({ one: sql<number>`1` }).from(activityAudioClips)
      .where(dependencyPredicates.audioClips)),
    notExists(db.select({ one: sql<number>`1` }).from(activityDeliveryAnalyses)
      .where(dependencyPredicates.deliveryAnalyses)),
    notExists(db.select({ one: sql<number>`1` }).from(voiceSpecialistResponses)
      .where(dependencyPredicates.voiceResponses)),
    notExists(db.select({ one: sql<number>`1` }).from(voiceResponseGroupMembers)
      .where(dependencyPredicates.voiceGroupMembers)),
    notExists(db.select({ one: sql<number>`1` }).from(voiceResponseGroups)
      .where(dependencyPredicates.voiceGroups)),
    notExists(db.select({ one: sql<number>`1` }).from(voiceResponseGroupRepairEvents)
      .where(dependencyPredicates.voiceRepairEvents)),
    notExists(db.select({ one: sql<number>`1` }).from(voiceExchangeReservations)
      .where(dependencyPredicates.voiceReservations)),
    notExists(db.select({ one: sql<number>`1` }).from(activityFinalizations)
      .where(dependencyPredicates.finalizations)),
    notExists(db.select({ one: sql<number>`1` }).from(liveTurnReservations)
      .where(dependencyPredicates.liveReservations)),
  )!;
  const exactPairGuard = d1TransactionalInvariantGuard(db, sql`(
    SELECT count(*) FROM ${practiceTranscriptTurns}
    WHERE ${practiceTranscriptTurns.ownerId} = ${ownerId}
      AND ${practiceTranscriptTurns.activityId} = ${input.activityId}
      AND (
        (
          ${practiceTranscriptTurns.turnId} = ${pair.userTurn.turnId}
          AND ${practiceTranscriptTurns.specialty} = ${pair.userTurn.specialty}
          AND ${practiceTranscriptTurns.speaker} = 'user'
          AND ${practiceTranscriptTurns.source} = 'codex'
          AND ${practiceTranscriptTurns.body} = ${pair.userTurn.body}
          AND ${practiceTranscriptTurns.sequence} = ${pair.userTurn.sequence}
          AND ${practiceTranscriptTurns.occurredAt} = ${pair.userTurn.occurredAt}
          AND ${practiceTranscriptTurns.updatedAt} = ${pair.userTurn.updatedAt}
        ) OR (
          ${practiceTranscriptTurns.turnId} = ${pair.responseTurn.turnId}
          AND ${practiceTranscriptTurns.specialty} = ${pair.responseTurn.specialty}
          AND ${practiceTranscriptTurns.speaker} = 'specialist'
          AND ${practiceTranscriptTurns.source} = 'codex'
          AND ${practiceTranscriptTurns.body} = ${pair.responseTurn.body}
          AND ${practiceTranscriptTurns.sequence} = ${pair.responseTurn.sequence}
          AND ${practiceTranscriptTurns.occurredAt} = ${pair.responseTurn.occurredAt}
          AND ${practiceTranscriptTurns.updatedAt} = ${pair.responseTurn.updatedAt}
        )
      )
  ) = 2 AND NOT EXISTS (
    SELECT 1 FROM ${typedPracticeExchangeDeletions}
    WHERE ${typedPracticeExchangeDeletions.ownerId} = ${ownerId}
      AND ${typedPracticeExchangeDeletions.operationId} = ${input.operationId}
  ) AND ${typedExchangeIdentityNotDeletedCondition(db, ownerId, input.activityId, turnIds)}
    AND ${noDependentEvidenceCondition}`);
  try {
    await db.batch([
      exactPairGuard,
      db.delete(practiceTranscriptTurns).where(and(
        eq(practiceTranscriptTurns.ownerId, ownerId),
        eq(practiceTranscriptTurns.activityId, input.activityId),
        inArray(practiceTranscriptTurns.turnId, turnIds),
      )),
      db.insert(typedPracticeExchangeDeletions).values({
        ownerId,
        operationId: input.operationId,
        activityId: input.activityId,
        userTurnId: pair.userTurn.turnId,
        responseTurnId: pair.responseTurn.turnId,
        specialty: pair.userTurn.specialty as Specialty,
        expectedRevision: pair.revision,
        requestFingerprint,
        reason: reason.slice(0, 2_000),
        receipt,
        deletedAt: nowMs,
      }),
    ]);
  } catch (error) {
    const [racedOperations, racedIdentities] = await Promise.all([
      db.select().from(typedPracticeExchangeDeletions).where(and(
        eq(typedPracticeExchangeDeletions.ownerId, ownerId),
        eq(typedPracticeExchangeDeletions.operationId, input.operationId),
      )),
      db.select().from(typedPracticeExchangeDeletions).where(
        typedExchangeIdentityDeletedPredicate(ownerId, input.activityId, turnIds),
      ),
    ]);
    const racedOperation = racedOperations[0];
    if (racedOperation?.requestFingerprint === requestFingerprint) {
      return storedTypedExchangeDeletionReceipt(racedOperation, true);
    }
    if (racedOperation) {
      throw new TypedExchangeDeletionError(
        "typed_exchange_operation_conflict",
        "That deletion operation ID was concurrently used with a different immutable payload.",
        { operationId: input.operationId },
      );
    }
    const racedIdentity = racedIdentities[0];
    if (racedIdentity) {
      throw new TypedExchangeDeletionError(
        "typed_exchange_already_deleted",
        "That typed exchange was concurrently deleted by another stable operation.",
        {
          existingOperationId: racedIdentity.operationId,
          receipt: storedTypedExchangeDeletionReceipt(racedIdentity, true),
        },
      );
    }
    if (isD1TransactionalInvariantFailure(error)) {
      throw new TypedExchangeDeletionError(
        "typed_exchange_changed",
        "The exchange or one of its dependent evidence records changed during deletion; nothing was removed.",
      );
    }
    if (String(error).toLowerCase().includes("unique constraint")) {
      throw new TypedExchangeDeletionError(
        "typed_exchange_deletion_conflict",
        "That operation or exchange identity already belongs to a different deletion receipt.",
      );
    }
    throw error;
  }
  return { ...receipt, duplicate: false };
}

// The native voice bridge owns the stable turn id and writes the transcript
// before opening the Codex turn. This makes recording delivery idempotent and
// lets an R2 clip reference the user turn without waiting for the specialist.
export async function appendVoiceTranscriptTurn(
  ownerId: string,
  input: {
    activityId: string;
    specialty: Specialty;
    turnId: string;
    body: string;
    occurredAt: number;
  },
  nowMs: number,
) {
  const db = getDb();
  const existing = await db.select().from(practiceTranscriptTurns).where(and(
    eq(practiceTranscriptTurns.ownerId, ownerId),
    eq(practiceTranscriptTurns.activityId, input.activityId),
    eq(practiceTranscriptTurns.turnId, input.turnId),
  ));
  const latest = await db
    .select({ sequence: practiceTranscriptTurns.sequence })
    .from(practiceTranscriptTurns)
    .where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, input.activityId),
    ))
    .orderBy(desc(practiceTranscriptTurns.sequence))
    .limit(1);
  const sequence = existing[0]?.sequence ?? (latest[0]?.sequence ?? -1) + 1;
  await appendTranscriptTurns(ownerId, input.activityId, input.specialty, [{
    turnId: input.turnId,
    speaker: "user",
    body: input.body,
    source: "audio_transcript",
    sequence,
    occurredAt: input.occurredAt,
  }], nowMs);
  return { ...input, speaker: "user" as const, source: "audio_transcript" as const, sequence };
}

export async function registerVoiceCaptureIntent(
  ownerId: string,
  input: {
    captureId: string;
    activityId: string;
    turnId: string;
    clipId: string;
    specialty: Specialty;
    checksum: string;
    occurredAt: number;
  },
  nowMs: number,
) {
  const db = getDb();
  await purgeExpiredDeferredVoiceCaptureDecisions(ownerId, nowMs);
  const existing = await readVoiceCaptureIntent(ownerId, input.captureId);
  if (existing) {
    if (existing.activityId !== input.activityId
        || existing.turnId !== input.turnId
        || existing.clipId !== input.clipId
        || existing.specialty !== input.specialty
        || existing.checksum !== input.checksum
        || existing.occurredAt !== input.occurredAt) {
      throw new Error("A captureId cannot be rebound to different voice content or activity.");
    }
    return existing;
  }
  await db.insert(voiceCaptureIntents).values({
    ownerId,
    ...input,
    status: "pending",
    createdAt: nowMs,
    updatedAt: nowMs,
  }).onConflictDoNothing();
  const deferred = (await db.select().from(deferredVoiceCaptureDecisions).where(and(
    eq(deferredVoiceCaptureDecisions.ownerId, ownerId),
    eq(deferredVoiceCaptureDecisions.captureId, input.captureId),
  )))[0];
  if (deferred) {
    if (deferred.expiresAt <= nowMs) {
      await db.delete(deferredVoiceCaptureDecisions).where(and(
        eq(deferredVoiceCaptureDecisions.ownerId, ownerId),
        eq(deferredVoiceCaptureDecisions.captureId, input.captureId),
      ));
    } else if (deferred.activityId === input.activityId && deferred.turnId === input.turnId) {
      await applyVoiceCaptureDecision(
        ownerId,
        input.captureId,
        deferred.decision,
        deferred.decisionSource,
        deferred.decisionReason,
        nowMs,
      );
      await db.delete(deferredVoiceCaptureDecisions).where(and(
        eq(deferredVoiceCaptureDecisions.ownerId, ownerId),
        eq(deferredVoiceCaptureDecisions.captureId, input.captureId),
      ));
    } else {
      throw new Error("A deferred voice decision does not match the registered capture identity.");
    }
  }
  return readVoiceCaptureIntent(ownerId, input.captureId);
}

export async function readVoiceCaptureIntent(ownerId: string, captureId: string) {
  const db = getDb();
  const rows = await db.select().from(voiceCaptureIntents).where(and(
    eq(voiceCaptureIntents.ownerId, ownerId),
    eq(voiceCaptureIntents.captureId, captureId),
  ));
  return rows[0] ?? null;
}

export async function readVoiceCaptureIntents(ownerId: string, captureIds?: string[]) {
  const db = getDb();
  if (captureIds && captureIds.length === 0) return [];
  return db.select().from(voiceCaptureIntents).where(
    captureIds
      ? and(eq(voiceCaptureIntents.ownerId, ownerId), inArray(voiceCaptureIntents.captureId, captureIds))
      : eq(voiceCaptureIntents.ownerId, ownerId),
  );
}

export async function expireUnclassifiedVoiceCapture(
  ownerId: string,
  captureId: string,
  nowMs: number,
  expectedIdentity?: { activityId: string; turnId: string },
) {
  const db = getDb();
  const existing = await readVoiceCaptureIntent(ownerId, captureId);
  if (!existing) throw new Error("The voice capture is unavailable or already resolved.");
  if (expectedIdentity
      && (existing.activityId !== expectedIdentity.activityId || existing.turnId !== expectedIdentity.turnId)) {
    throw new Error("The capture envelope does not match the registered owner-scoped intent.");
  }
  if (existing.status === "expired_unclassified") return existing;
  if (existing.status !== "pending") {
    throw new Error("Only an untouched pending capture can expire without a specialist decision.");
  }
  await db.batch([
    db.update(voiceCaptureIntents).set({
      status: "expired_unclassified",
      decisionSource: "voice-expiry",
      decisionReason: "The local unclassified capture reached its retention limit.",
      decidedAt: nowMs,
      updatedAt: nowMs,
    }).where(and(
      eq(voiceCaptureIntents.ownerId, ownerId),
      eq(voiceCaptureIntents.captureId, captureId),
      eq(voiceCaptureIntents.status, "pending"),
    )),
    db.update(voiceSpecialistResponses).set({
      status: "discarded",
      updatedAt: nowMs,
    }).where(and(
      eq(voiceSpecialistResponses.ownerId, ownerId),
      eq(voiceSpecialistResponses.captureId, captureId),
      eq(voiceSpecialistResponses.status, "provisional"),
    )),
  ]);
  return readVoiceCaptureIntent(ownerId, captureId);
}

export async function readVoiceCaptureIntentsPage(
  ownerId: string,
  {
    statuses,
    cursorUpdatedAt,
    cursorCaptureId,
    limit,
  }: {
    statuses?: Array<"pending" | "activity_related" | "accepted" | "unrelated" | "uncertain" | "deleting" | "deleted">;
    cursorUpdatedAt?: number;
    cursorCaptureId?: string;
    limit: number;
  },
) {
  const db = getDb();
  const afterCursor = cursorUpdatedAt !== undefined && cursorCaptureId
    ? or(
      gt(voiceCaptureIntents.updatedAt, cursorUpdatedAt),
      and(
        eq(voiceCaptureIntents.updatedAt, cursorUpdatedAt),
        gt(voiceCaptureIntents.captureId, cursorCaptureId),
      ),
    )
    : undefined;
  return db.select().from(voiceCaptureIntents).where(and(
    eq(voiceCaptureIntents.ownerId, ownerId),
    statuses?.length ? inArray(voiceCaptureIntents.status, statuses) : undefined,
    afterCursor,
  )).orderBy(asc(voiceCaptureIntents.updatedAt), asc(voiceCaptureIntents.captureId)).limit(limit);
}

export async function readLikelyLegacyVoiceOrphans(ownerId: string) {
  const db = getDb();
  const [clips, turns, intents] = await Promise.all([
    db.select().from(activityAudioClips).where(and(
      eq(activityAudioClips.ownerId, ownerId),
      isNotNull(activityAudioClips.transcriptTurnId),
    )),
    db.select().from(practiceTranscriptTurns).where(eq(practiceTranscriptTurns.ownerId, ownerId)),
    db.select().from(voiceCaptureIntents).where(eq(voiceCaptureIntents.ownerId, ownerId)),
  ]);
  const intentClipIds = new Set(intents.map((intent) => intent.clipId));
  const orderedByActivity = new Map<string, typeof turns>();
  turns.forEach((turn) => {
    orderedByActivity.set(turn.activityId, [...(orderedByActivity.get(turn.activityId) ?? []), turn]);
  });
  orderedByActivity.forEach((activityTurns) => activityTurns.sort((a, b) => a.sequence - b.sequence));
  return clips.flatMap((clip) => {
    if (!clip.transcriptTurnId || intentClipIds.has(clip.id)) return [];
    const activityTurns = orderedByActivity.get(clip.activityId) ?? [];
    const turn = activityTurns.find((candidate) => candidate.turnId === clip.transcriptTurnId);
    if (!turn || turn.source !== "audio_transcript") return [];
    const following = activityTurns.filter((candidate) => candidate.sequence > turn.sequence);
    const beforeNextUser = following.slice(0, following.findIndex((candidate) => candidate.speaker === "user") < 0
      ? following.length
      : following.findIndex((candidate) => candidate.speaker === "user"));
    if (beforeNextUser.some((candidate) => candidate.speaker === "specialist")) return [];
    return [{
      clipId: clip.id,
      activityId: clip.activityId,
      turnId: turn.turnId,
      occurredAt: turn.occurredAt,
      excerpt: turn.body.slice(0, 240),
      durationSeconds: clip.durationSeconds,
      status: clip.status,
    }];
  });
}

export async function prepareLegacyVoiceCaptureDeletion(
  ownerId: string,
  clipId: string,
  nowMs: number,
) {
  const db = getDb();
  const existingIntent = (await db.select().from(voiceCaptureIntents).where(and(
    eq(voiceCaptureIntents.ownerId, ownerId),
    eq(voiceCaptureIntents.clipId, clipId),
  )))[0];
  if (existingIntent) return existingIntent;
  const clip = await readActivityAudioClip(ownerId, clipId);
  if (!clip?.transcriptTurnId) throw new Error("Legacy Voice capture not found.");
  const turn = (await db.select().from(practiceTranscriptTurns).where(and(
    eq(practiceTranscriptTurns.ownerId, ownerId),
    eq(practiceTranscriptTurns.activityId, clip.activityId),
    eq(practiceTranscriptTurns.turnId, clip.transcriptTurnId),
  )))[0];
  if (!turn || turn.source !== "audio_transcript") throw new Error("Legacy Voice transcript not found.");
  const captureId = `legacy-${clip.id}`;
  await db.insert(voiceCaptureIntents).values({
    ownerId,
    captureId,
    activityId: clip.activityId,
    turnId: turn.turnId,
    clipId: clip.id,
    specialty: turn.specialty,
    status: "deleting",
    checksum: "legacy-accepted",
    occurredAt: turn.occurredAt,
    decidedAt: nowMs,
    decisionSource: "voice-user",
    decisionReason: "User deleted a legacy Voice capture from the review list.",
    createdAt: nowMs,
    updatedAt: nowMs,
  });
  return readVoiceCaptureIntent(ownerId, captureId);
}

export async function resolveVoiceCaptureIntent(
  ownerId: string,
  captureId: string,
  decision: VoiceCaptureDecision,
  source: string,
  reason: string,
  nowMs: number,
  expectedIdentity?: { activityId: string; turnId: string },
) {
  const db = getDb();
  await purgeExpiredDeferredVoiceCaptureDecisions(ownerId, nowMs);
  const existing = await readVoiceCaptureIntent(ownerId, captureId);
  if (!existing) {
    if (!expectedIdentity?.activityId || !expectedIdentity.turnId) {
      throw new Error("The voice capture is unavailable or already resolved.");
    }
    await db.insert(deferredVoiceCaptureDecisions).values({
      ownerId,
      captureId,
      activityId: expectedIdentity.activityId,
      turnId: expectedIdentity.turnId,
      decision,
      decisionSource: source.slice(0, 80),
      decisionReason: reason.slice(0, 2_000),
      expiresAt: nowMs + 86_400_000,
      createdAt: nowMs,
      updatedAt: nowMs,
    }).onConflictDoUpdate({
      target: [deferredVoiceCaptureDecisions.ownerId, deferredVoiceCaptureDecisions.captureId],
      set: {
        activityId: expectedIdentity.activityId,
        turnId: expectedIdentity.turnId,
        decision,
        decisionSource: source.slice(0, 80),
        decisionReason: reason.slice(0, 2_000),
        expiresAt: nowMs + 86_400_000,
        updatedAt: nowMs,
      },
    });
    // Close the narrow race where registration completed after the initial
    // read but before the deferred row was written.
    const registered = await readVoiceCaptureIntent(ownerId, captureId);
    if (registered) {
      if (registered.activityId !== expectedIdentity.activityId || registered.turnId !== expectedIdentity.turnId) {
        throw new Error("The capture envelope does not match the registered owner-scoped intent.");
      }
      const resolved = await applyVoiceCaptureDecision(ownerId, captureId, decision, source, reason, nowMs);
      await db.delete(deferredVoiceCaptureDecisions).where(and(
        eq(deferredVoiceCaptureDecisions.ownerId, ownerId),
        eq(deferredVoiceCaptureDecisions.captureId, captureId),
      ));
      return resolved;
    }
    return {
      captureId,
      activityId: expectedIdentity.activityId,
      turnId: expectedIdentity.turnId,
      status: decision,
      deferred: true,
    };
  }
  if (expectedIdentity
      && (existing.activityId !== expectedIdentity.activityId || existing.turnId !== expectedIdentity.turnId)) {
    throw new Error("The capture envelope does not match the registered owner-scoped intent.");
  }
  return applyVoiceCaptureDecision(ownerId, captureId, decision, source, reason, nowMs);
}

async function purgeExpiredDeferredVoiceCaptureDecisions(ownerId: string, nowMs: number) {
  const db = getDb();
  const expired = await db.select({ captureId: deferredVoiceCaptureDecisions.captureId })
    .from(deferredVoiceCaptureDecisions)
    .where(and(
      eq(deferredVoiceCaptureDecisions.ownerId, ownerId),
      lt(deferredVoiceCaptureDecisions.expiresAt, nowMs),
    ));
  const captureIds = expired.map((decision) => decision.captureId);
  if (!captureIds.length) return;
  await db.batch([
    db.update(voiceSpecialistResponses).set({
      status: "discarded",
      updatedAt: nowMs,
    }).where(and(
      eq(voiceSpecialistResponses.ownerId, ownerId),
      inArray(voiceSpecialistResponses.captureId, captureIds),
      eq(voiceSpecialistResponses.status, "provisional"),
    )),
    db.delete(deferredVoiceCaptureDecisions).where(and(
    eq(deferredVoiceCaptureDecisions.ownerId, ownerId),
      inArray(deferredVoiceCaptureDecisions.captureId, captureIds),
    )),
  ]);
}

async function applyVoiceCaptureDecision(
  ownerId: string,
  captureId: string,
  decision: VoiceCaptureDecision,
  source: string,
  reason: string,
  nowMs: number,
) {
  const db = getDb();
  const existing = await readVoiceCaptureIntent(ownerId, captureId);
  if (!existing) throw new Error("The voice capture is unavailable or already resolved.");
  if (existing.status === decision
      || (existing.status === "accepted" && decision === "activity_related")
      || (existing.status === "deleted" && decision === "unrelated")) {
    return existing;
  }
  if (!["pending", "uncertain"].includes(existing.status)) {
    throw new Error("The voice capture is unavailable or already resolved.");
  }
  await db.update(voiceCaptureIntents).set({
    status: decision,
    decisionSource: source.slice(0, 80),
    decisionReason: reason.slice(0, 2_000),
    decidedAt: nowMs,
    updatedAt: nowMs,
  }).where(and(
    eq(voiceCaptureIntents.ownerId, ownerId),
    eq(voiceCaptureIntents.captureId, captureId),
  ));
  return readVoiceCaptureIntent(ownerId, captureId);
}

export async function readVoiceSpecialistResponse(ownerId: string, captureId: string) {
  const db = getDb();
  const rows = await db.select().from(voiceSpecialistResponses).where(and(
    eq(voiceSpecialistResponses.ownerId, ownerId),
    eq(voiceSpecialistResponses.captureId, captureId),
  ));
  return rows[0] ?? null;
}

function canonicalExchangeFromRow(row: {
  activityId: string;
  userTurnId: string;
  responseTurnId: string;
  specialty: string;
  responseBody: string;
  responseOccurredAt: number;
}): CanonicalExchangeIdentity {
  return {
    activityId: row.activityId,
    userTurnId: row.userTurnId,
    responseTurnId: row.responseTurnId,
    specialty: row.specialty,
    responseBody: row.responseBody,
    responseOccurredAt: row.responseOccurredAt,
  };
}

export async function resolveVoiceCaptureAndSaveResponse(
  ownerId: string,
  input: CanonicalExchangeIdentity & {
    captureId: string;
    reason: string;
  },
  nowMs: number,
) {
  const db = getDb();
  const requested = canonicalExchangeFromRow(input);
  const groupedCapture = await readVoiceResponseGroupByCapture(ownerId, input.captureId);
  const groupedResponse = await readVoiceResponseGroup(ownerId, input.responseTurnId);
  if (groupedCapture || groupedResponse) {
    throw new Error("A capture or response turn is already reserved by a grouped Voice exchange.");
  }
  const existingResponse = await readVoiceSpecialistResponse(ownerId, input.captureId);
  if (existingResponse) {
    if (!sameCanonicalExchange(canonicalExchangeFromRow(existingResponse), requested)) {
      throw new VoiceResponseGroupConflictError(
        "The Voice envelope already has a different canonical specialist response; the first response remains authoritative.",
        {
          conflictKind: "non_exact_replay",
          captureId: input.captureId,
          existingResponseTurnId: existingResponse.responseTurnId,
          requestedResponseTurnId: input.responseTurnId,
        },
      );
    }
    return {
      intent: await readVoiceCaptureIntent(ownerId, input.captureId),
      response: existingResponse,
      duplicate: true,
    };
  }

  const intent = await readVoiceCaptureIntent(ownerId, input.captureId);
  if (intent
      && (intent.activityId !== input.activityId
        || intent.turnId !== input.userTurnId
        || intent.specialty !== input.specialty)) {
    throw new Error("The Voice response does not match the registered owner-scoped envelope.");
  }
  if (intent && !["pending", "uncertain", "activity_related"].includes(intent.status)) {
    throw new Error("The Voice capture is unavailable or already resolved.");
  }

  const responseInsert = db.insert(voiceSpecialistResponses).values({
    ownerId,
    captureId: input.captureId,
    activityId: input.activityId,
    userTurnId: input.userTurnId,
    responseTurnId: input.responseTurnId,
    specialty: input.specialty as Specialty,
    responseBody: input.responseBody,
    responseOccurredAt: input.responseOccurredAt,
    status: "provisional",
    createdAt: nowMs,
    updatedAt: nowMs,
  }).onConflictDoNothing();

  let decisionStatement;
  if (intent) {
    decisionStatement = db.update(voiceCaptureIntents).set({
        status: "activity_related",
        decisionSource: "specialist",
        decisionReason: input.reason.slice(0, 2_000),
        decidedAt: nowMs,
        lastError: null,
        updatedAt: nowMs,
      }).where(and(
        eq(voiceCaptureIntents.ownerId, ownerId),
        eq(voiceCaptureIntents.captureId, input.captureId),
      ));
  } else {
    const deferred = (await db.select().from(deferredVoiceCaptureDecisions).where(and(
      eq(deferredVoiceCaptureDecisions.ownerId, ownerId),
      eq(deferredVoiceCaptureDecisions.captureId, input.captureId),
    )))[0];
    if (deferred
        && (deferred.activityId !== input.activityId
          || deferred.turnId !== input.userTurnId
          || deferred.decision !== "activity_related")) {
      throw new Error("A deferred Voice decision conflicts with this canonical response.");
    }
    decisionStatement = db.insert(deferredVoiceCaptureDecisions).values({
        ownerId,
        captureId: input.captureId,
        activityId: input.activityId,
        turnId: input.userTurnId,
        decision: "activity_related",
        decisionSource: "specialist",
        decisionReason: input.reason.slice(0, 2_000),
        expiresAt: nowMs + 86_400_000,
        createdAt: nowMs,
        updatedAt: nowMs,
      }).onConflictDoNothing();
  }

  try {
    await db.batch([
      db.insert(voiceExchangeReservations).values([
        {
          ownerId,
          identityType: "capture",
          identity: input.captureId,
          exchangeKind: "single",
          responseTurnId: input.responseTurnId,
          createdAt: nowMs,
        },
        {
          ownerId,
          identityType: "response_turn",
          identity: input.responseTurnId,
          exchangeKind: "single",
          responseTurnId: input.responseTurnId,
          createdAt: nowMs,
        },
      ]),
      responseInsert,
      decisionStatement,
    ] as unknown as Parameters<typeof db.batch>[0]);
  } catch (error) {
    const racedResponse = await readVoiceSpecialistResponse(ownerId, input.captureId);
    if (racedResponse && sameCanonicalExchange(canonicalExchangeFromRow(racedResponse), requested)) {
      return {
        intent: await readVoiceCaptureIntent(ownerId, input.captureId),
        response: racedResponse,
        duplicate: true,
      };
    }
    if (await readVoiceResponseGroupByCapture(ownerId, input.captureId)
        || await readVoiceResponseGroup(ownerId, input.responseTurnId)) {
      throw new Error("A capture or response turn is already reserved by a grouped Voice exchange.");
    }
    throw error;
  }

  const storedResponse = await readVoiceSpecialistResponse(ownerId, input.captureId);
  if (!storedResponse || !sameCanonicalExchange(canonicalExchangeFromRow(storedResponse), requested)) {
    throw new Error("The canonical Voice response could not be reserved safely.");
  }
  return {
    intent: await readVoiceCaptureIntent(ownerId, input.captureId),
    response: storedResponse,
    duplicate: false,
  };
}

export type VoiceResponseBatchInput = {
  activityId: string;
  specialty: Specialty;
  captures: Array<{ captureId: string; userTurnId: string }>;
  responseTurnId: string;
  responseBody: string;
  responseOccurredAt: number;
  reason: string;
};

export type VoiceResponseGroupReceipt = {
  responseTurnId: string;
  activityId: string;
  specialty: Specialty;
  status: "provisional" | "materialized" | "deleting" | "quarantined_conflict";
  memberCount: number;
  members: Array<{ captureId: string; userTurnId: string; memberOrder: number }>;
  digest: string;
};

type StoredVoiceResponseGroup = {
  group: typeof voiceResponseGroups.$inferSelect;
  members: Array<typeof voiceResponseGroupMembers.$inferSelect>;
};

async function readVoiceResponseGroups(ownerId: string, responseTurnIds: string[]) {
  const db = getDb();
  const ids = [...new Set(responseTurnIds)];
  if (!ids.length) return new Map<string, StoredVoiceResponseGroup>();
  const [groups, members] = await Promise.all([
    db.select().from(voiceResponseGroups).where(and(
      eq(voiceResponseGroups.ownerId, ownerId),
      inArray(voiceResponseGroups.responseTurnId, ids),
    )),
    db.select().from(voiceResponseGroupMembers).where(and(
      eq(voiceResponseGroupMembers.ownerId, ownerId),
      inArray(voiceResponseGroupMembers.responseTurnId, ids),
    )).orderBy(asc(voiceResponseGroupMembers.memberOrder)),
  ]);
  const membersByResponse = new Map<string, Array<typeof voiceResponseGroupMembers.$inferSelect>>();
  for (const member of members) {
    const responseMembers = membersByResponse.get(member.responseTurnId) ?? [];
    responseMembers.push(member);
    membersByResponse.set(member.responseTurnId, responseMembers);
  }
  return new Map(groups.map((group) => [group.responseTurnId, {
    group,
    members: membersByResponse.get(group.responseTurnId) ?? [],
  }]));
}

async function readVoiceResponseGroup(ownerId: string, responseTurnId: string) {
  return (await readVoiceResponseGroups(ownerId, [responseTurnId])).get(responseTurnId) ?? null;
}

function storedVoiceResponseBatch(
  stored: NonNullable<Awaited<ReturnType<typeof readVoiceResponseGroup>>>,
): VoiceResponseBatchInput {
  return {
    activityId: stored.group.activityId,
    specialty: stored.group.specialty,
    responseTurnId: stored.group.responseTurnId,
    responseBody: stored.group.responseBody,
    responseOccurredAt: stored.group.responseOccurredAt,
    captures: stored.members.map(({ captureId, userTurnId }) => ({ captureId, userTurnId })),
    reason: "Stored canonical Voice response group.",
  };
}

async function voiceResponseGroupReceipt(
  stored: StoredVoiceResponseGroup,
): Promise<VoiceResponseGroupReceipt> {
  return {
    responseTurnId: stored.group.responseTurnId,
    activityId: stored.group.activityId,
    specialty: stored.group.specialty,
    status: stored.group.status,
    memberCount: stored.group.memberCount,
    members: stored.members.map(({ captureId, userTurnId, memberOrder }) => ({
      captureId,
      userTurnId,
      memberOrder,
    })),
    digest: await voiceResponseGroupDigest(stored.group.ownerId, storedVoiceResponseBatch(stored)),
  };
}

async function readVoiceResponseGroupByCapture(ownerId: string, captureId: string) {
  const db = getDb();
  const member = (await db.select().from(voiceResponseGroupMembers).where(and(
    eq(voiceResponseGroupMembers.ownerId, ownerId),
    eq(voiceResponseGroupMembers.captureId, captureId),
  )).limit(1))[0] ?? null;
  return member ? readVoiceResponseGroup(ownerId, member.responseTurnId) : null;
}

function sameVoiceResponseBatch(
  stored: NonNullable<Awaited<ReturnType<typeof readVoiceResponseGroup>>>,
  input: VoiceResponseBatchInput,
) {
  return stored.group.memberCount === input.captures.length
    && stored.members.length === input.captures.length
    && stored.members.every((member, index) => member.memberOrder === index && member.activityId === input.activityId)
    && sameVoiceBatchReservation({
      activityId: stored.group.activityId,
      specialty: stored.group.specialty,
      responseTurnId: stored.group.responseTurnId,
      responseBody: stored.group.responseBody,
      responseOccurredAt: stored.group.responseOccurredAt,
      captures: stored.members.map((member) => ({
        captureId: member.captureId,
        userTurnId: member.userTurnId,
      })),
    }, input);
}

async function quarantineVoiceResponseGroups(
  ownerId: string,
  responseTurnIds: string[],
  captureIds: string[],
  message: string,
  nowMs: number,
) {
  const db = getDb();
  await db.batch([
    db.update(voiceResponseGroups).set({ status: "quarantined_conflict", updatedAt: nowMs }).where(and(
      eq(voiceResponseGroups.ownerId, ownerId),
      inArray(voiceResponseGroups.responseTurnId, responseTurnIds),
    )),
    db.update(voiceCaptureIntents).set({
      status: "quarantined_conflict",
      lastError: message,
      updatedAt: nowMs,
    }).where(and(
      eq(voiceCaptureIntents.ownerId, ownerId),
      inArray(voiceCaptureIntents.captureId, captureIds),
    )),
  ]);
}

function validateVoiceResponseBatchInput(input: VoiceResponseBatchInput) {
  const captureIds = input.captures.map((capture) => capture.captureId);
  const userTurnIds = input.captures.map((capture) => capture.userTurnId);
  if (captureIds.length < 2 || captureIds.length > 20
      || new Set(captureIds).size !== captureIds.length
      || new Set(userTurnIds).size !== userTurnIds.length) {
    throw new Error("A Voice response group requires 2–20 unique capture and user-turn identities.");
  }
  return captureIds;
}

async function resolveExistingVoiceResponseBatch(
  ownerId: string,
  input: VoiceResponseBatchInput,
  captureIds: string[],
) {
  const db = getDb();
  const collidingMembers = await db.select().from(voiceResponseGroupMembers).where(and(
    eq(voiceResponseGroupMembers.ownerId, ownerId),
    or(
      inArray(voiceResponseGroupMembers.captureId, captureIds),
      eq(voiceResponseGroupMembers.responseTurnId, input.responseTurnId),
    ),
  ));
  const existing = await readVoiceResponseGroup(ownerId, input.responseTurnId);
  if (!existing && collidingMembers.length === 0) return null;
  if (existing
      && existing.group.status !== "deleting"
      && sameVoiceResponseBatch(existing, input)
      && collidingMembers.every((member) => member.responseTurnId === input.responseTurnId)) {
    return {
      group: existing.group,
      receipt: await voiceResponseGroupReceipt(existing),
      duplicate: true as const,
    };
  }
  const collidingResponseTurnIds = [...new Set(collidingMembers.map((member) => member.responseTurnId))];
  const stored = existing ?? (collidingResponseTurnIds.length === 1
    ? await readVoiceResponseGroup(ownerId, collidingResponseTurnIds[0])
    : null);
  throw new VoiceResponseGroupConflictError(
    "The Voice envelopes already belong to a different canonical response group. The stored group was not changed.",
    {
      requestedResponseTurnId: input.responseTurnId,
      existingReceipt: stored ? await voiceResponseGroupReceipt(stored) : null,
      safeNextAction: "get_voice_delivery_blockers",
    },
  );
}

async function prepareVoiceResponseBatchReservation(
  ownerId: string,
  input: VoiceResponseBatchInput,
  captureIds: string[],
  nowMs: number,
) {
  const db = getDb();
  const singleResponseCollisions = await db.select().from(voiceSpecialistResponses).where(and(
    eq(voiceSpecialistResponses.ownerId, ownerId),
    or(
      inArray(voiceSpecialistResponses.captureId, captureIds),
      eq(voiceSpecialistResponses.responseTurnId, input.responseTurnId),
    ),
  ));
  if (singleResponseCollisions.length) {
    throw new Error("A capture or response turn is already reserved by a single-capture Voice exchange.");
  }

  const intents = await readVoiceCaptureIntents(ownerId, captureIds);
  const intentByCapture = new Map(intents.map((intent) => [intent.captureId, intent]));
  const deferred = await db.select().from(deferredVoiceCaptureDecisions).where(and(
    eq(deferredVoiceCaptureDecisions.ownerId, ownerId),
    inArray(deferredVoiceCaptureDecisions.captureId, captureIds),
  ));
  const deferredByCapture = new Map(deferred.map((decision) => [decision.captureId, decision]));
  for (const capture of input.captures) {
    const intent = intentByCapture.get(capture.captureId);
    if (intent && (intent.activityId !== input.activityId
        || intent.turnId !== capture.userTurnId
        || intent.specialty !== input.specialty)) {
      throw new Error("A Voice response group does not match a registered owner-scoped envelope.");
    }
    if (intent && !["pending", "uncertain", "activity_related"].includes(intent.status)) {
      throw new Error("A Voice response group contains an unavailable or already resolved capture.");
    }
    const decision = deferredByCapture.get(capture.captureId);
    if (decision && (decision.activityId !== input.activityId
        || decision.turnId !== capture.userTurnId
        || decision.decision !== "activity_related")) {
      throw new Error("A deferred Voice decision conflicts with this response group.");
    }
  }

  return [
    db.insert(voiceExchangeReservations).values([
      ...input.captures.map((capture) => ({
        ownerId,
        identityType: "capture" as const,
        identity: capture.captureId,
        exchangeKind: "group" as const,
        responseTurnId: input.responseTurnId,
        createdAt: nowMs,
      })),
      {
        ownerId,
        identityType: "response_turn" as const,
        identity: input.responseTurnId,
        exchangeKind: "group" as const,
        responseTurnId: input.responseTurnId,
        createdAt: nowMs,
      },
    ]),
    db.insert(voiceResponseGroups).values({
      ownerId,
      responseTurnId: input.responseTurnId,
      activityId: input.activityId,
      specialty: input.specialty,
      responseBody: input.responseBody,
      responseOccurredAt: input.responseOccurredAt,
      memberCount: input.captures.length,
      status: "provisional",
      createdAt: nowMs,
      updatedAt: nowMs,
    }).onConflictDoNothing(),
    ...input.captures.map((capture, memberOrder) => db.insert(voiceResponseGroupMembers).values({
      ownerId,
      captureId: capture.captureId,
      responseTurnId: input.responseTurnId,
      activityId: input.activityId,
      userTurnId: capture.userTurnId,
      memberOrder,
      createdAt: nowMs,
      updatedAt: nowMs,
    }).onConflictDoNothing()),
    ...input.captures.map((capture) => {
      const intent = intentByCapture.get(capture.captureId);
      if (intent) {
        return db.update(voiceCaptureIntents).set({
          status: "activity_related" as const,
          decisionSource: "specialist",
          decisionReason: input.reason.slice(0, 2_000),
          decidedAt: nowMs,
          lastError: null,
          updatedAt: nowMs,
        }).where(and(
          eq(voiceCaptureIntents.ownerId, ownerId),
          eq(voiceCaptureIntents.captureId, capture.captureId),
        ));
      }
      return db.insert(deferredVoiceCaptureDecisions).values({
        ownerId,
        captureId: capture.captureId,
        activityId: input.activityId,
        turnId: capture.userTurnId,
        decision: "activity_related" as const,
        decisionSource: "specialist",
        decisionReason: input.reason.slice(0, 2_000),
        expiresAt: nowMs + 86_400_000,
        createdAt: nowMs,
        updatedAt: nowMs,
      }).onConflictDoNothing();
    }),
  ];
}

export async function resolveVoiceCaptureBatchAndSaveResponse(
  ownerId: string,
  input: VoiceResponseBatchInput,
  nowMs: number,
) {
  const db = getDb();
  const captureIds = validateVoiceResponseBatchInput(input);
  const duplicate = await resolveExistingVoiceResponseBatch(ownerId, input, captureIds);
  if (duplicate) return duplicate;
  const statements = await prepareVoiceResponseBatchReservation(ownerId, input, captureIds, nowMs);
  try {
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
  } catch (error) {
    const raced = await readVoiceResponseGroup(ownerId, input.responseTurnId);
    if (raced && sameVoiceResponseBatch(raced, input)) {
      return {
        group: raced.group,
        receipt: await voiceResponseGroupReceipt(raced),
        duplicate: true,
      };
    }
    const conflictingReservations = await db.select().from(voiceExchangeReservations).where(and(
      eq(voiceExchangeReservations.ownerId, ownerId),
      or(
        and(
          eq(voiceExchangeReservations.identityType, "capture"),
          inArray(voiceExchangeReservations.identity, captureIds),
        ),
        and(
          eq(voiceExchangeReservations.identityType, "response_turn"),
          eq(voiceExchangeReservations.identity, input.responseTurnId),
        ),
      ),
    ));
    if (conflictingReservations.length) {
      throw new Error("A capture or response turn is already reserved by another Voice exchange.");
    }
    throw error;
  }
  const stored = await readVoiceResponseGroup(ownerId, input.responseTurnId);
  if (!stored || !sameVoiceResponseBatch(stored, input)) {
    await quarantineVoiceResponseGroups(
      ownerId,
      [input.responseTurnId],
      captureIds,
      "A concurrent Voice response-group reservation stored different immutable identity.",
      nowMs,
    );
    throw new Error("The canonical Voice response group could not be reserved safely.");
  }
  return {
    group: stored.group,
    receipt: await voiceResponseGroupReceipt(stored),
    duplicate: false,
  };
}

export async function readVoiceDeliveryBlockers(ownerId: string, activityId: string) {
  const db = getDb();
  const intents = await db.select().from(voiceCaptureIntents).where(and(
    eq(voiceCaptureIntents.ownerId, ownerId),
    eq(voiceCaptureIntents.activityId, activityId),
    inArray(voiceCaptureIntents.status, [
      "activity_related",
      "accepted",
      "uncertain",
      "deleting",
      "quarantined_conflict",
    ]),
  ));
  const captureIds = intents.map((intent) => intent.captureId);
  const members = captureIds.length
    ? await db.select().from(voiceResponseGroupMembers).where(and(
      eq(voiceResponseGroupMembers.ownerId, ownerId),
      inArray(voiceResponseGroupMembers.captureId, captureIds),
    ))
    : [];
  const responses = captureIds.length
    ? await db.select({
      captureId: voiceSpecialistResponses.captureId,
      responseTurnId: voiceSpecialistResponses.responseTurnId,
    }).from(voiceSpecialistResponses).where(and(
      eq(voiceSpecialistResponses.ownerId, ownerId),
      inArray(voiceSpecialistResponses.captureId, captureIds),
    ))
    : [];
  const responseByCapture = new Map(responses.map((response) => [response.captureId, response]));
  const responseTurnIds = [...new Set([
    ...members.map((member) => member.responseTurnId),
    ...responses.map((response) => response.responseTurnId),
  ])];
  const groupByResponse = await readVoiceResponseGroups(ownerId, responseTurnIds);
  const memberByCapture = new Map(members.map((member) => [member.captureId, member]));
  const turnIds = [
    ...intents.map((intent) => intent.turnId),
    ...responseTurnIds,
  ];
  const turns = turnIds.length
    ? await db.select({ turnId: practiceTranscriptTurns.turnId }).from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, activityId),
      inArray(practiceTranscriptTurns.turnId, turnIds),
    ))
    : [];
  const presentTurnIds = new Set(turns.map((turn) => turn.turnId));
  const clips = intents.length
    ? await db.select().from(activityAudioClips).where(and(
      eq(activityAudioClips.ownerId, ownerId),
      inArray(activityAudioClips.id, intents.map((intent) => intent.clipId)),
    ))
    : [];
  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const receipts = new Map<string, Awaited<ReturnType<typeof voiceResponseGroupReceipt>>>();
  for (const [responseTurnId, stored] of groupByResponse) {
    receipts.set(responseTurnId, await voiceResponseGroupReceipt(stored));
  }
  return {
    activityId,
    blockers: intents.map((intent) => {
      const member = memberByCapture.get(intent.captureId);
      const group = member ? groupByResponse.get(member.responseTurnId) : undefined;
      const response = responseByCapture.get(intent.captureId);
      const responseTurnId = member?.responseTurnId ?? response?.responseTurnId ?? null;
      const clip = clipById.get(intent.clipId);
      const retryable = (intent.status === "activity_related" || intent.status === "accepted")
        && clip?.status !== "available"
        && clip?.status !== "audio_lost"
        && !clip?.audioLostAcknowledgedAt;
      const canAcknowledgeAudioLoss = (intent.status === "activity_related" || intent.status === "accepted")
        && clip?.status !== "available"
        && !clip?.audioLostAcknowledgedAt;
      const allowedActions = voiceBlockerAllowedActions({
        status: intent.status,
        hasGroup: Boolean(group),
        hasResponse: Boolean(response),
        retryable,
        canAcknowledgeAudioLoss,
      });
      return {
        captureId: intent.captureId,
        turnId: intent.turnId,
        status: intent.status,
        responseTurnId,
        memberOrder: member?.memberOrder ?? null,
        memberCount: group?.group.memberCount ?? null,
        groupStatus: group?.group.status ?? null,
        groupDigest: member ? receipts.get(member.responseTurnId)?.digest ?? null : null,
        canonicalUserTurnPresent: presentTurnIds.has(intent.turnId),
        canonicalResponseTurnPresent: responseTurnId ? presentTurnIds.has(responseTurnId) : false,
        transcriptDeliveryState: member?.transcript != null
          ? "received"
          : response && presentTurnIds.has(intent.turnId) && presentTurnIds.has(response.responseTurnId)
            ? "received"
          : intent.status === "accepted"
            ? "accepted_without_response"
            : "awaiting_delivery",
        audioState: clip?.status ?? "not_registered",
        audioLossAcknowledged: Boolean(clip?.audioLostAcknowledgedAt),
        deletionState: intent.status === "deleting" ? "in_progress" : "not_started",
        lastError: intent.lastError,
        retryable,
        allowedActions,
      };
    }),
  };
}

function voiceBlockerAllowedActions(input: {
  status: VoiceIntentStatus;
  hasGroup: boolean;
  hasResponse: boolean;
  retryable: boolean;
  canAcknowledgeAudioLoss: boolean;
}) {
  if (input.status === "quarantined_conflict") {
    if (input.hasGroup) return ["restore_exact_group", "delete_exact_group"];
    if (input.hasResponse) return ["restore_exact_response", "delete_exact_group"];
    return ["wait"];
  }
  if (input.status === "activity_related" || input.status === "accepted") {
    return [
      ...(input.retryable ? ["retry_delivery"] : []),
      ...(input.canAcknowledgeAudioLoss ? ["acknowledge_audio_loss"] : []),
      "delete_exact_group",
    ];
  }
  if (input.status === "uncertain") return ["attach", "discard"];
  return ["wait"];
}

export async function repairVoiceSpecialistResponse(
  ownerId: string,
  input: {
    captureId: string;
    activityId: string;
    userTurnId: string;
    responseTurnId: string;
    authorization: "explicit_user_instruction";
    reason: string;
  },
  nowMs: number,
) {
  const db = getDb();
  if (input.authorization !== "explicit_user_instruction") {
    throw new VoiceResponseGroupConflictError("Voice response repair requires explicit user authorization.");
  }
  const [intent, response] = await Promise.all([
    readVoiceCaptureIntent(ownerId, input.captureId),
    readVoiceSpecialistResponse(ownerId, input.captureId),
  ]);
  if (!intent || !response
      || intent.activityId !== input.activityId
      || intent.turnId !== input.userTurnId
      || response.activityId !== input.activityId
      || response.userTurnId !== input.userTurnId
      || response.responseTurnId !== input.responseTurnId) {
    throw new VoiceResponseGroupConflictError("The exact owner-scoped Voice response identity was not found.");
  }
  const turns = await db.select().from(practiceTranscriptTurns).where(and(
    eq(practiceTranscriptTurns.ownerId, ownerId),
    eq(practiceTranscriptTurns.activityId, input.activityId),
    inArray(practiceTranscriptTurns.turnId, [input.userTurnId, input.responseTurnId]),
  ));
  const userTurn = turns.find((turn) => turn.turnId === input.userTurnId);
  const responseTurn = turns.find((turn) => turn.turnId === input.responseTurnId);
  if (userTurn?.speaker !== "user"
      || userTurn.specialty !== intent.specialty
      || responseTurn?.speaker !== "specialist"
      || responseTurn.specialty !== response.specialty
      || responseTurn.source !== "codex"
      || responseTurn.body !== response.responseBody) {
    throw new VoiceResponseGroupConflictError(
      "The quarantined Voice response does not have an intact canonical transcript pair.",
    );
  }
  const reservations = await db.select().from(voiceExchangeReservations).where(and(
    eq(voiceExchangeReservations.ownerId, ownerId),
    eq(voiceExchangeReservations.responseTurnId, input.responseTurnId),
  ));
  const reservationIdentities = new Set(reservations.map((reservation) => (
    `${reservation.identityType}:${reservation.identity}`
  )));
  if (reservations.length !== 2
      || reservations.some((reservation) => reservation.exchangeKind !== "single")
      || !reservationIdentities.has(`capture:${input.captureId}`)
      || !reservationIdentities.has(`response_turn:${input.responseTurnId}`)) {
    throw new VoiceResponseGroupConflictError(
      "The quarantined Voice response does not have an intact canonical reservation graph.",
    );
  }
  const repairEventId = `voice-single-repair-${input.captureId}-${input.responseTurnId}`;
  if (intent.status !== "quarantined_conflict" || response.status !== "quarantined_conflict") {
    const prior = await db.select({ id: voiceResponseGroupRepairEvents.id })
      .from(voiceResponseGroupRepairEvents).where(and(
        eq(voiceResponseGroupRepairEvents.ownerId, ownerId),
        eq(voiceResponseGroupRepairEvents.id, repairEventId),
      )).limit(1);
    if (prior.length && intent.status === "accepted" && response.status === "materialized") {
      return { repaired: false, duplicate: true, captureId: input.captureId, responseTurnId: input.responseTurnId };
    }
    throw new VoiceResponseGroupConflictError("The Voice response is not an exact quarantined pair.");
  }
  await db.batch([
    db.insert(voiceResponseGroupRepairEvents).values({
      ownerId,
      id: repairEventId,
      responseTurnId: input.responseTurnId,
      activityId: input.activityId,
      priorStatus: "quarantined_conflict",
      resultStatus: "materialized",
      reason: input.reason.slice(0, 2_000),
      createdAt: nowMs,
    }).onConflictDoNothing(),
    db.update(voiceSpecialistResponses).set({ status: "materialized", updatedAt: nowMs }).where(and(
      eq(voiceSpecialistResponses.ownerId, ownerId),
      eq(voiceSpecialistResponses.captureId, input.captureId),
      eq(voiceSpecialistResponses.status, "quarantined_conflict"),
    )),
    db.update(voiceCaptureIntents).set({ status: "accepted", lastError: null, updatedAt: nowMs }).where(and(
      eq(voiceCaptureIntents.ownerId, ownerId),
      eq(voiceCaptureIntents.captureId, input.captureId),
      eq(voiceCaptureIntents.status, "quarantined_conflict"),
    )),
  ]);
  const [repairedIntent, repairedResponse] = await Promise.all([
    readVoiceCaptureIntent(ownerId, input.captureId),
    readVoiceSpecialistResponse(ownerId, input.captureId),
  ]);
  if (repairedIntent?.status !== "accepted" || repairedResponse?.status !== "materialized") {
    throw new VoiceResponseGroupConflictError("The exact Voice response repair did not commit.");
  }
  return { repaired: true, duplicate: false, captureId: input.captureId, responseTurnId: input.responseTurnId };
}

export async function repairVoiceResponseGroup(
  ownerId: string,
  input: {
    activityId: string;
    responseTurnId: string;
    expectedDigest: string;
    expectedStatus: "quarantined_conflict";
    authorization: "explicit_user_instruction";
    reason: string;
  },
  nowMs: number,
) {
  const db = getDb();
  if (input.authorization !== "explicit_user_instruction") {
    throw new VoiceResponseGroupConflictError(
      "Voice response-group repair requires explicit user authorization.",
      { authorization: input.authorization },
    );
  }
  const stored = await readVoiceResponseGroup(ownerId, input.responseTurnId);
  if (!stored || stored.group.activityId !== input.activityId) {
    throw new VoiceResponseGroupConflictError("The owner-scoped Voice response group was not found for this activity.");
  }
  const receipt = await voiceResponseGroupReceipt(stored);
  if (receipt.digest !== input.expectedDigest) {
    throw new VoiceResponseGroupConflictError(
      "The Voice response group changed after the repair receipt was issued.",
      { existingReceipt: receipt },
    );
  }
  if (stored.group.status !== input.expectedStatus) {
    if (["provisional", "materialized"].includes(stored.group.status)) {
      const priorRepairs = await db.select({ id: voiceResponseGroupRepairEvents.id })
        .from(voiceResponseGroupRepairEvents).where(and(
          eq(voiceResponseGroupRepairEvents.ownerId, ownerId),
          eq(voiceResponseGroupRepairEvents.responseTurnId, input.responseTurnId),
          eq(voiceResponseGroupRepairEvents.activityId, input.activityId),
        )).limit(1);
      if (priorRepairs.length) {
        return { repaired: false, duplicate: true, receipt };
      }
    }
    throw new VoiceResponseGroupConflictError(
      `The Voice response group status is ${stored.group.status}, not ${input.expectedStatus}.`,
      { existingReceipt: receipt },
    );
  }
  const reservations = await db.select().from(voiceExchangeReservations).where(and(
    eq(voiceExchangeReservations.ownerId, ownerId),
    eq(voiceExchangeReservations.responseTurnId, input.responseTurnId),
  ));
  const expectedReservations = new Set([
    `response_turn:${input.responseTurnId}`,
    ...stored.members.map((member) => `capture:${member.captureId}`),
  ]);
  const actualReservations = new Set(reservations.map((reservation) => (
    `${reservation.identityType}:${reservation.identity}`
  )));
  if (
    stored.members.length !== stored.group.memberCount
    || reservations.some((reservation) => reservation.exchangeKind !== "group")
    || actualReservations.size !== expectedReservations.size
    || [...expectedReservations].some((identity) => !actualReservations.has(identity))
  ) {
    throw new VoiceResponseGroupConflictError(
      "The quarantined Voice response group does not have an intact canonical reservation graph.",
      { existingReceipt: receipt },
    );
  }
  const captureIds = stored.members.map((member) => member.captureId);
  const repairEventId = `voice-repair-${input.responseTurnId}-${input.expectedDigest}`;
  const repairResults = await db.batch([
    db.insert(voiceResponseGroupRepairEvents).values({
      ownerId,
      id: repairEventId,
      responseTurnId: input.responseTurnId,
      activityId: input.activityId,
      priorStatus: "quarantined_conflict",
      resultStatus: "provisional",
      reason: input.reason.slice(0, 2_000),
      createdAt: nowMs,
    }).onConflictDoNothing().returning({ id: voiceResponseGroupRepairEvents.id }),
    db.update(voiceResponseGroups).set({ status: "provisional", updatedAt: nowMs }).where(and(
      eq(voiceResponseGroups.ownerId, ownerId),
      eq(voiceResponseGroups.responseTurnId, input.responseTurnId),
      eq(voiceResponseGroups.activityId, input.activityId),
      eq(voiceResponseGroups.status, "quarantined_conflict"),
    )),
    ...stored.members.map((member) => db.update(voiceCaptureIntents).set({
      status: member.transcript === null ? "activity_related" as const : "accepted" as const,
      lastError: null,
      updatedAt: nowMs,
    }).where(and(
      eq(voiceCaptureIntents.ownerId, ownerId),
      eq(voiceCaptureIntents.captureId, member.captureId),
      eq(voiceCaptureIntents.activityId, input.activityId),
      eq(voiceCaptureIntents.turnId, member.userTurnId),
      eq(voiceCaptureIntents.status, "quarantined_conflict"),
    ))),
  ] as unknown as Parameters<typeof db.batch>[0]);
  const insertedRepairEvents = (repairResults[0] ?? []) as Array<{ id: string }>;
  const repaired = await readVoiceResponseGroup(ownerId, input.responseTurnId);
  if (!repaired || repaired.group.status !== "provisional") {
    await db.delete(voiceResponseGroupRepairEvents).where(and(
      eq(voiceResponseGroupRepairEvents.ownerId, ownerId),
      eq(voiceResponseGroupRepairEvents.id, repairEventId),
    ));
    throw new VoiceResponseGroupConflictError("The Voice response group repair did not commit atomically.");
  }
  if (!insertedRepairEvents.length) {
    return {
      repaired: false,
      duplicate: true,
      captureIds,
      receipt: await voiceResponseGroupReceipt(repaired),
    };
  }
  return {
    repaired: true,
    duplicate: false,
    captureIds,
    receipt: await voiceResponseGroupReceipt(repaired),
  };
}

async function commitVoiceResponseGroup(
  ownerId: string,
  input: {
    captureId: string;
    activityId: string;
    specialty: Specialty;
    turnId: string;
    transcript: string;
    checksum: string;
    occurredAt: number;
  },
  intent: typeof voiceCaptureIntents.$inferSelect,
  stored: NonNullable<Awaited<ReturnType<typeof readVoiceResponseGroup>>>,
  nowMs: number,
) {
  const db = getDb();
  const member = stored.members.find((candidate) => candidate.captureId === input.captureId);
  if (!member
      || stored.group.activityId !== input.activityId
      || stored.group.specialty !== input.specialty
      || member.activityId !== input.activityId
      || member.userTurnId !== input.turnId
      || stored.group.status === "quarantined_conflict"
      || stored.group.status === "deleting") {
    throw new Error("The grouped specialist response conflicts with the acknowledged Voice capture.");
  }
  if (member.transcript !== null && (
    member.transcript !== input.transcript
    || member.checksum !== input.checksum
    || member.occurredAt !== input.occurredAt
  )) {
    await quarantineVoiceResponseGroups(
      ownerId,
      [stored.group.responseTurnId],
      stored.members.map((candidate) => candidate.captureId),
      "A grouped Voice transcript was retried with different immutable content.",
      nowMs,
    );
    throw new Error("A grouped Voice transcript conflicts with its first accepted delivery.");
  }

  const commitIntentPredicate = and(
    eq(voiceCaptureIntents.ownerId, ownerId),
    eq(voiceCaptureIntents.captureId, input.captureId),
    eq(voiceCaptureIntents.activityId, input.activityId),
    eq(voiceCaptureIntents.specialty, input.specialty),
    eq(voiceCaptureIntents.turnId, input.turnId),
    eq(voiceCaptureIntents.checksum, input.checksum),
    inArray(voiceCaptureIntents.status, ["activity_related", "accepted"]),
  );
  await db.batch([
    db.update(voiceResponseGroupMembers).set({
      transcript: input.transcript,
      checksum: input.checksum,
      occurredAt: input.occurredAt,
      updatedAt: nowMs,
    }).where(and(
      eq(voiceResponseGroupMembers.ownerId, ownerId),
      eq(voiceResponseGroupMembers.captureId, input.captureId),
      or(
        isNull(voiceResponseGroupMembers.transcript),
        and(
          eq(voiceResponseGroupMembers.transcript, input.transcript),
          eq(voiceResponseGroupMembers.checksum, input.checksum),
          eq(voiceResponseGroupMembers.occurredAt, input.occurredAt),
        ),
      ),
    )),
    db.update(voiceCaptureIntents).set({
      status: "accepted",
      updatedAt: nowMs,
      lastError: null,
    }).where(commitIntentPredicate),
  ]);
  const committedIntent = await readVoiceCaptureIntent(ownerId, input.captureId);
  if (committedIntent?.status !== "accepted") {
    throw new Error("The grouped Voice capture was deleted before its delivery could be committed.");
  }

  const refreshed = await readVoiceResponseGroup(ownerId, stored.group.responseTurnId);
  if (!refreshed) throw new Error("The grouped Voice response reservation disappeared during delivery.");
  const deliveredMember = refreshed.members.find((candidate) => candidate.captureId === input.captureId);
  if (deliveredMember?.transcript !== input.transcript
      || deliveredMember.checksum !== input.checksum
      || deliveredMember.occurredAt !== input.occurredAt) {
    await quarantineVoiceResponseGroups(
      ownerId,
      [stored.group.responseTurnId],
      stored.members.map((candidate) => candidate.captureId),
      "A concurrent grouped Voice delivery stored different immutable transcript content.",
      nowMs,
    );
    throw new Error("The grouped Voice transcript could not be reserved safely.");
  }
  if (refreshed.members.some((candidate) =>
    candidate.transcript === null || candidate.checksum === null || candidate.occurredAt === null)) {
    return {
      activityId: input.activityId,
      specialty: input.specialty,
      turnId: input.turnId,
      body: input.transcript,
      occurredAt: input.occurredAt,
      speaker: "user" as const,
      source: "audio_transcript" as const,
      sequence: deliveredMember.memberOrder,
      groupedPending: true as const,
    };
  }

  const turnIds = [
    ...refreshed.members.map((candidate) => candidate.userTurnId),
    refreshed.group.responseTurnId,
  ];
  const existingTurns = await db.select().from(practiceTranscriptTurns).where(and(
    eq(practiceTranscriptTurns.ownerId, ownerId),
    eq(practiceTranscriptTurns.activityId, input.activityId),
    inArray(practiceTranscriptTurns.turnId, turnIds),
  ));
  if (existingTurns.length > 0 && existingTurns.length !== turnIds.length) {
    await quarantineVoiceResponseGroups(
      ownerId,
      [refreshed.group.responseTurnId],
      refreshed.members.map((candidate) => candidate.captureId),
      "A grouped Voice exchange only partially exists in the canonical transcript.",
      nowMs,
    );
    throw new Error("A grouped Voice exchange conflicts with partial durable transcript content.");
  }
  const latest = existingTurns.length === 0
    ? await db.select({ sequence: practiceTranscriptTurns.sequence })
      .from(practiceTranscriptTurns)
      .where(and(
        eq(practiceTranscriptTurns.ownerId, ownerId),
        eq(practiceTranscriptTurns.activityId, input.activityId),
      ))
      .orderBy(desc(practiceTranscriptTurns.sequence))
      .limit(1)
    : [];
  const baseSequence = existingTurns.length
    ? Math.min(...existingTurns.map((turn) => turn.sequence))
    : (latest[0]?.sequence ?? -1) + 1;
  const canonicalTurns = canonicalVoiceBatchTurns(
    refreshed.members,
    {
      turnId: refreshed.group.responseTurnId,
      body: refreshed.group.responseBody,
      occurredAt: refreshed.group.responseOccurredAt,
    },
    input.specialty,
    baseSequence,
  ).map((turn) => ({ ownerId, activityId: input.activityId, ...turn, updatedAt: nowMs }));
  const userValues = canonicalTurns.slice(0, -1);
  const responseValue = canonicalTurns.at(-1)!;
  for (const value of [...userValues, responseValue]) {
    const existingTurn = existingTurns.find((turn) => turn.turnId === value.turnId);
    if (existingTurn && !sameVoiceCommitTurn(existingTurn, value)) {
      await quarantineVoiceResponseGroups(
        ownerId,
        [refreshed.group.responseTurnId],
        refreshed.members.map((candidate) => candidate.captureId),
        "A grouped Voice exchange conflicts with existing canonical transcript content.",
        nowMs,
      );
      throw new Error("A grouped Voice exchange turn conflicts with existing durable transcript content.");
    }
  }

  const groupReadyPredicate = and(
    eq(voiceResponseGroups.ownerId, ownerId),
    eq(voiceResponseGroups.responseTurnId, refreshed.group.responseTurnId),
    inArray(voiceResponseGroups.status, ["provisional", "materialized"]),
    notExists(db.select({ one: sql<number>`1` }).from(voiceResponseGroupMembers).where(and(
      eq(voiceResponseGroupMembers.ownerId, ownerId),
      eq(voiceResponseGroupMembers.responseTurnId, refreshed.group.responseTurnId),
      or(
        isNull(voiceResponseGroupMembers.transcript),
        isNull(voiceResponseGroupMembers.checksum),
        isNull(voiceResponseGroupMembers.occurredAt),
      ),
    ))),
  );
  const guardedTranscriptInsert = (value: typeof practiceTranscriptTurns.$inferInsert) => (
    db.insert(practiceTranscriptTurns).select(
      db.select({
        ownerId: sql<string>`${value.ownerId}`.as("owner_id"),
        activityId: sql<string>`${value.activityId}`.as("activity_id"),
        turnId: sql<string>`${value.turnId}`.as("turn_id"),
        specialty: sql<string>`${value.specialty}`.as("specialty"),
        speaker: sql<string>`${value.speaker}`.as("speaker"),
        body: sql<string>`${value.body}`.as("body"),
        source: sql<string>`${value.source}`.as("source"),
        sequence: sql<number>`${value.sequence}`.as("sequence"),
        occurredAt: sql<number>`${value.occurredAt}`.as("occurred_at"),
        updatedAt: sql<number>`${value.updatedAt}`.as("updated_at"),
      }).from(voiceResponseGroups).where(groupReadyPredicate).limit(1),
    ).onConflictDoNothing()
  );
  const canonicalTurnExists = (value: (typeof canonicalTurns)[number]) => exists(
    db.select({ one: sql<number>`1` }).from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, value.ownerId),
      eq(practiceTranscriptTurns.activityId, value.activityId),
      eq(practiceTranscriptTurns.turnId, value.turnId),
      eq(practiceTranscriptTurns.specialty, value.specialty),
      eq(practiceTranscriptTurns.speaker, value.speaker),
      eq(practiceTranscriptTurns.body, value.body),
      eq(practiceTranscriptTurns.source, value.source),
      eq(practiceTranscriptTurns.sequence, value.sequence),
      eq(practiceTranscriptTurns.occurredAt, value.occurredAt),
    )),
  );
  const materializableGroupPredicate = and(
    groupReadyPredicate,
    ...canonicalTurns.map(canonicalTurnExists),
  );
  try {
    await db.batch([
      typedExchangeIdentityNotDeletedGuard(db, ownerId, input.activityId, turnIds),
      ...userValues.map(guardedTranscriptInsert),
      guardedTranscriptInsert(responseValue),
      db.update(voiceResponseGroups).set({ status: "materialized", updatedAt: nowMs }).where(materializableGroupPredicate),
    ] as unknown as Parameters<typeof db.batch>[0]);
  } catch (error) {
    if (isD1TransactionalInvariantFailure(error)) {
      throw new TypedExchangeDeletionError(
        "typed_exchange_identity_deleted",
        "A deleted typed exchange identity cannot be reused by Voice materialization.",
      );
    }
    throw error;
  }
  const materialized = await readVoiceResponseGroup(ownerId, refreshed.group.responseTurnId);
  if (materialized?.group.status !== "materialized") {
    if (materialized) {
      await quarantineVoiceResponseGroups(
        ownerId,
        [materialized.group.responseTurnId],
        materialized.members.map((candidate) => candidate.captureId),
        "A concurrent transcript write prevented exact grouped Voice materialization.",
        nowMs,
      );
    }
    throw new Error("The grouped Voice exchange could not materialize exact canonical transcript content.");
  }
  return userValues.find((value) => value.turnId === input.turnId)!;
}

export async function commitRelatedVoiceCapture(
  ownerId: string,
  input: {
    captureId: string;
    activityId: string;
    specialty: Specialty;
    turnId: string;
    transcript: string;
    checksum: string;
    occurredAt: number;
  },
  nowMs: number,
) {
  const db = getDb();
  const intent = await readVoiceCaptureIntent(ownerId, input.captureId);
  if (!voiceCaptureAllowsCommit(
    intent ? {
      status: intent.status as VoiceIntentStatus,
      activityId: intent.activityId,
      specialty: intent.specialty,
      turnId: intent.turnId,
      checksum: intent.checksum,
    } : null,
    input,
  )) {
    throw new Error("Only an acknowledged activity-related capture can be committed.");
  }
  const responseGroup = await readVoiceResponseGroupByCapture(ownerId, input.captureId);
  if (responseGroup) {
    return commitVoiceResponseGroup(ownerId, input, intent!, responseGroup, nowMs);
  }
  const commitIntentPredicate = and(
    eq(voiceCaptureIntents.ownerId, ownerId),
    eq(voiceCaptureIntents.captureId, input.captureId),
    eq(voiceCaptureIntents.activityId, input.activityId),
    eq(voiceCaptureIntents.specialty, input.specialty),
    eq(voiceCaptureIntents.turnId, input.turnId),
    eq(voiceCaptureIntents.checksum, input.checksum),
    inArray(voiceCaptureIntents.status, ["activity_related", "accepted"]),
  );
  const guardedTranscriptInsert = (value: typeof practiceTranscriptTurns.$inferInsert) => (
    db.insert(practiceTranscriptTurns).select(
      db.select({
        ownerId: sql<string>`${value.ownerId}`.as("owner_id"),
        activityId: sql<string>`${value.activityId}`.as("activity_id"),
        turnId: sql<string>`${value.turnId}`.as("turn_id"),
        specialty: sql<string>`${value.specialty}`.as("specialty"),
        speaker: sql<string>`${value.speaker}`.as("speaker"),
        body: sql<string>`${value.body}`.as("body"),
        source: sql<string>`${value.source}`.as("source"),
        sequence: sql<number>`${value.sequence}`.as("sequence"),
        occurredAt: sql<number>`${value.occurredAt}`.as("occurred_at"),
        updatedAt: sql<number>`${value.updatedAt}`.as("updated_at"),
      }).from(voiceCaptureIntents).where(commitIntentPredicate).limit(1),
    ).onConflictDoNothing()
  );
  const response = await readVoiceSpecialistResponse(ownerId, input.captureId);
  if (!response) {
    const existingTurns = await db.select().from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, input.activityId),
      eq(practiceTranscriptTurns.turnId, input.turnId),
    ));
    const latest = await db.select({ sequence: practiceTranscriptTurns.sequence })
      .from(practiceTranscriptTurns)
      .where(and(
        eq(practiceTranscriptTurns.ownerId, ownerId),
        eq(practiceTranscriptTurns.activityId, input.activityId),
      ))
      .orderBy(desc(practiceTranscriptTurns.sequence))
      .limit(1);
    const userValue = {
      ownerId,
      activityId: input.activityId,
      turnId: input.turnId,
      specialty: input.specialty,
      speaker: "user" as const,
      body: input.transcript,
      source: "audio_transcript" as const,
      sequence: existingTurns[0]?.sequence ?? (latest[0]?.sequence ?? -1) + 1,
      occurredAt: input.occurredAt,
      updatedAt: nowMs,
    };
    if (existingTurns[0] && !sameVoiceCommitTurn(existingTurns[0], userValue)) {
      throw new Error("A stable Voice exchange turn conflicts with existing durable transcript content.");
    }
    try {
      await db.batch([
        typedExchangeIdentityNotDeletedGuard(db, ownerId, input.activityId, [input.turnId]),
        guardedTranscriptInsert(userValue),
        db.update(voiceCaptureIntents).set({
          status: "accepted",
          updatedAt: nowMs,
          lastError: null,
        }).where(commitIntentPredicate),
      ]);
    } catch (error) {
      if (isD1TransactionalInvariantFailure(error)) {
        throw new TypedExchangeDeletionError(
          "typed_exchange_identity_deleted",
          "A deleted typed exchange identity cannot be reused by Voice materialization.",
        );
      }
      throw error;
    }
    const committedIntent = await readVoiceCaptureIntent(ownerId, input.captureId);
    if (committedIntent?.status !== "accepted") {
      throw new Error("The Voice capture was deleted before its durable transcript could be committed.");
    }
    return userValue;
  }
  if (response.status === "quarantined_conflict"
      || response.activityId !== input.activityId
      || response.userTurnId !== input.turnId
      || response.specialty !== input.specialty) {
    throw new Error("The provisional specialist response conflicts with the acknowledged Voice capture.");
  }

  const requestedIds = [input.turnId, response.responseTurnId];
  const existingTurns = await db.select().from(practiceTranscriptTurns).where(and(
    eq(practiceTranscriptTurns.ownerId, ownerId),
    eq(practiceTranscriptTurns.activityId, input.activityId),
    inArray(practiceTranscriptTurns.turnId, requestedIds),
  ));
  const latest = await db
    .select({ sequence: practiceTranscriptTurns.sequence })
    .from(practiceTranscriptTurns)
    .where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, input.activityId),
    ))
    .orderBy(desc(practiceTranscriptTurns.sequence))
    .limit(1);
  const userSequence = existingTurns.find((turn) => turn.turnId === input.turnId)?.sequence
    ?? (latest[0]?.sequence ?? -1) + 1;
  const responseSequence = existingTurns.find((turn) => turn.turnId === response.responseTurnId)?.sequence
    ?? userSequence + 1;
  const userValue = {
    ownerId,
    activityId: input.activityId,
    turnId: input.turnId,
    specialty: input.specialty,
    speaker: "user" as const,
    body: input.transcript,
    source: "audio_transcript" as const,
    sequence: userSequence,
    occurredAt: input.occurredAt,
    updatedAt: nowMs,
  };
  const responseValue = {
    ownerId,
    activityId: input.activityId,
    turnId: response.responseTurnId,
    specialty: input.specialty,
    speaker: "specialist" as const,
    body: response.responseBody,
    source: "codex" as const,
    sequence: responseSequence,
    occurredAt: response.responseOccurredAt,
    updatedAt: nowMs,
  };
  for (const [value, existingTurn] of [
    [userValue, existingTurns.find((turn) => turn.turnId === input.turnId)],
    [responseValue, existingTurns.find((turn) => turn.turnId === response.responseTurnId)],
  ] as const) {
    if (existingTurn && !sameVoiceCommitTurn(existingTurn, value)) {
      throw new Error("A stable Voice exchange turn conflicts with existing durable transcript content.");
    }
  }
  try {
    await db.batch([
      typedExchangeIdentityNotDeletedGuard(db, ownerId, input.activityId, requestedIds),
      guardedTranscriptInsert(userValue),
      guardedTranscriptInsert(responseValue),
      db.update(voiceSpecialistResponses).set({
        status: "materialized",
        updatedAt: nowMs,
      }).where(and(
        eq(voiceSpecialistResponses.ownerId, ownerId),
        eq(voiceSpecialistResponses.captureId, input.captureId),
        exists(db.select({ one: sql<number>`1` }).from(voiceCaptureIntents).where(commitIntentPredicate)),
      )),
      db.update(voiceCaptureIntents).set({
        status: "accepted",
        updatedAt: nowMs,
        lastError: null,
      }).where(commitIntentPredicate),
    ]);
  } catch (error) {
    if (isD1TransactionalInvariantFailure(error)) {
      throw new TypedExchangeDeletionError(
        "typed_exchange_identity_deleted",
        "A deleted typed exchange identity cannot be reused by Voice materialization.",
      );
    }
    throw error;
  }
  const committedIntent = await readVoiceCaptureIntent(ownerId, input.captureId);
  if (committedIntent?.status !== "accepted") {
    throw new Error("The Voice capture was deleted before its durable exchange could be committed.");
  }
  return userValue;
}

export async function readVoiceCaptureDeleteScope(ownerId: string, captureId: string) {
  const db = getDb();
  const grouped = await readVoiceResponseGroupByCapture(ownerId, captureId);
  const captureIds = grouped
    ? grouped.members.map((member) => member.captureId)
    : [captureId];
  const intents = await readVoiceCaptureIntents(ownerId, captureIds);
  const groupedTarget = grouped?.members.find((member) => member.captureId === captureId);
  const target = intents.find((intent) => intent.captureId === captureId) ?? (groupedTarget ? {
    captureId: groupedTarget.captureId,
    activityId: groupedTarget.activityId,
    turnId: groupedTarget.userTurnId,
  } : null);
  if (!target) throw new Error("Voice capture not found.");
  const singleResponses = grouped ? [] : await db.select().from(voiceSpecialistResponses).where(and(
    eq(voiceSpecialistResponses.ownerId, ownerId),
    inArray(voiceSpecialistResponses.captureId, captureIds),
  ));
  return {
    target,
    intents,
    captureIds,
    clipIds: intents.map((intent) => intent.clipId),
    userTurnIds: grouped
      ? grouped.members.map((member) => member.userTurnId)
      : intents.map((intent) => intent.turnId),
    responseTurnIds: grouped
      ? [grouped.group.responseTurnId]
      : singleResponses.map((response) => response.responseTurnId),
    groupedResponseTurnId: grouped?.group.responseTurnId ?? null,
  };
}

export async function readVoiceCaptureRemediationIntent(ownerId: string, captureId: string) {
  const intent = await readVoiceCaptureIntent(ownerId, captureId);
  if (intent) return intent;
  const grouped = await readVoiceResponseGroupByCapture(ownerId, captureId);
  const member = grouped?.members.find((candidate) => candidate.captureId === captureId);
  return member ? {
    captureId,
    activityId: member.activityId,
    turnId: member.userTurnId,
    status: "activity_related" as const,
  } : null;
}

export async function beginDeleteVoiceCaptureGraph(
  ownerId: string,
  captureId: string,
  nowMs: number,
  deletion?: { source: string; reason: string },
) {
  const db = getDb();
  const scope = await readVoiceCaptureDeleteScope(ownerId, captureId);
  const statements = [
    db.update(voiceCaptureIntents).set({
      status: "deleting" as const,
      ...(deletion ? {
        decisionSource: sql<string | null>`CASE
          WHEN ${voiceCaptureIntents.status} = 'deleting' THEN ${voiceCaptureIntents.decisionSource}
          ELSE ${deletion.source.slice(0, 80)}
        END`,
        decisionReason: sql<string | null>`CASE
          WHEN ${voiceCaptureIntents.status} = 'deleting' THEN ${voiceCaptureIntents.decisionReason}
          ELSE ${deletion.reason.slice(0, 2_000)}
        END`,
        decidedAt: sql<number | null>`CASE
          WHEN ${voiceCaptureIntents.status} = 'deleting' THEN ${voiceCaptureIntents.decidedAt}
          ELSE ${nowMs}
        END`,
      } : {}),
      updatedAt: nowMs,
      lastError: null,
    }).where(and(
      eq(voiceCaptureIntents.ownerId, ownerId),
      inArray(voiceCaptureIntents.captureId, scope.captureIds),
    )),
    ...(scope.groupedResponseTurnId ? [
      db.update(voiceResponseGroups).set({ status: "deleting" as const, updatedAt: nowMs }).where(and(
        eq(voiceResponseGroups.ownerId, ownerId),
        eq(voiceResponseGroups.responseTurnId, scope.groupedResponseTurnId),
      )),
    ] : []),
  ];
  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
  return scope;
}

export async function beginDeleteVoiceCapture(
  ownerId: string,
  captureId: string,
  nowMs: number,
  deletion?: { source: string; reason: string },
) {
  return (await beginDeleteVoiceCaptureGraph(ownerId, captureId, nowMs, deletion)).target;
}

export async function completeDeleteVoiceCapture(ownerId: string, captureId: string, nowMs: number) {
  const db = getDb();
  let scope;
  try {
    scope = await readVoiceCaptureDeleteScope(ownerId, captureId);
  } catch (error) {
    if (error instanceof Error && error.message === "Voice capture not found.") return;
    throw error;
  }
  const transcriptTurnIds = [...new Set([...scope.userTurnIds, ...scope.responseTurnIds])];
  await db.delete(activityDeliveryAnalyses).where(and(
    eq(activityDeliveryAnalyses.ownerId, ownerId),
    inArray(activityDeliveryAnalyses.transcriptTurnId, scope.userTurnIds),
  ));
  await db.delete(activityAudioClips).where(and(
    eq(activityAudioClips.ownerId, ownerId),
    inArray(activityAudioClips.id, scope.clipIds),
  ));
  await db.delete(practiceTranscriptTurns).where(and(
    eq(practiceTranscriptTurns.ownerId, ownerId),
    eq(practiceTranscriptTurns.activityId, scope.target.activityId),
    inArray(practiceTranscriptTurns.turnId, transcriptTurnIds),
  ));
  const statements = [
    db.delete(deferredVoiceCaptureDecisions).where(and(
      eq(deferredVoiceCaptureDecisions.ownerId, ownerId),
      inArray(deferredVoiceCaptureDecisions.captureId, scope.captureIds),
    )),
    db.delete(voiceSpecialistResponses).where(and(
      eq(voiceSpecialistResponses.ownerId, ownerId),
      inArray(voiceSpecialistResponses.captureId, scope.captureIds),
    )),
    db.delete(voiceExchangeReservations).where(and(
      eq(voiceExchangeReservations.ownerId, ownerId),
      or(
        and(
          eq(voiceExchangeReservations.identityType, "capture"),
          inArray(voiceExchangeReservations.identity, scope.captureIds),
        ),
        and(
          eq(voiceExchangeReservations.identityType, "response_turn"),
          inArray(voiceExchangeReservations.identity, scope.responseTurnIds),
        ),
      ),
    )),
    db.delete(voiceResponseGroupMembers).where(and(
      eq(voiceResponseGroupMembers.ownerId, ownerId),
      inArray(voiceResponseGroupMembers.captureId, scope.captureIds),
    )),
    ...(scope.groupedResponseTurnId ? [
      db.delete(voiceResponseGroups).where(and(
        eq(voiceResponseGroups.ownerId, ownerId),
        eq(voiceResponseGroups.responseTurnId, scope.groupedResponseTurnId),
      )),
    ] : []),
    db.update(voiceCaptureIntents).set({
      status: "deleted" as const,
      updatedAt: nowMs,
      lastError: null,
    }).where(and(
      eq(voiceCaptureIntents.ownerId, ownerId),
      inArray(voiceCaptureIntents.captureId, scope.captureIds),
    )),
  ];
  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
}

export async function failDeleteVoiceCapture(ownerId: string, captureId: string, message: string, nowMs: number) {
  const db = getDb();
  const scope = await readVoiceCaptureDeleteScope(ownerId, captureId);
  await db.update(voiceCaptureIntents).set({
    status: "deleting",
    lastError: message.slice(0, 2_000),
    updatedAt: nowMs,
  }).where(and(
    eq(voiceCaptureIntents.ownerId, ownerId),
    inArray(voiceCaptureIntents.captureId, scope.captureIds),
  ));
}

export async function unresolvedVoiceCaptureCount(ownerId: string, activityId: string) {
  const db = getDb();
  const rows = await db.select({ count: sql<number>`count(*)` }).from(voiceCaptureIntents).where(and(
    eq(voiceCaptureIntents.ownerId, ownerId),
    eq(voiceCaptureIntents.activityId, activityId),
    inArray(voiceCaptureIntents.status, [
      "activity_related",
      "uncertain",
      "deleting",
      "quarantined_conflict",
    ]),
  ));
  return Number(rows[0]?.count ?? 0);
}

function hasCanonicalMaterializedVoiceExchange(
  intent: typeof voiceCaptureIntents.$inferSelect,
  response: typeof voiceSpecialistResponses.$inferSelect | undefined,
  userTurn: typeof practiceTranscriptTurns.$inferSelect | null | undefined,
  specialistTurn: typeof practiceTranscriptTurns.$inferSelect | null | undefined,
) {
  return response?.status === "materialized"
    && response.activityId === intent.activityId
    && response.userTurnId === intent.turnId
    && response.specialty === intent.specialty
    && userTurn?.activityId === intent.activityId
    && userTurn.specialty === intent.specialty
    && userTurn.speaker === "user"
    && userTurn.source === "audio_transcript"
    && specialistTurn?.activityId === intent.activityId
    && specialistTurn.specialty === intent.specialty
    && specialistTurn.speaker === "specialist"
    && specialistTurn.source === "codex"
    && specialistTurn.body === response.responseBody;
}

function hasCanonicalMaterializedVoiceGroupMember(
  intent: typeof voiceCaptureIntents.$inferSelect,
  member: typeof voiceResponseGroupMembers.$inferSelect | undefined,
  group: typeof voiceResponseGroups.$inferSelect | undefined,
  userTurn: typeof practiceTranscriptTurns.$inferSelect | null | undefined,
  specialistTurn: typeof practiceTranscriptTurns.$inferSelect | null | undefined,
) {
  return group?.status === "materialized"
    && member?.activityId === intent.activityId
    && member.userTurnId === intent.turnId
    && group.activityId === intent.activityId
    && group.specialty === intent.specialty
    && userTurn?.activityId === intent.activityId
    && userTurn.specialty === intent.specialty
    && userTurn.speaker === "user"
    && userTurn.source === "audio_transcript"
    && specialistTurn?.activityId === intent.activityId
    && specialistTurn.specialty === intent.specialty
    && specialistTurn.speaker === "specialist"
    && specialistTurn.source === "codex"
    && specialistTurn.body === group.responseBody;
}

export async function prepareVoiceCapturesForFinish(
  ownerId: string,
  activityId: string,
  nowMs: number,
  options: { discardPending?: boolean } = {},
): Promise<VoiceFinishGuard> {
  const db = getDb();
  const active = await db.select().from(voiceCaptureIntents).where(and(
    eq(voiceCaptureIntents.ownerId, ownerId),
    eq(voiceCaptureIntents.activityId, activityId),
    inArray(voiceCaptureIntents.status, [
      "pending",
      "activity_related",
      "accepted",
      "uncertain",
      "deleting",
      "quarantined_conflict",
    ]),
  ));
  const untouched = active.filter((intent) =>
    finishDispositionForVoiceStatus(intent.status as VoiceIntentStatus) === "discard_unclassified");
  const untouchedIds = untouched.map((intent) => intent.captureId);
  if (untouchedIds.length && options.discardPending !== false) {
    await db.batch([
      db.update(voiceCaptureIntents).set({
        status: "discarded_unclassified",
        decisionSource: "finish_guard",
        decisionReason: "The capture remained unclassified when the activity was finished.",
        decidedAt: nowMs,
        updatedAt: nowMs,
      }).where(and(
        eq(voiceCaptureIntents.ownerId, ownerId),
        eq(voiceCaptureIntents.activityId, activityId),
        inArray(voiceCaptureIntents.captureId, untouchedIds),
        eq(voiceCaptureIntents.status, "pending"),
      )),
      db.update(voiceSpecialistResponses).set({
        status: "discarded",
        updatedAt: nowMs,
      }).where(and(
        eq(voiceSpecialistResponses.ownerId, ownerId),
        inArray(voiceSpecialistResponses.captureId, untouchedIds),
        eq(voiceSpecialistResponses.status, "provisional"),
      )),
    ]);
  }

  const guard: VoiceFinishGuard = {
    discardedUnclassified: untouchedIds,
    awaitingDelivery: [],
    missingDurableExchange: [],
    awaitingAudio: [],
    audioLostNeedsAcknowledgement: [],
    needsDecision: [],
    deleting: [],
    conflicts: [],
  };
  const accepted = active.filter((intent) => intent.status === "accepted");
  const clips = accepted.length
    ? await db.select().from(activityAudioClips).where(and(
      eq(activityAudioClips.ownerId, ownerId),
      inArray(activityAudioClips.id, accepted.map((intent) => intent.clipId)),
    ))
    : [];
  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const responses = accepted.length
    ? await db.select().from(voiceSpecialistResponses).where(and(
      eq(voiceSpecialistResponses.ownerId, ownerId),
      inArray(voiceSpecialistResponses.captureId, accepted.map((intent) => intent.captureId)),
    ))
    : [];
  const responseByCaptureId = new Map(responses.map((response) => [response.captureId, response]));
  const groupMembers = accepted.length
    ? await db.select().from(voiceResponseGroupMembers).where(and(
      eq(voiceResponseGroupMembers.ownerId, ownerId),
      inArray(voiceResponseGroupMembers.captureId, accepted.map((intent) => intent.captureId)),
    ))
    : [];
  const groupResponseTurnIds = [...new Set(groupMembers.map((member) => member.responseTurnId))];
  const responseGroups = groupResponseTurnIds.length
    ? await db.select().from(voiceResponseGroups).where(and(
      eq(voiceResponseGroups.ownerId, ownerId),
      inArray(voiceResponseGroups.responseTurnId, groupResponseTurnIds),
    ))
    : [];
  const groupMemberByCaptureId = new Map(groupMembers.map((member) => [member.captureId, member]));
  const groupByResponseTurnId = new Map(responseGroups.map((group) => [group.responseTurnId, group]));
  const canonicalTurnIds = [
    ...responses.flatMap((response) => [response.userTurnId, response.responseTurnId]),
    ...groupMembers.map((member) => member.userTurnId),
    ...groupResponseTurnIds,
  ];
  const canonicalTurns = canonicalTurnIds.length
    ? await db.select().from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, activityId),
      inArray(practiceTranscriptTurns.turnId, canonicalTurnIds),
    ))
    : [];
  const turnById = new Map(canonicalTurns.map((turn) => [turn.turnId, turn]));
  active.forEach((intent) => {
    const disposition = finishDispositionForVoiceStatus(intent.status as VoiceIntentStatus);
    if (disposition === "block_for_delivery") guard.awaitingDelivery.push(intent.captureId);
    if (disposition === "needs_user_decision") guard.needsDecision.push(intent.captureId);
    if (disposition === "block_for_deletion") guard.deleting.push(intent.captureId);
    if (intent.status === "quarantined_conflict") guard.conflicts.push(intent.captureId);
    if (intent.status === "accepted") {
      const response = responseByCaptureId.get(intent.captureId);
      const member = groupMemberByCaptureId.get(intent.captureId);
      const group = member ? groupByResponseTurnId.get(member.responseTurnId) : undefined;
      const userTurnId = response?.userTurnId ?? member?.userTurnId;
      const responseTurnId = response?.responseTurnId ?? group?.responseTurnId;
      const userTurn = userTurnId ? turnById.get(userTurnId) : null;
      const specialistTurn = responseTurnId ? turnById.get(responseTurnId) : null;
      const hasCanonicalExchange = response
        ? hasCanonicalMaterializedVoiceExchange(intent, response, userTurn, specialistTurn)
        : hasCanonicalMaterializedVoiceGroupMember(intent, member, group, userTurn, specialistTurn);
      if (!hasCanonicalExchange) guard.missingDurableExchange.push(intent.captureId);
      const clip = clipById.get(intent.clipId);
      if (clip?.status === "audio_lost") {
        if (!clip.audioLostAcknowledgedAt) guard.audioLostNeedsAcknowledgement.push(intent.captureId);
      } else if (clip?.status !== "available") {
        guard.awaitingAudio.push(intent.captureId);
      }
    }
  });
  return guard;
}

export { voiceFinishGuardMessage };

type SaveLeetCodeCodeAttemptInput = {
  id: string;
  activityId: string;
  originatingTurnId: string;
  sequence: number;
  language: string;
  code: string;
  occurredAt: number;
  review: CodeAttemptReviewV1;
  reviewResponseTurnId?: string;
  observedCorrectness: "not_verified" | "appears_correct" | "issues_found" | "incomplete";
  concreteFindings: string[];
  edgeCases: string[];
  complexity?: { time?: string; space?: string };
  finalDeclaration: string;
};

export type RecoverLeetCodeCodeAttemptInput = SaveLeetCodeCodeAttemptInput & {
  authorization: "explicit_user_instruction";
  auditReason: string;
};

type CodeAttemptProjectionInput = Omit<CodeAttemptReviewWrite, "review" | "reviewResponseTurnId" | "complexity"> & {
  review: unknown;
  reviewResponseTurnId?: string | null;
  complexity?: { time?: string; space?: string } | null;
};

function projectCodeAttempt(input: CodeAttemptProjectionInput) {
  return {
    id: input.id,
    activityId: input.activityId,
    originatingTurnId: input.originatingTurnId,
    sequence: input.sequence,
    language: input.language.trim().slice(0, 40),
    code: input.code,
    occurredAt: input.occurredAt,
    review: input.review,
    reviewResponseTurnId: input.reviewResponseTurnId?.trim() || null,
    observedCorrectness: input.observedCorrectness,
    concreteFindings: input.concreteFindings,
    edgeCases: input.edgeCases,
    complexity: input.complexity ?? null,
    finalDeclaration: input.finalDeclaration,
  };
}

function codeAttemptWrite(input: SaveLeetCodeCodeAttemptInput): CodeAttemptReviewWrite {
  return { ...projectCodeAttempt(input), review: input.review };
}

function storedCodeAttemptWrite(row: typeof leetcodeCodeAttempts.$inferSelect) {
  return projectCodeAttempt({
    ...row,
    concreteFindings: row.concreteFindings as string[],
    edgeCases: row.edgeCases as string[],
    complexity: row.complexity as { time?: string; space?: string } | null,
  });
}

function exactCodeAttemptTranscriptEvidenceCondition(
  db: ReturnType<typeof getDb>,
  ownerId: string,
  input: {
    activityId: string;
    originatingTurnId: string;
    reviewResponseTurnId?: string | null;
  },
  requireReviewTurn: boolean,
) {
  const turnIds = [
    input.originatingTurnId,
    ...(requireReviewTurn && input.reviewResponseTurnId ? [input.reviewResponseTurnId] : []),
  ];
  return and(
    exists(db.select({ one: sql<number>`1` }).from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, input.activityId),
      eq(practiceTranscriptTurns.turnId, input.originatingTurnId),
      eq(practiceTranscriptTurns.speaker, "user"),
    ))),
    requireReviewTurn
      ? exists(db.select({ one: sql<number>`1` }).from(practiceTranscriptTurns).where(and(
        eq(practiceTranscriptTurns.ownerId, ownerId),
        eq(practiceTranscriptTurns.activityId, input.activityId),
        eq(practiceTranscriptTurns.turnId, input.reviewResponseTurnId!),
        eq(practiceTranscriptTurns.speaker, "specialist"),
      )))
      : undefined,
    typedExchangeIdentityNotDeletedCondition(db, ownerId, input.activityId, turnIds),
  )!;
}

export async function saveLeetCodeCodeAttempt(
  ownerId: string,
  input: SaveLeetCodeCodeAttemptInput,
  nowMs: number,
) {
  const db = getDb();
  const review = normalizeCodeAttemptReview(input.review);
  if (!review) throw new Error("Code Attempt review must use the versioned pending or complete contract.");
  if (review.status === "complete" && review.provenance === "explicit_evidence_backfill") {
    throw new Error("Historical review backfill is available only through the coordinator audit command.");
  }
  // Older specialists sent reviewResponseTurnId on both pending and complete
  // writes. A pending review has no visible specialist turn yet; normalize the
  // stale field before enqueue execution so the exact owner code is not lost
  // merely because a caller used the broader legacy shape.
  const incoming = codeAttemptWrite({
    ...input,
    review,
    reviewResponseTurnId: review.status === "pending" ? undefined : input.reviewResponseTurnId,
  });
  if (review.status === "pending" && incoming.reviewResponseTurnId) {
    throw new Error("A pending Code Attempt review cannot name a specialist review turn.");
  }
  if (review.status === "complete" && !incoming.reviewResponseTurnId) {
    throw new Error("A complete Code Attempt review requires its visible specialist review turn ID.");
  }
  const [existingRows, sequenceRows, originatingTurns, reviewTurns] = await Promise.all([
    db.select().from(leetcodeCodeAttempts).where(and(
      eq(leetcodeCodeAttempts.ownerId, ownerId),
      eq(leetcodeCodeAttempts.id, incoming.id),
    )),
    db.select({ id: leetcodeCodeAttempts.id }).from(leetcodeCodeAttempts).where(and(
      eq(leetcodeCodeAttempts.ownerId, ownerId),
      eq(leetcodeCodeAttempts.activityId, incoming.activityId),
      eq(leetcodeCodeAttempts.sequence, incoming.sequence),
    )),
    db.select().from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, incoming.activityId),
      eq(practiceTranscriptTurns.turnId, incoming.originatingTurnId),
    )),
    incoming.reviewResponseTurnId
      ? db.select().from(practiceTranscriptTurns).where(and(
        eq(practiceTranscriptTurns.ownerId, ownerId),
        eq(practiceTranscriptTurns.activityId, incoming.activityId),
        eq(practiceTranscriptTurns.turnId, incoming.reviewResponseTurnId),
      ))
      : Promise.resolve([]),
  ]);
  const sequenceConflict = sequenceRows.find((row) => row.id !== incoming.id);
  if (sequenceConflict) throw new Error(`Code Attempt ${incoming.sequence} already belongs to another code version.`);
  const originatingTurn = originatingTurns[0];
  if (!originatingTurn || originatingTurn.specialty !== "leetcode" || originatingTurn.speaker !== "user") {
    const originSnapshots = await db.select({
      status: voiceCaptureIntents.status,
      transcriptSpeaker: practiceTranscriptTurns.speaker,
    }).from(voiceCaptureIntents).leftJoin(practiceTranscriptTurns, and(
      eq(practiceTranscriptTurns.ownerId, voiceCaptureIntents.ownerId),
      eq(practiceTranscriptTurns.activityId, voiceCaptureIntents.activityId),
      eq(practiceTranscriptTurns.turnId, voiceCaptureIntents.turnId),
    )).where(and(
        eq(voiceCaptureIntents.ownerId, ownerId),
        eq(voiceCaptureIntents.activityId, incoming.activityId),
        eq(voiceCaptureIntents.turnId, incoming.originatingTurnId),
      )).limit(1);
    const originSnapshot = originSnapshots[0];
    if (originSnapshot?.transcriptSpeaker === "user") {
      // The transcript materialized between the initial read and this joined
      // snapshot; continue with the same immutable attempt write.
    } else if (originSnapshot && ["activity_related", "accepted"].includes(originSnapshot.status)) {
      throw Object.assign(
        new Error("The related Voice Code Attempt origin is still materializing; retry the exact write after transcript delivery."),
        { code: "code_attempt_origin_pending", retryable: true },
      );
    } else {
      throw new Error("The Code Attempt originating turn is not an owner-scoped user turn in this activity.");
    }
  }
  const reviewTurn = reviewTurns[0];
  if (review.status === "complete") {
    if (!reviewTurn || reviewTurn.speaker !== "specialist") {
      throw new Error("The visible Code Attempt review is not an owner-scoped specialist turn in this activity.");
    }
    assertCodeAttemptReviewParity(
      review,
      reviewTurn.body,
      codeAttemptEvaluationEvidence(incoming),
    );
  }

  const existing = existingRows[0] ?? null;
  const plan = planCodeAttemptWrite(existing ? storedCodeAttemptWrite(existing) : null, incoming);
  if (plan.kind === "duplicate") return { status: "duplicate" as const, reviewStatus: review.status };
  const values = {
    ownerId,
    ...incoming,
    lineCount: codeLineCount(incoming.code),
    createdAt: nowMs,
    updatedAt: nowMs,
  };
  if (plan.kind === "insert") {
    const noReadyFinalizationGuard = d1TransactionalInvariantGuard(db, sql`NOT EXISTS (
          SELECT 1 FROM ${activityFinalizations}
          WHERE ${activityFinalizations.ownerId} = ${ownerId}
            AND ${activityFinalizations.activityId} = ${incoming.activityId}
            AND ${activityFinalizations.specialty} = 'leetcode'
            AND ${activityFinalizations.status} IN ('ready', 'published')
        )`);
    const exactTranscriptEvidenceGuard = d1TransactionalInvariantGuard(
      db,
      exactCodeAttemptTranscriptEvidenceCondition(
        db,
        ownerId,
        incoming,
        review.status === "complete",
      ),
    );
    try {
      await db.batch([
        noReadyFinalizationGuard,
        exactTranscriptEvidenceGuard,
        db.insert(leetcodeCodeAttempts).values(values),
      ]);
    } catch (error) {
      const message = String(error).toLowerCase();
      if (isD1TransactionalInvariantFailure(error)) {
        const readyFinalization = await db.select({ status: activityFinalizations.status })
          .from(activityFinalizations)
          .where(and(
            eq(activityFinalizations.ownerId, ownerId),
            eq(activityFinalizations.activityId, incoming.activityId),
            eq(activityFinalizations.specialty, "leetcode"),
            inArray(activityFinalizations.status, ["ready", "published"]),
          ));
        if (readyFinalization.length) {
          throw new Error("A Code Attempt cannot be added after its activity is ready or published.");
        }
        throw new Error("The Code Attempt transcript evidence changed during persistence; reread the activity before retrying.");
      }
      if (message.includes("unique constraint")) {
        throw new Error(`Code Attempt ${incoming.sequence} already belongs to another code version.`);
      }
      throw error;
    }
    return { status: "inserted" as const, reviewStatus: review.status };
  }
  if (plan.kind === "backfill_review") throw new Error("Historical review backfill requires the coordinator audit command.");
  const exactTranscriptEvidenceGuard = d1TransactionalInvariantGuard(
    db,
    exactCodeAttemptTranscriptEvidenceCondition(db, ownerId, incoming, review.status === "complete"),
  );
  let updated: Array<{ id: string }> = [];
  try {
    const results = await db.batch([
      exactTranscriptEvidenceGuard,
      db.update(leetcodeCodeAttempts).set({
        review,
        reviewResponseTurnId: incoming.reviewResponseTurnId,
        observedCorrectness: incoming.observedCorrectness,
        concreteFindings: incoming.concreteFindings,
        edgeCases: incoming.edgeCases,
        complexity: incoming.complexity,
        finalDeclaration: incoming.finalDeclaration,
        updatedAt: nowMs,
      }).where(and(
        eq(leetcodeCodeAttempts.ownerId, ownerId),
        eq(leetcodeCodeAttempts.id, incoming.id),
        eq(leetcodeCodeAttempts.updatedAt, existing!.updatedAt),
      )).returning({ id: leetcodeCodeAttempts.id }),
    ]);
    updated = results[1] as Array<{ id: string }>;
  } catch (error) {
    if (isD1TransactionalInvariantFailure(error)) {
      throw new Error("The Code Attempt transcript evidence changed during review completion; reread the activity before retrying.");
    }
    throw error;
  }
  if (!updated.length) throw new Error("The Code Attempt changed during review completion; reread it and retry.");
  return { status: "updated" as const, reviewStatus: review.status };
}

export async function recoverLeetCodeCodeAttempt(
  ownerId: string,
  input: RecoverLeetCodeCodeAttemptInput,
  nowMs: number,
) {
  if (input.authorization !== "explicit_user_instruction") {
    throw new Error("Historical Code Attempt recovery requires explicit user authorization.");
  }
  if (!input.auditReason.trim()) {
    throw new Error("Historical Code Attempt recovery requires a durable audit reason.");
  }

  const db = getDb();
  const review = normalizeCodeAttemptReview(input.review);
  if (!review || review.status !== "complete" || review.provenance !== "specialist_observed") {
    throw new Error("Historical Code Attempt recovery requires a complete specialist-observed review.");
  }
  if (!input.reviewResponseTurnId?.trim()) {
    throw new Error("Historical Code Attempt recovery requires its visible specialist review turn ID.");
  }
  const incoming = codeAttemptWrite({ ...input, review });
  const [finalizationRows, existingRows, sequenceRows, originatingTurns, reviewTurns] = await Promise.all([
    db.select().from(activityFinalizations).where(and(
      eq(activityFinalizations.ownerId, ownerId),
      eq(activityFinalizations.activityId, incoming.activityId),
      eq(activityFinalizations.specialty, "leetcode"),
    )),
    db.select().from(leetcodeCodeAttempts).where(and(
      eq(leetcodeCodeAttempts.ownerId, ownerId),
      eq(leetcodeCodeAttempts.id, incoming.id),
    )),
    db.select({ id: leetcodeCodeAttempts.id }).from(leetcodeCodeAttempts).where(and(
      eq(leetcodeCodeAttempts.ownerId, ownerId),
      eq(leetcodeCodeAttempts.activityId, incoming.activityId),
      eq(leetcodeCodeAttempts.sequence, incoming.sequence),
    )),
    db.select().from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, incoming.activityId),
      eq(practiceTranscriptTurns.turnId, incoming.originatingTurnId),
    )),
    db.select().from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, incoming.activityId),
      eq(practiceTranscriptTurns.turnId, incoming.reviewResponseTurnId!),
    )),
  ]);

  const finalization = finalizationRows[0];
  if (finalization?.status === "published" || typeof finalization?.publishedAt === "number") {
    throw new Error("A published Code Attempt cannot be recovered.");
  }
  if (!finalization || finalization.status !== "ready" || finalization.finalizedAt === null) {
    throw new Error("Historical Code Attempt recovery requires an existing owner-scoped ready finalization.");
  }
  if (incoming.occurredAt > finalization.finalizedAt || review.reviewedAt > finalization.finalizedAt) {
    throw new Error("A recovered Code Attempt and review must predate the ready finalization.");
  }

  const sequenceConflict = sequenceRows.find((row) => row.id !== incoming.id);
  if (sequenceConflict) throw new Error(`Code Attempt ${incoming.sequence} already belongs to another code version.`);
  const originatingTurn = originatingTurns[0];
  if (!originatingTurn || originatingTurn.speaker !== "user") {
    throw new Error("The recovered Code Attempt origin is not an owner-scoped user turn in this activity.");
  }
  const reviewTurn = reviewTurns[0];
  if (!reviewTurn || reviewTurn.specialty !== "leetcode" || reviewTurn.speaker !== "specialist") {
    throw new Error("The recovered Code Attempt review is not an owner-scoped specialist turn in this activity.");
  }
  if (originatingTurn.occurredAt > finalization.finalizedAt || reviewTurn.occurredAt > finalization.finalizedAt) {
    throw new Error("Recovered Code Attempt transcript evidence must predate the ready finalization.");
  }
  assertCodeAttemptReviewParity(review, reviewTurn.body, codeAttemptEvaluationEvidence(incoming));

  const existing = existingRows[0] ?? null;
  const plan = planCodeAttemptWrite(existing ? storedCodeAttemptWrite(existing) : null, incoming);
  if (plan.kind === "duplicate") {
    return { status: "duplicate" as const, reviewStatus: review.status, recovery: true as const };
  }
  if (plan.kind !== "insert") {
    throw new Error("Historical Code Attempt recovery cannot rewrite an existing Code Attempt.");
  }

  const exactReadyFinalizationGuard = d1TransactionalInvariantGuard(db, exists(
    db.select({ one: sql<number>`1` }).from(activityFinalizations).where(and(
      eq(activityFinalizations.ownerId, ownerId),
      eq(activityFinalizations.activityId, incoming.activityId),
      eq(activityFinalizations.specialty, "leetcode"),
      eq(activityFinalizations.status, "ready"),
      isNull(activityFinalizations.publishedAt),
      eq(activityFinalizations.finalizedAt, finalization.finalizedAt),
      eq(activityFinalizations.revision, finalization.revision),
      eq(activityFinalizations.updatedAt, finalization.updatedAt),
    )),
  ));
  const exactTranscriptEvidenceGuard = d1TransactionalInvariantGuard(
    db,
    exactCodeAttemptTranscriptEvidenceCondition(db, ownerId, incoming, true),
  );
  try {
    await db.batch([
      exactReadyFinalizationGuard,
      exactTranscriptEvidenceGuard,
      db.insert(leetcodeCodeAttempts).values({
        ownerId,
        ...incoming,
        lineCount: codeLineCount(incoming.code),
        createdAt: nowMs,
        updatedAt: nowMs,
      }),
    ]);
  } catch (error) {
    if (isD1TransactionalInvariantFailure(error)) {
      const currentFinalization = (await db.select({
        status: activityFinalizations.status,
        publishedAt: activityFinalizations.publishedAt,
      }).from(activityFinalizations).where(and(
        eq(activityFinalizations.ownerId, ownerId),
        eq(activityFinalizations.activityId, incoming.activityId),
      )))[0];
      if (currentFinalization?.status === "published" || typeof currentFinalization?.publishedAt === "number") {
        throw new Error("A published Code Attempt cannot be recovered.");
      }
      throw new Error("The ready finalization or transcript evidence changed during Code Attempt recovery; reread the activity before retrying.");
    }
    if (String(error).toLowerCase().includes("unique constraint")) {
      const settledRows = await db.select().from(leetcodeCodeAttempts).where(and(
        eq(leetcodeCodeAttempts.ownerId, ownerId),
        eq(leetcodeCodeAttempts.id, incoming.id),
      ));
      const settled = settledRows[0];
      if (settled) {
        const settledPlan = planCodeAttemptWrite(storedCodeAttemptWrite(settled), incoming);
        if (settledPlan.kind === "duplicate") {
          return { status: "duplicate" as const, reviewStatus: review.status, recovery: true as const };
        }
      }
      throw new Error(`Code Attempt ${incoming.sequence} already belongs to another code version.`);
    }
    throw error;
  }
  return { status: "inserted" as const, reviewStatus: review.status, recovery: true as const };
}

export async function addPracticeNote(
  ownerId: string,
  note: {
    id: string;
    activityId: string;
    date: string;
    body: string;
    kind?: NoteKind;
    pinned?: boolean;
  },
  nowMs: number,
) {
  const db = getDb();
  await db
    .insert(practiceNotes)
    .values({
      ownerId,
      id: note.id,
      activityId: note.activityId,
      date: note.date,
      body: note.body,
      kind: note.kind ?? "remember",
      pinned: note.pinned ?? true,
      createdAt: nowMs,
      updatedAt: nowMs,
    })
    .onConflictDoUpdate({
      target: [practiceNotes.ownerId, practiceNotes.id],
      set: {
        activityId: note.activityId,
        date: note.date,
        body: note.body,
        kind: note.kind ?? "remember",
        pinned: note.pinned ?? true,
        updatedAt: nowMs,
      },
    });
}

export async function updatePracticeNote(
  ownerId: string,
  noteId: string,
  body: string,
  nowMs: number,
) {
  const db = getDb();
  await db
    .update(practiceNotes)
    .set({ body, updatedAt: nowMs })
    .where(and(eq(practiceNotes.ownerId, ownerId), eq(practiceNotes.id, noteId)));
}

export async function deletePracticeNote(ownerId: string, noteId: string) {
  const db = getDb();
  await db
    .delete(practiceNotes)
    .where(and(eq(practiceNotes.ownerId, ownerId), eq(practiceNotes.id, noteId)));
}

type BehavioralFinalAnswerWritePlan = {
  operationId: string;
  requestFingerprint: string;
  snapshot: BehavioralFinalAnswerSnapshotInput;
  correction?: BehavioralFinalAnswerCorrection;
  result: ReturnType<typeof validateBehavioralFinalAnswerCorrection>;
  replay: boolean;
  resumeContext?: Omit<ActivityResumeContext, "capturedAt">;
  resumeSourceUpdatedAt?: number;
  resumeContextExpectedAbsent: boolean;
  targetBinding?: {
    source: "activity" | "session";
    scopeId: string;
    bindingRevision: number;
    bindingUpdatedAt: number;
    targetId: string;
    targetRevision: number;
  };
  roleBriefBinding?: {
    bindingRevision: number;
    bindingUpdatedAt: number;
    loopId: string;
    loopRevision: number;
    roleBriefRevision: number;
    specialty: "behavioral";
    questionId: string;
  };
};

function validateBehavioralTargetReview(
  payload: SpecialistFinalization,
  snapshot: BehavioralFinalAnswerSnapshotInput,
) {
  const targetReview = payload.behavioralReview
    ? behavioralTargetReviewSchema.parse(payload.behavioralReview)
    : undefined;
  if (snapshot.scope === "target_tailored" && !targetReview) {
    throw new BehavioralFinalAnswerError(
      "behavioral_target_review_required",
      "A target-tailored finalization requires the typed target review.",
    );
  }
  if (snapshot.scope !== "target_tailored" && targetReview) {
    throw new BehavioralFinalAnswerError(
      "behavioral_target_review_scope_mismatch",
      "The typed target review belongs only to a target-tailored final-answer snapshot.",
    );
  }
  if (!targetReview) return undefined;

  const universalStrengths = payload.review.didWell.map((item) => item.trim());
  const universalImprovements = payload.review.improve.map((item) => item.trim());
  if (
    JSON.stringify(targetReview.universalQuality.strengths) !== JSON.stringify(universalStrengths)
    || JSON.stringify(targetReview.universalQuality.improvements) !== JSON.stringify(universalImprovements)
  ) {
    throw new BehavioralFinalAnswerError(
      "behavioral_target_review_universal_mismatch",
      "The target review must reuse the finalization's universal strengths and improvements exactly.",
    );
  }
  if (JSON.stringify(targetReview.evidenceGaps) !== JSON.stringify(snapshot.evidenceGaps)) {
    throw new BehavioralFinalAnswerError(
      "behavioral_target_review_evidence_mismatch",
      "The target review must reuse the final-answer evidence gaps exactly.",
    );
  }
  const targetSignals = new Set(
    snapshot.roleBrief?.competencyEmphasis
    ?? snapshot.target?.competencyEmphasis
    ?? [],
  );
  if (targetReview.targetAlignment.competencySignals.some((signal) => !targetSignals.has(signal))) {
    throw new BehavioralFinalAnswerError(
      "behavioral_target_review_signal_mismatch",
      "Target review signals must come from the exact final-answer Role Brief or historical Target Profile snapshot.",
    );
  }
  return targetReview;
}

function validateBehavioralAttemptAnalysis(
  payload: SpecialistFinalization,
  snapshot: BehavioralFinalAnswerSnapshotInput,
) {
  const analysis = snapshot.behavioralAnalysis;
  if (!analysis) {
    throw new BehavioralFinalAnswerError(
      "behavioral_attempt_analysis_required",
      "Every new completed behavioral finalization requires typed Behavioral Attempt analysis.",
    );
  }
  if (
    JSON.stringify(analysis.strengths) !== JSON.stringify(payload.review.didWell.map((item) => item.trim()))
    || JSON.stringify(analysis.improvements) !== JSON.stringify(payload.review.improve.map((item) => item.trim()))
  ) {
    throw new BehavioralFinalAnswerError(
      "behavioral_attempt_review_mismatch",
      "Behavioral Attempt strengths and improvements must reuse the visible review exactly.",
    );
  }
  const supportingIds = new Set(analysis.claimAudit.flatMap((claim) => claim.supportingEvidenceIds));
  const contraryIds = new Set(analysis.claimAudit.flatMap((claim) => claim.contraryEvidenceIds));
  const gapSet = new Set(analysis.claimAudit.flatMap((claim) => claim.gaps));
  const contradictionSet = new Set(analysis.claimAudit.flatMap((claim) => claim.contradictions));
  const sameSet = (left: Set<string>, right: string[]) => left.size === new Set(right).size
    && right.every((item) => left.has(item));
  if ([...supportingIds].some((id) => !snapshot.acceptedEvidenceIds.includes(id))) {
    throw new BehavioralFinalAnswerError(
      "behavioral_attempt_support_mismatch",
      "Claim support must come from the final answer's exact accepted evidence IDs.",
    );
  }
  if (!sameSet(gapSet, snapshot.evidenceGaps) || !sameSet(contradictionSet, snapshot.contradictions)) {
    throw new BehavioralFinalAnswerError(
      "behavioral_attempt_claim_audit_mismatch",
      "Claim gaps and contradictions must exactly explain the final-answer snapshot metadata.",
    );
  }
  return { analysis, contraryEvidenceIds: [...contraryIds] };
}

async function prepareBehavioralFinalAnswerWrite(
  db: ReturnType<typeof getDb>,
  ownerId: string,
  activityId: string,
  specialty: Specialty,
  questionId: string | null,
  payload: SpecialistFinalization,
): Promise<BehavioralFinalAnswerWritePlan | null> {
  const hasSnapshotFields = Boolean(
    payload.finalAnswerOperationId
    || payload.finalAnswerSnapshot
    || payload.finalAnswerCorrection
    || payload.behavioralReview
    || payload.behavioralAnalysis
    || payload.resumeContext,
  );
  if (specialty !== "behavioral") {
    if (hasSnapshotFields) {
      throw new BehavioralFinalAnswerError(
        "behavioral_final_answer_specialty_mismatch",
        "Final-answer snapshots are supported only for behavioral finalizations.",
      );
    }
    return null;
  }
  if (!payload.complete) {
    if (hasSnapshotFields) {
      throw new BehavioralFinalAnswerError(
        "behavioral_final_answer_incomplete",
        "A final-answer snapshot belongs only to a completed behavioral finalization.",
      );
    }
    return null;
  }
  if (!questionId || !payload.finalAnswerOperationId || !payload.finalAnswerSnapshot) {
    throw new BehavioralFinalAnswerError(
      "behavioral_final_answer_required",
      "Every new completed behavioral finalization requires a stable operation ID and a typed final-answer snapshot.",
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,199}$/.test(payload.finalAnswerOperationId)) {
    throw new BehavioralFinalAnswerError(
      "behavioral_final_answer_invalid_operation",
      "finalAnswerOperationId must be a lowercase stable ID.",
    );
  }
  const nestedAnalysis = payload.finalAnswerSnapshot.behavioralAnalysis;
  const topLevelAnalysis = payload.behavioralAnalysis
    ? behavioralAttemptAnalysisSchema.parse(payload.behavioralAnalysis)
    : undefined;
  if (nestedAnalysis && topLevelAnalysis && JSON.stringify(nestedAnalysis) !== JSON.stringify(topLevelAnalysis)) {
    throw new BehavioralFinalAnswerError(
      "behavioral_attempt_analysis_mismatch",
      "The top-level and immutable-snapshot Behavioral Attempt analyses must be identical.",
    );
  }
  const snapshot = behavioralFinalAnswerSnapshotInputSchema.parse({
    ...payload.finalAnswerSnapshot,
    behavioralAnalysis: topLevelAnalysis ?? nestedAnalysis,
  });
  const targetReview = validateBehavioralTargetReview(payload, snapshot);
  if (snapshot.question.questionId !== questionId) {
    throw new BehavioralFinalAnswerError(
      "behavioral_final_answer_question_mismatch",
      "The final-answer snapshot question does not match the activity question.",
    );
  }
  if (snapshot.answer !== payload.modelAnswer) {
    throw new BehavioralFinalAnswerError(
      "behavioral_final_answer_body_mismatch",
      "modelAnswer and finalAnswerSnapshot.answer must be exactly identical.",
    );
  }
  const resumeSelection = payload.resumeContext
    ? resumeContextSelectionSchema.parse(payload.resumeContext)
    : undefined;
  const requestFingerprint = await behavioralFinalAnswerFingerprint({
    activityId,
    questionId,
    snapshot,
    correction: payload.finalAnswerCorrection,
    behavioralReview: targetReview,
    resumeContext: resumeSelection,
  });
  const existingOperation = await db.select().from(behavioralFinalAnswerSnapshots).where(and(
    eq(behavioralFinalAnswerSnapshots.ownerId, ownerId),
    eq(behavioralFinalAnswerSnapshots.operationId, payload.finalAnswerOperationId),
  ));
  if (existingOperation[0]) {
    if (existingOperation[0].requestFingerprint !== requestFingerprint) {
      throw new BehavioralFinalAnswerError(
        "behavioral_final_answer_operation_conflict",
        "This final-answer operation ID is already bound to a different immutable request.",
      );
    }
    return {
      operationId: payload.finalAnswerOperationId,
      requestFingerprint,
      snapshot,
      correction: payload.finalAnswerCorrection,
      result: { status: "unchanged", snapshotRevision: existingOperation[0].snapshotRevision },
      replay: true,
      resumeContextExpectedAbsent: false,
    };
  }
  const attemptAnalysis = validateBehavioralAttemptAnalysis(payload, snapshot);
  let targetBinding: BehavioralFinalAnswerWritePlan["targetBinding"];
  let roleBriefBinding: BehavioralFinalAnswerWritePlan["roleBriefBinding"];
  if (snapshot.scope === "target_tailored") {
    if (snapshot.roleBrief) {
      const roleBrief = snapshot.roleBrief;
      const boundLoop = await readBoundLoopActivityContext(ownerId, activityId);
      if (
        !boundLoop
        || boundLoop.binding.specialty !== "behavioral"
        || boundLoop.binding.questionId !== questionId
        || boundLoop.binding.loopId !== roleBrief.loopId
        || boundLoop.binding.roleBriefRevision !== roleBrief.revision
      ) {
        throw new BehavioralFinalAnswerError(
          "behavioral_role_brief_binding_mismatch",
          "The tailored answer does not match the activity's exact Loop and Role Brief binding.",
        );
      }
      if (
        boundLoop.roleBrief.label !== roleBrief.label
        || boundLoop.roleBrief.company !== roleBrief.company
        || boundLoop.roleBrief.roleTitle !== roleBrief.roleTitle
        || roleBrief.competencyEmphasis.some(
          (signal) => !boundLoop.roleBrief.competencySignals.includes(signal),
        )
      ) {
        throw new BehavioralFinalAnswerError(
          "behavioral_role_brief_snapshot_mismatch",
          "The display-safe answer context does not match the bound immutable Role Brief revision.",
        );
      }
      roleBriefBinding = {
        bindingRevision: boundLoop.binding.revision,
        bindingUpdatedAt: boundLoop.binding.updatedAt,
        loopId: boundLoop.binding.loopId,
        loopRevision: boundLoop.binding.loopRevision,
        roleBriefRevision: boundLoop.binding.roleBriefRevision,
        specialty: "behavioral",
        questionId: boundLoop.binding.questionId,
      };
    } else {
      const target = snapshot.target!;
      const resolvedTarget = await resolveBehavioralTarget(ownerId, { activityId });
      if (
        !resolvedTarget.target
        || !resolvedTarget.binding
        || resolvedTarget.source === "none"
        || resolvedTarget.target.targetId !== target.targetId
        || resolvedTarget.target.revision !== target.revision
      ) {
        throw new BehavioralFinalAnswerError(
          "behavioral_target_binding_mismatch",
          "The historical target-tailored answer does not match the activity's exact Target Profile binding.",
        );
      }
      if (
        resolvedTarget.target.label !== target.label
        || target.competencyEmphasis.some(
          (signal) => !resolvedTarget.target!.competencySignals.includes(signal),
        )
      ) {
        throw new BehavioralFinalAnswerError(
          "behavioral_target_profile_mismatch",
          "The display-safe target snapshot does not match its historical Target Profile revision.",
        );
      }
      targetBinding = {
        source: resolvedTarget.source,
        scopeId: resolvedTarget.binding.scopeId,
        bindingRevision: resolvedTarget.binding.revision,
        bindingUpdatedAt: resolvedTarget.binding.updatedAt,
        targetId: target.targetId,
        targetRevision: target.revision,
      };
    }
  }
  const responseTurns = await db.select({
    body: practiceTranscriptTurns.body,
    specialty: practiceTranscriptTurns.specialty,
    speaker: practiceTranscriptTurns.speaker,
  }).from(practiceTranscriptTurns).where(and(
    eq(practiceTranscriptTurns.ownerId, ownerId),
    eq(practiceTranscriptTurns.activityId, activityId),
    eq(practiceTranscriptTurns.turnId, snapshot.provenance.responseTurnId),
  ));
  const responseTurn = responseTurns[0];
  if (
    !responseTurn
    || responseTurn.specialty !== "behavioral"
    || responseTurn.speaker !== "specialist"
    || !responseTurn.body.includes(snapshot.answer)
  ) {
    throw new BehavioralFinalAnswerError(
      "behavioral_final_answer_response_not_found",
      "The snapshot answer must appear in the exact owner-scoped behavioral specialist response turn.",
    );
  }
  if (snapshot.acceptedEvidenceIds.length) {
    const acceptedEvidence = await db.select({
      evidenceId: behavioralEvidenceItems.evidenceId,
    }).from(behavioralEvidenceItems).innerJoin(
      behavioralEvidenceQuestionLinks,
      and(
        eq(behavioralEvidenceQuestionLinks.ownerId, behavioralEvidenceItems.ownerId),
        eq(behavioralEvidenceQuestionLinks.evidenceId, behavioralEvidenceItems.evidenceId),
      ),
    ).where(and(
      eq(behavioralEvidenceItems.ownerId, ownerId),
      eq(behavioralEvidenceItems.candidateState, "accepted"),
      eq(behavioralEvidenceQuestionLinks.questionId, questionId),
      eq(behavioralEvidenceQuestionLinks.relevance, "supporting"),
      inArray(behavioralEvidenceItems.evidenceId, snapshot.acceptedEvidenceIds),
    ));
    const acceptedIds = new Set(acceptedEvidence.map((item) => item.evidenceId));
    const missing = snapshot.acceptedEvidenceIds.filter((evidenceId) => !acceptedIds.has(evidenceId));
    if (missing.length) {
      throw new BehavioralFinalAnswerError(
        "behavioral_final_answer_evidence_mismatch",
        "The snapshot references evidence that is not accepted supporting evidence for this exact question.",
      );
    }
  }
  if (snapshot.story) {
    if (!snapshot.story.revision) {
      throw new BehavioralFinalAnswerError(
        "behavioral_final_answer_story_revision_required",
        "Every new Story Bank selection requires its exact current revision.",
      );
    }
    const storyIdentity = { storyId: snapshot.story.storyId, revision: snapshot.story.revision };
    const storyRows = await db.select({
      currentRevision: behavioralStories.currentRevision,
      state: behavioralStories.state,
      snapshot: behavioralStoryRevisions.snapshot,
    }).from(behavioralStories).innerJoin(
      behavioralStoryRevisions,
      and(
        eq(behavioralStoryRevisions.ownerId, behavioralStories.ownerId),
        eq(behavioralStoryRevisions.storyId, behavioralStories.storyId),
        eq(behavioralStoryRevisions.revision, storyIdentity.revision),
      ),
    ).where(and(
      eq(behavioralStories.ownerId, ownerId),
      eq(behavioralStories.storyId, storyIdentity.storyId),
    )).limit(1);
    const storyRow = storyRows[0];
    if (!storyRow || storyRow.state !== "active" || storyRow.currentRevision !== storyIdentity.revision) {
      throw new BehavioralFinalAnswerError(
        "behavioral_final_answer_story_mismatch",
        "The final answer must reference the exact current owner-private Story Bank revision.",
      );
    }
    const story = behavioralStoryInputSchema.parse(storyRow.snapshot);
    if (!story.questionIds.includes(questionId)
        || story.evidenceIds.some((evidenceId) => !snapshot.acceptedEvidenceIds.includes(evidenceId))) {
      throw new BehavioralFinalAnswerError(
        "behavioral_final_answer_story_mismatch",
        "The selected Story Bank revision must belong to this question and reuse its accepted evidence links.",
      );
    }
  }
  if (attemptAnalysis.contraryEvidenceIds.length) {
    const contraryEvidence = await db.select({
      evidenceId: behavioralEvidenceItems.evidenceId,
    }).from(behavioralEvidenceItems).innerJoin(
      behavioralEvidenceQuestionLinks,
      and(
        eq(behavioralEvidenceQuestionLinks.ownerId, behavioralEvidenceItems.ownerId),
        eq(behavioralEvidenceQuestionLinks.evidenceId, behavioralEvidenceItems.evidenceId),
      ),
    ).where(and(
      eq(behavioralEvidenceItems.ownerId, ownerId),
      eq(behavioralEvidenceItems.candidateState, "accepted"),
      eq(behavioralEvidenceQuestionLinks.questionId, questionId),
      eq(behavioralEvidenceQuestionLinks.relevance, "contrary"),
      inArray(behavioralEvidenceItems.evidenceId, attemptAnalysis.contraryEvidenceIds),
    ));
    if (new Set(contraryEvidence.map((item) => item.evidenceId)).size !== attemptAnalysis.contraryEvidenceIds.length) {
      throw new BehavioralFinalAnswerError(
        "behavioral_attempt_contrary_evidence_mismatch",
        "Claim contradictions must reference accepted contrary evidence for this exact question.",
      );
    }
  }
  const currentResumeRows = await db.select({
    resumeId: resumeSources.resumeId,
    currentRevisionId: resumeSources.currentRevisionId,
    sourceLabel: resumeSources.sourceLabel,
    updatedAt: resumeSources.updatedAt,
  }).from(resumeSources).where(and(
    eq(resumeSources.ownerId, ownerId),
    isNotNull(resumeSources.currentRevisionId),
  ));
  if (currentResumeRows.length && !resumeSelection) {
    throw new BehavioralFinalAnswerError(
      "behavioral_resume_context_required",
      "A current resume exists; include its exact resume and revision IDs in the completed behavioral finalization.",
    );
  }
  const selectedResume = resumeSelection
    ? currentResumeRows.find((row) => row.resumeId === resumeSelection.resumeId)
    : undefined;
  if (resumeSelection && selectedResume?.currentRevisionId !== resumeSelection.revisionId) {
    throw new BehavioralFinalAnswerError(
      "behavioral_resume_context_mismatch",
      "The selected resume revision is not the current owner-scoped revision; reread the Resume Library before retrying.",
      true,
    );
  }
  const selectedRevisionRows = resumeSelection ? await db.select({
    importedAt: resumeRevisions.importedAt,
  }).from(resumeRevisions).where(and(
    eq(resumeRevisions.ownerId, ownerId),
    eq(resumeRevisions.resumeId, resumeSelection.resumeId),
    eq(resumeRevisions.revisionId, resumeSelection.revisionId),
  )).limit(1) : [];
  if (resumeSelection && !selectedRevisionRows[0]) {
    throw new BehavioralFinalAnswerError(
      "behavioral_resume_context_mismatch",
      "The selected resume revision is unavailable to this owner.",
    );
  }
  const auditClaimTexts = attemptAnalysis.analysis.claimAudit.map((claim) => claim.claim);
  const linkedClaimRows = resumeSelection && auditClaimTexts.length ? await db.select({
    claimId: behavioralClaims.claimId,
  }).from(behavioralClaims).where(and(
    eq(behavioralClaims.ownerId, ownerId),
    eq(behavioralClaims.questionId, questionId),
    inArray(behavioralClaims.text, auditClaimTexts),
  )).orderBy(asc(behavioralClaims.claimId)).limit(101) : [];
  if (linkedClaimRows.length > 100) {
    throw new BehavioralFinalAnswerError(
      "behavioral_resume_context_too_large",
      "The exact behavioral claim context exceeds the bounded snapshot limit.",
    );
  }
  const contextEvidenceIds = [...new Set([
    ...snapshot.acceptedEvidenceIds,
    ...attemptAnalysis.contraryEvidenceIds,
  ])].sort();
  if (contextEvidenceIds.length > 100) {
    throw new BehavioralFinalAnswerError(
      "behavioral_resume_context_too_large",
      "The exact behavioral evidence context exceeds the bounded snapshot limit.",
    );
  }
  const priorRows = await db.select().from(behavioralFinalAnswerSnapshots).where(and(
    eq(behavioralFinalAnswerSnapshots.ownerId, ownerId),
    eq(behavioralFinalAnswerSnapshots.activityId, activityId),
  )).orderBy(desc(behavioralFinalAnswerSnapshots.snapshotRevision)).limit(1);
  const prior = priorRows[0]
    ? {
        snapshotRevision: priorRows[0].snapshotRevision,
        snapshot: behavioralFinalAnswerSnapshotInputSchema.parse(priorRows[0].snapshot),
      }
    : null;
  const result = validateBehavioralFinalAnswerCorrection(prior, snapshot, payload.finalAnswerCorrection);
  if (result.status === "unchanged") {
    throw new BehavioralFinalAnswerError(
      "behavioral_final_answer_operation_conflict",
      "This exact snapshot already exists; retry with its original operation ID instead of creating another identity.",
    );
  }
  return {
    operationId: payload.finalAnswerOperationId,
    requestFingerprint,
    snapshot,
    correction: payload.finalAnswerCorrection,
    result,
    replay: false,
    targetBinding,
    resumeContext: selectedResume && selectedRevisionRows[0] ? {
      schemaVersion: 1,
      state: "contemporaneous",
      snapshotRevision: result.snapshotRevision,
      resumeId: selectedResume.resumeId,
      resumeRevisionId: selectedResume.currentRevisionId!,
      sourceLabel: selectedResume.sourceLabel,
      resumeImportedAt: selectedRevisionRows[0].importedAt,
      claimIds: linkedClaimRows.map((row) => row.claimId),
      evidenceIds: contextEvidenceIds,
    } : undefined,
    resumeSourceUpdatedAt: selectedResume?.updatedAt,
    resumeContextExpectedAbsent: !selectedResume,
    roleBriefBinding,
  };
}

export async function saveSpecialistFinalization(
  ownerId: string,
  activityId: string,
  specialty: Specialty,
  questionId: string | null,
  payload: SpecialistFinalization,
  nowMs: number,
  durableIdentity?: { operationId: string; requestFingerprint: string },
) {
  const db = getDb();
  // Preserve the established behavioral validation precedence before checking
  // the cross-specialty interaction-mode sidecar.
  const behavioralFinalAnswer = await prepareBehavioralFinalAnswerWrite(
    db,
    ownerId,
    activityId,
    specialty,
    questionId,
    payload,
  );
  const interactionModeClassification = await prepareInteractionModeClassificationWrite({
    ownerId,
    activityId,
    complete: payload.complete,
    operationId: payload.interactionModeClassificationOperationId,
    evidence: payload.interactionModeEvidence,
    correction: payload.interactionModeClassificationCorrection,
  });
  if (payload.complete) {
    await assertPracticeRecordFinalizationPreconditions({ ownerId, activityId, finalization: payload });
  }
  if (behavioralFinalAnswer?.replay || interactionModeClassification?.replay) {
    if (
      (behavioralFinalAnswer && !behavioralFinalAnswer.replay)
      || (interactionModeClassification && !interactionModeClassification.replay)
    ) {
      throw new Error("Finalization replay identities do not refer to the same immutable write.");
    }
    if (payload.complete && (!questionId || !durableIdentity)) {
      throw new Error("A complete finalization needs its durable operation identity and stable questionId.");
    }
    const practiceRecord = payload.complete
      ? await persistFinalizedPracticeRecord({
          ownerId,
          activityId,
          specialty,
          questionId: questionId!,
          finalization: payload,
          operationId: durableIdentity!.operationId,
          requestFingerprint: durableIdentity!.requestFingerprint,
          nowMs,
        })
      : null;
    return {
      finalAnswer: behavioralFinalAnswer?.result ?? null,
      interactionModeClassification: interactionModeClassification?.classification ?? null,
      practiceRecord,
    };
  }
  const transcriptState = payload.complete
    ? await readActivityTranscriptState(db, ownerId, activityId)
    : null;
  if (payload.complete && specialty === "leetcode") {
    const attempts = await db.select({
      id: leetcodeCodeAttempts.id,
      review: leetcodeCodeAttempts.review,
    }).from(leetcodeCodeAttempts).where(and(
      eq(leetcodeCodeAttempts.ownerId, ownerId),
      eq(leetcodeCodeAttempts.activityId, activityId),
    ));
    const pendingAttemptIds = pendingCodeAttemptReviewIds(attempts);
    if (pendingAttemptIds.length) {
      throw new Error(`Complete every pending Code Attempt review before finalization: ${pendingAttemptIds.join(", ")}.`);
    }
  }
  if (payload.complete) {
    const voiceGuard = await prepareVoiceCapturesForFinish(ownerId, activityId, nowMs);
    const voiceConflict = voiceFinishGuardMessage(voiceGuard);
    if (voiceConflict) throw new Error(voiceConflict);
  }
  const profileAction = payload.solutionProfileAction ?? "create_or_revise";
  const projectBinding = payload.complete && specialty === "behavioral" && questionId
    ? await readCurrentBehavioralProjectBinding(ownerId, questionId)
    : null;
  if (payload.questionMetadata) {
    if (specialty !== "leetcode") {
      throw new Error("Question metadata enrichment is currently supported only for LeetCode finalizations.");
    }
    validateLeetCodeQuestionMetadata(payload.questionMetadata);
  }
  let currentProfile: typeof problemSolutionProfiles.$inferSelect | undefined;
  if (payload.complete) {
    if (!questionId) throw new Error("A complete finalization needs the stable questionId.");
    const rows = await db.select().from(problemSolutionProfiles).where(and(
      eq(problemSolutionProfiles.ownerId, ownerId),
      eq(problemSolutionProfiles.specialty, specialty),
      eq(problemSolutionProfiles.questionId, questionId),
    ));
    currentProfile = rows[0];
    if (profileAction === "reuse_current") {
      if (currentProfile) validateSolutionProfile(
        specialty,
        currentProfile.payload as NonNullable<SpecialistFinalization["solutionProfile"]>,
        projectBinding,
      );
      if (!currentProfile) {
        const category = specialty === "system_design" ? "systemDesign" : specialty;
        const canonicalRows = await db.select({ payload: contentBank.payload }).from(contentBank).where(and(
          eq(contentBank.category, category),
          eq(contentBank.id, questionId),
        ));
        const canonicalQuestion = canonicalRows[0]?.payload as {
          solutionProfile?: NonNullable<SpecialistFinalization["solutionProfile"]>;
        } | undefined;
        if (!canonicalQuestion?.solutionProfile) {
          throw new Error("Cannot reuse a Solution Profile that does not exist.");
        }
        validateSolutionProfile(specialty, canonicalQuestion.solutionProfile, projectBinding);
        const profile = normalizedSolutionProfile(canonicalQuestion.solutionProfile, payload.references);
        if (behavioralFinalAnswer && behavioralFinalAnswer.snapshot.solutionProfile.revision !== 1) {
          throw new BehavioralFinalAnswerError(
            "behavioral_final_answer_solution_revision_mismatch",
            "The first seeded Solution Profile is revision 1; the snapshot named a different revision.",
          );
        }
        await db.insert(problemSolutionProfiles).values({
          ownerId,
          specialty,
          questionId,
          title: payload.title,
          currentRevision: 1,
          tags: profile.tags,
          payload: profile,
          updatedAt: nowMs,
        });
        await db.insert(problemSolutionRevisions).values({
          ownerId,
          specialty,
          questionId,
          revision: 1,
          activityId,
          payload: profile,
          createdAt: nowMs,
        });
        const seeded = await db.select().from(problemSolutionProfiles).where(and(
          eq(problemSolutionProfiles.ownerId, ownerId),
          eq(problemSolutionProfiles.specialty, specialty),
          eq(problemSolutionProfiles.questionId, questionId),
        ));
        currentProfile = seeded[0];
      }
    } else {
      validateSolutionProfile(specialty, payload.solutionProfile, projectBinding);
    }
  }
  if (behavioralFinalAnswer && questionId) {
    let expectedRevision: number;
    if (profileAction === "reuse_current") {
      if (!currentProfile) {
        throw new BehavioralFinalAnswerError(
          "behavioral_final_answer_solution_revision_mismatch",
          "The final-answer snapshot cannot reference a missing Solution Profile revision.",
        );
      }
      expectedRevision = currentProfile.currentRevision;
    } else {
      const normalized = normalizedSolutionProfile(payload.solutionProfile!, payload.references);
      expectedRevision = currentProfile
        && profileFingerprint(currentProfile.payload as NonNullable<SpecialistFinalization["solutionProfile"]>) === profileFingerprint(normalized)
        ? currentProfile.currentRevision
        : (currentProfile?.currentRevision ?? 0) + 1;
    }
    if (behavioralFinalAnswer.snapshot.solutionProfile.revision !== expectedRevision) {
      throw new BehavioralFinalAnswerError(
        "behavioral_final_answer_solution_revision_mismatch",
        "The final-answer snapshot must name the exact Solution Profile revision this finalization will link.",
      );
    }
  }
  if (payload.complete && specialty === "leetcode" && questionId) {
    const profileTags = profileAction === "reuse_current"
      ? ((currentProfile?.tags ?? []) as string[])
      : normalizedTags(payload.solutionProfile?.tags ?? []);
    // Enrichment is independently useful and idempotent. Complete it before
    // the activity can become ready so a failed metadata write is safely
    // retried instead of leaving a ready finalization without its bank update.
    await enrichPersonalLeetCodeQuestion(ownerId, questionId, profileTags, payload.questionMetadata, nowMs);
  }
  let linkedRevision: number | null = null;
  if (payload.complete && questionId && profileAction === "reuse_current" && currentProfile) {
    linkedRevision = currentProfile.currentRevision;
  }
  if (payload.complete && questionId && profileAction === "create_or_revise" && payload.solutionProfile) {
    const profile = normalizedSolutionProfile(payload.solutionProfile, payload.references);
    const priorProfile = currentProfile;
    if (priorProfile && profileFingerprint(priorProfile.payload as NonNullable<SpecialistFinalization["solutionProfile"]>) === profileFingerprint(profile)) {
      linkedRevision = priorProfile.currentRevision;
    } else {
      const revision = (priorProfile?.currentRevision ?? 0) + 1;
      const profileCondition = priorProfile
        ? sql`EXISTS (
            SELECT 1 FROM ${problemSolutionProfiles}
            WHERE ${problemSolutionProfiles.ownerId} = ${ownerId}
              AND ${problemSolutionProfiles.specialty} = ${specialty}
              AND ${problemSolutionProfiles.questionId} = ${questionId}
              AND ${problemSolutionProfiles.currentRevision} = ${priorProfile.currentRevision}
              AND ${problemSolutionProfiles.updatedAt} = ${priorProfile.updatedAt}
          )`
        : sql`NOT EXISTS (
            SELECT 1 FROM ${problemSolutionProfiles}
            WHERE ${problemSolutionProfiles.ownerId} = ${ownerId}
              AND ${problemSolutionProfiles.specialty} = ${specialty}
              AND ${problemSolutionProfiles.questionId} = ${questionId}
          )`;
      try {
        await db.batch([
          d1TransactionalInvariantGuard(db, profileCondition),
          db.insert(problemSolutionProfiles)
            .values({ ownerId, specialty, questionId, title: payload.title, currentRevision: revision, tags: profile.tags, payload: profile, updatedAt: nowMs })
            .onConflictDoUpdate({
              target: [problemSolutionProfiles.ownerId, problemSolutionProfiles.specialty, problemSolutionProfiles.questionId],
              set: { title: payload.title, currentRevision: revision, tags: profile.tags, payload: profile, updatedAt: nowMs },
            }),
          db.insert(problemSolutionRevisions).values({
            ownerId,
            specialty,
            questionId,
            revision,
            activityId,
            payload: profile,
            createdAt: nowMs,
          }),
        ] as unknown as Parameters<typeof db.batch>[0]);
      } catch (error) {
        const [settledProfiles, settledRevisions] = await Promise.all([
          db.select().from(problemSolutionProfiles).where(and(
            eq(problemSolutionProfiles.ownerId, ownerId),
            eq(problemSolutionProfiles.specialty, specialty),
            eq(problemSolutionProfiles.questionId, questionId),
          )).limit(1),
          db.select().from(problemSolutionRevisions).where(and(
            eq(problemSolutionRevisions.ownerId, ownerId),
            eq(problemSolutionRevisions.specialty, specialty),
            eq(problemSolutionRevisions.questionId, questionId),
            eq(problemSolutionRevisions.revision, revision),
          )).limit(1),
        ]);
        const settledProfile = settledProfiles[0];
        const settledRevision = settledRevisions[0];
        const exactConcurrentWrite = settledProfile?.currentRevision === revision
          && Boolean(settledRevision)
          && profileFingerprint(settledProfile.payload as NonNullable<SpecialistFinalization["solutionProfile"]>) === profileFingerprint(profile)
          && profileFingerprint(settledRevision!.payload as NonNullable<SpecialistFinalization["solutionProfile"]>) === profileFingerprint(profile);
        if (!exactConcurrentWrite) {
          if (isD1TransactionalInvariantFailure(error)) {
            throw new Error("The Solution Profile changed during finalization; reread it before retrying.");
          }
          throw error;
        }
      }
      linkedRevision = revision;
    }
    await db.delete(provisionalSolutionProfiles).where(and(
      eq(provisionalSolutionProfiles.ownerId, ownerId),
      eq(provisionalSolutionProfiles.specialty, specialty),
      eq(provisionalSolutionProfiles.questionId, questionId),
    ));
  }
  if (payload.complete && questionId && linkedRevision !== null) {
    await db
      .insert(activitySolutionLinks)
      .values({ ownerId, activityId, specialty, questionId, solutionRevision: linkedRevision, updatedAt: nowMs })
      .onConflictDoUpdate({
        target: [activitySolutionLinks.ownerId, activitySolutionLinks.activityId],
        set: { specialty, questionId, solutionRevision: linkedRevision, updatedAt: nowMs },
      });
  }
  if (behavioralFinalAnswer && linkedRevision !== behavioralFinalAnswer.snapshot.solutionProfile.revision) {
    throw new BehavioralFinalAnswerError(
      "behavioral_final_answer_solution_revision_mismatch",
      "The final-answer snapshot does not reference the exact Solution Profile revision linked to this attempt.",
    );
  }
  const behavioralProjectLink = payload.complete && specialty === "behavioral" && questionId && linkedRevision !== null
    ? await prepareBehavioralProjectFinalizationLink({
        ownerId,
        activityId,
        questionId,
        solutionRevision: linkedRevision,
        profile: (profileAction === "reuse_current"
          ? currentProfile?.payload
          : payload.solutionProfile) as NonNullable<SpecialistFinalization["solutionProfile"]>,
      })
    : null;

  // A complete semantic bundle remains draft/pending until its immutable
  // Practice Record batch and exact readback promote it to ready.
  const status = "draft";
  const finalizationWrite = db
    .insert(activityFinalizations)
    .values({
      ownerId,
      activityId,
      specialty,
      status,
      payload,
      finalizedAt: payload.complete ? nowMs : null,
      publishedAt: null,
      revision: 1,
      updatedAt: nowMs,
    })
    .onConflictDoUpdate({
      target: [activityFinalizations.ownerId, activityFinalizations.activityId],
      set: {
        specialty,
        status,
        payload,
        finalizedAt: payload.complete ? nowMs : null,
        publishedAt: behavioralFinalAnswer ? null : sql`${activityFinalizations.publishedAt}`,
        revision: sql`${activityFinalizations.revision} + 1`,
        updatedAt: nowMs,
      },
    });
  const finalizationGuards = [];
  if (transcriptState) {
    finalizationGuards.push(d1TransactionalInvariantGuard(
      db,
      exactActivityTranscriptStateCondition(ownerId, activityId, transcriptState),
    ));
  }
  if (payload.complete && specialty === "leetcode") {
    finalizationGuards.push(d1TransactionalInvariantGuard(db, sql`NOT EXISTS (
          SELECT 1 FROM ${leetcodeCodeAttempts}
          WHERE ${leetcodeCodeAttempts.ownerId} = ${ownerId}
            AND ${leetcodeCodeAttempts.activityId} = ${activityId}
            AND json_extract(${leetcodeCodeAttempts.review}, '$.schemaVersion') = 1
            AND json_extract(${leetcodeCodeAttempts.review}, '$.status') = 'pending'
        )`));
  }
  if (behavioralFinalAnswer && questionId) {
    finalizationGuards.push(d1TransactionalInvariantGuard(db, sql`EXISTS (
      SELECT 1 FROM ${activitySolutionLinks}
      WHERE ${activitySolutionLinks.ownerId} = ${ownerId}
        AND ${activitySolutionLinks.activityId} = ${activityId}
        AND ${activitySolutionLinks.specialty} = 'behavioral'
        AND ${activitySolutionLinks.questionId} = ${questionId}
        AND ${activitySolutionLinks.solutionRevision} = ${behavioralFinalAnswer.snapshot.solutionProfile.revision}
    )`));
    if (behavioralFinalAnswer.snapshot.acceptedEvidenceIds.length) {
      finalizationGuards.push(d1TransactionalInvariantGuard(db, sql`(
        SELECT count(*) FROM ${behavioralEvidenceItems}
        INNER JOIN ${behavioralEvidenceQuestionLinks}
          ON ${behavioralEvidenceQuestionLinks.ownerId} = ${behavioralEvidenceItems.ownerId}
          AND ${behavioralEvidenceQuestionLinks.evidenceId} = ${behavioralEvidenceItems.evidenceId}
        WHERE ${behavioralEvidenceItems.ownerId} = ${ownerId}
          AND ${behavioralEvidenceItems.candidateState} = 'accepted'
          AND ${behavioralEvidenceQuestionLinks.questionId} = ${questionId}
          AND ${behavioralEvidenceQuestionLinks.relevance} = 'supporting'
          AND ${inArray(behavioralEvidenceItems.evidenceId, behavioralFinalAnswer.snapshot.acceptedEvidenceIds)}
      ) = ${behavioralFinalAnswer.snapshot.acceptedEvidenceIds.length}`));
    }
    if (behavioralFinalAnswer.snapshot.story) {
      const story = behavioralFinalAnswer.snapshot.story;
      if (!story.revision) throw new BehavioralFinalAnswerError(
        "behavioral_final_answer_story_revision_required",
        "Every new Story Bank selection requires its exact current revision.",
      );
      finalizationGuards.push(d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${behavioralStories}
        INNER JOIN ${behavioralStoryRevisions}
          ON ${behavioralStoryRevisions.ownerId} = ${behavioralStories.ownerId}
          AND ${behavioralStoryRevisions.storyId} = ${behavioralStories.storyId}
          AND ${behavioralStoryRevisions.revision} = ${story.revision}
        WHERE ${behavioralStories.ownerId} = ${ownerId}
          AND ${behavioralStories.storyId} = ${story.storyId}
          AND ${behavioralStories.currentRevision} = ${story.revision}
          AND ${behavioralStories.state} = 'active'
      )`));
    }
    const contraryEvidenceIds = [...new Set(
      behavioralFinalAnswer.snapshot.behavioralAnalysis?.claimAudit.flatMap((claim) => claim.contraryEvidenceIds) ?? [],
    )];
    if (contraryEvidenceIds.length) {
      finalizationGuards.push(d1TransactionalInvariantGuard(db, sql`(
        SELECT count(*) FROM ${behavioralEvidenceItems}
        INNER JOIN ${behavioralEvidenceQuestionLinks}
          ON ${behavioralEvidenceQuestionLinks.ownerId} = ${behavioralEvidenceItems.ownerId}
          AND ${behavioralEvidenceQuestionLinks.evidenceId} = ${behavioralEvidenceItems.evidenceId}
        WHERE ${behavioralEvidenceItems.ownerId} = ${ownerId}
          AND ${behavioralEvidenceItems.candidateState} = 'accepted'
          AND ${behavioralEvidenceQuestionLinks.questionId} = ${questionId}
          AND ${behavioralEvidenceQuestionLinks.relevance} = 'contrary'
          AND ${inArray(behavioralEvidenceItems.evidenceId, contraryEvidenceIds)}
      ) = ${contraryEvidenceIds.length}`));
    }
    if (behavioralFinalAnswer.targetBinding) {
      const targetBinding = behavioralFinalAnswer.targetBinding;
      finalizationGuards.push(d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${behavioralTargetBindings}
        WHERE ${behavioralTargetBindings.ownerId} = ${ownerId}
          AND ${behavioralTargetBindings.scopeType} = ${targetBinding.source}
          AND ${behavioralTargetBindings.scopeId} = ${targetBinding.scopeId}
          AND ${behavioralTargetBindings.revision} = ${targetBinding.bindingRevision}
          AND ${behavioralTargetBindings.updatedAt} = ${targetBinding.bindingUpdatedAt}
          AND ${behavioralTargetBindings.targetId} = ${targetBinding.targetId}
          AND ${behavioralTargetBindings.targetRevision} = ${targetBinding.targetRevision}
      )`));
      finalizationGuards.push(d1TransactionalInvariantGuard(db, sql`EXISTS (
          SELECT 1 FROM ${extraActivities}
          WHERE ${extraActivities.ownerId} = ${ownerId}
            AND ${extraActivities.id} = ${activityId}
            AND json_extract(${extraActivities.payload}, '$.type') = 'behavioral'
            AND json_extract(${extraActivities.payload}, '$.questionId') = ${questionId}
            ${targetBinding.source === "session"
              ? sql`AND json_extract(${extraActivities.payload}, '$.sessionId') = ${targetBinding.scopeId}`
              : sql``}
        )`));
    }
    if (behavioralFinalAnswer.roleBriefBinding) {
      const binding = behavioralFinalAnswer.roleBriefBinding;
      finalizationGuards.push(d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${loopActivityBindings}
        WHERE ${loopActivityBindings.ownerId} = ${ownerId}
          AND ${loopActivityBindings.activityId} = ${activityId}
          AND ${loopActivityBindings.bindingRevision} = ${binding.bindingRevision}
          AND ${loopActivityBindings.updatedAt} = ${binding.bindingUpdatedAt}
          AND ${loopActivityBindings.loopId} = ${binding.loopId}
          AND ${loopActivityBindings.loopRevision} = ${binding.loopRevision}
          AND ${loopActivityBindings.roleBriefRevision} = ${binding.roleBriefRevision}
          AND ${loopActivityBindings.specialty} = ${binding.specialty}
          AND ${loopActivityBindings.questionId} = ${binding.questionId}
      )`));
    }
    if (behavioralFinalAnswer.resumeContext) {
      const context = behavioralFinalAnswer.resumeContext;
      finalizationGuards.push(d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${resumeSources}
        WHERE ${resumeSources.ownerId} = ${ownerId}
          AND ${resumeSources.resumeId} = ${context.resumeId}
          AND ${resumeSources.currentRevisionId} = ${context.resumeRevisionId}
          AND ${resumeSources.sourceLabel} = ${context.sourceLabel}
          AND ${resumeSources.updatedAt} = ${behavioralFinalAnswer.resumeSourceUpdatedAt!}
      )`));
      finalizationGuards.push(d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${resumeRevisions}
        WHERE ${resumeRevisions.ownerId} = ${ownerId}
          AND ${resumeRevisions.resumeId} = ${context.resumeId}
          AND ${resumeRevisions.revisionId} = ${context.resumeRevisionId}
          AND ${resumeRevisions.importedAt} = ${context.resumeImportedAt}
      )`));
    } else if (behavioralFinalAnswer.resumeContextExpectedAbsent) {
      finalizationGuards.push(d1TransactionalInvariantGuard(db, sql`NOT EXISTS (
        SELECT 1 FROM ${resumeSources}
        WHERE ${resumeSources.ownerId} = ${ownerId}
          AND ${resumeSources.currentRevisionId} IS NOT NULL
      )`));
    }
  }
  const finalizationStatements = [...finalizationGuards] as unknown[];
  if (interactionModeClassification) {
    finalizationStatements.push(d1TransactionalInvariantGuard(db, sql`(
      SELECT count(*) FROM ${practiceInteractionModeTransitions}
      WHERE ${practiceInteractionModeTransitions.ownerId} = ${ownerId}
        AND ${practiceInteractionModeTransitions.activityId} = ${activityId}
    ) = ${interactionModeClassification.dependencies?.transitionCount ?? interactionModeClassification.classification.transitionCount}`));
    const intervalDependencies = interactionModeClassification.dependencies?.timerIntervals ?? [];
    finalizationStatements.push(d1TransactionalInvariantGuard(db, sql`(
      SELECT count(*) FROM ${timerIntervals}
      WHERE ${timerIntervals.ownerId} = ${ownerId}
        AND ${timerIntervals.subjectId} = ${activityId}
        AND ${timerIntervals.kind} = 'activity'
    ) = ${intervalDependencies.length}`));
    for (const interval of intervalDependencies) {
      finalizationStatements.push(d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${timerIntervals}
        WHERE ${timerIntervals.ownerId} = ${ownerId}
          AND ${timerIntervals.subjectId} = ${activityId}
          AND ${timerIntervals.kind} = 'activity'
          AND ${timerIntervals.startedAt} = ${interval.startedAt}
          AND ${timerIntervals.endedAt} IS ${interval.endedAt}
      )`));
    }
    const overrideDependencies = interactionModeClassification.dependencies?.turnOverrides ?? [];
    finalizationStatements.push(d1TransactionalInvariantGuard(db, sql`(
      SELECT count(*) FROM ${practiceInteractionModeTurnOverrides}
      WHERE ${practiceInteractionModeTurnOverrides.ownerId} = ${ownerId}
        AND ${practiceInteractionModeTurnOverrides.activityId} = ${activityId}
    ) = ${overrideDependencies.length}`));
    for (const override of overrideDependencies) {
      finalizationStatements.push(d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${practiceInteractionModeTurnOverrides}
        WHERE ${practiceInteractionModeTurnOverrides.ownerId} = ${ownerId}
          AND ${practiceInteractionModeTurnOverrides.activityId} = ${activityId}
          AND ${practiceInteractionModeTurnOverrides.responseTurnId} = ${override.responseTurnId}
          AND ${practiceInteractionModeTurnOverrides.mutationId} = ${override.mutationId}
          AND ${practiceInteractionModeTurnOverrides.overrideInteractionModeId} = ${override.overrideInteractionModeId}
      )`));
    }
    finalizationStatements.push(db.insert(practiceInteractionModeClassifications).values({
      ownerId,
      activityId,
      snapshotRevision: interactionModeClassification.snapshotRevision,
      operationId: interactionModeClassification.operationId,
      requestFingerprint: interactionModeClassification.requestFingerprint,
      classification: interactionModeClassification.classification,
      correctionOfRevision: interactionModeClassification.correctionOfRevision,
      correctionReason: interactionModeClassification.correctionReason,
      finalizedAt: nowMs,
    }));
  }
  if (behavioralFinalAnswer) {
    finalizationStatements.push(db.insert(behavioralFinalAnswerSnapshots).values({
      ownerId,
      activityId,
      snapshotRevision: behavioralFinalAnswer.result.snapshotRevision,
      operationId: behavioralFinalAnswer.operationId,
      requestFingerprint: behavioralFinalAnswer.requestFingerprint,
      snapshot: behavioralFinalAnswer.snapshot,
      correctionOfRevision: behavioralFinalAnswer.correction?.replacesSnapshotRevision ?? null,
      correctionReason: behavioralFinalAnswer.correction?.reason ?? null,
      finalizedAt: nowMs,
    }));
    if (behavioralFinalAnswer.resumeContext) {
      finalizationStatements.push(db.insert(activityResumeContexts).values({
        ownerId,
        activityId,
        snapshotRevision: behavioralFinalAnswer.resumeContext.snapshotRevision,
        resumeId: behavioralFinalAnswer.resumeContext.resumeId,
        resumeRevisionId: behavioralFinalAnswer.resumeContext.resumeRevisionId,
        sourceLabel: behavioralFinalAnswer.resumeContext.sourceLabel,
        resumeImportedAt: behavioralFinalAnswer.resumeContext.resumeImportedAt,
        state: behavioralFinalAnswer.resumeContext.state,
        claimIds: behavioralFinalAnswer.resumeContext.claimIds,
        evidenceIds: behavioralFinalAnswer.resumeContext.evidenceIds,
        capturedAt: nowMs,
      }));
    }
  }
  if (behavioralProjectLink && !behavioralProjectLink.existing) {
    const binding = behavioralProjectLink.binding;
    finalizationStatements.push(d1TransactionalInvariantGuard(db, sql`EXISTS (
      SELECT 1 FROM ${extraActivities}
      WHERE ${extraActivities.ownerId} = ${ownerId}
        AND ${extraActivities.id} = ${activityId}
        AND json_extract(${extraActivities.payload}, '$.type') = 'behavioral'
        AND json_extract(${extraActivities.payload}, '$.questionId') = ${questionId!}
    ) AND EXISTS (
      SELECT 1 FROM ${behavioralProjectQuestionBindings}
      WHERE ${behavioralProjectQuestionBindings.ownerId} = ${ownerId}
        AND ${behavioralProjectQuestionBindings.questionId} = ${questionId!}
        AND ${behavioralProjectQuestionBindings.currentRevision} = ${binding.currentRevision}
        AND ${behavioralProjectQuestionBindings.projectId} = ${binding.projectId}
        AND ${behavioralProjectQuestionBindings.focus} = ${binding.focus}
        AND ${behavioralProjectQuestionBindings.state} = 'active'
    ) AND EXISTS (
      SELECT 1 FROM ${behavioralProjectQuestionBindingRevisions}
      WHERE ${behavioralProjectQuestionBindingRevisions.ownerId} = ${ownerId}
        AND ${behavioralProjectQuestionBindingRevisions.questionId} = ${questionId!}
        AND ${behavioralProjectQuestionBindingRevisions.revision} = ${binding.currentRevision}
    ) AND NOT EXISTS (
      SELECT 1 FROM ${behavioralProjectActivityLinks}
      WHERE ${behavioralProjectActivityLinks.ownerId} = ${ownerId}
        AND ${behavioralProjectActivityLinks.activityId} = ${activityId}
    )`));
    finalizationStatements.push(db.insert(behavioralProjectActivityLinks).values({
      ownerId,
      activityId,
      questionId: questionId!,
      bindingRevision: binding.currentRevision,
      projectId: binding.projectId,
      focus: binding.focus,
      sourceClaimId: binding.sourceClaimId,
      solutionRevision: behavioralProjectLink.identity.solutionRevision,
      source: "finalization",
      operationId: behavioralProjectLink.operationId,
      requestFingerprint: behavioralProjectLink.requestFingerprint,
      linkedAt: nowMs,
    }));
  }
  finalizationStatements.push(finalizationWrite);
  try {
    await db.batch(finalizationStatements as unknown as Parameters<typeof db.batch>[0]);
  } catch (error) {
    const [racedClassifications, racedFinalAnswers] = await Promise.all([
      interactionModeClassification ? db.select().from(practiceInteractionModeClassifications).where(and(
        eq(practiceInteractionModeClassifications.ownerId, ownerId),
        eq(practiceInteractionModeClassifications.operationId, interactionModeClassification.operationId),
      )).limit(1) : Promise.resolve([]),
      behavioralFinalAnswer ? db.select().from(behavioralFinalAnswerSnapshots).where(and(
        eq(behavioralFinalAnswerSnapshots.ownerId, ownerId),
        eq(behavioralFinalAnswerSnapshots.operationId, behavioralFinalAnswer.operationId),
      )).limit(1) : Promise.resolve([]),
    ]);
    if (
      racedClassifications[0]
      && racedClassifications[0].requestFingerprint !== interactionModeClassification?.requestFingerprint
    ) {
      throw new InteractionModeFinalizationError(
        "interaction_mode_classification_operation_conflict",
        "That classification operation ID is already bound to different immutable evidence.",
      );
    }
    if (racedFinalAnswers[0] && racedFinalAnswers[0].requestFingerprint !== behavioralFinalAnswer?.requestFingerprint) {
      throw new BehavioralFinalAnswerError(
        "behavioral_final_answer_operation_conflict",
        "That final-answer operation ID is already bound to a different immutable snapshot.",
      );
    }
    const classificationSettled = !interactionModeClassification || Boolean(racedClassifications[0]);
    const finalAnswerSettled = !behavioralFinalAnswer || Boolean(racedFinalAnswers[0]);
    if (classificationSettled && finalAnswerSettled) {
      return {
        finalAnswer: racedFinalAnswers[0]
          ? { status: "unchanged" as const, snapshotRevision: racedFinalAnswers[0].snapshotRevision }
          : null,
        interactionModeClassification: racedClassifications[0]?.classification ?? null,
      };
    }
    if (isD1TransactionalInvariantFailure(error)) {
      if (behavioralFinalAnswer) {
        throw new BehavioralFinalAnswerError(
          "behavioral_final_answer_dependency_changed",
          "The transcript, accepted evidence, or Solution Profile revision changed during finalization; reread the activity before retrying.",
          true,
        );
      }
      if (specialty === "leetcode") {
        const attempts = await db.select({
          id: leetcodeCodeAttempts.id,
          review: leetcodeCodeAttempts.review,
        }).from(leetcodeCodeAttempts).where(and(
          eq(leetcodeCodeAttempts.ownerId, ownerId),
          eq(leetcodeCodeAttempts.activityId, activityId),
        ));
        const pendingAttemptIds = pendingCodeAttemptReviewIds(attempts);
        if (pendingAttemptIds.length) {
          throw new Error(`Complete every pending Code Attempt review before finalization: ${pendingAttemptIds.join(", ")}.`);
        }
      }
      throw new Error("The activity transcript changed during finalization; reread the activity before retrying.");
    }
    throw error;
  }
  if (payload.complete && (!questionId || !durableIdentity)) {
    throw new Error("A complete finalization needs its durable operation identity and stable questionId.");
  }
  const practiceRecord = payload.complete
    ? await persistFinalizedPracticeRecord({
        ownerId,
        activityId,
        specialty,
        questionId: questionId!,
        finalization: payload,
        operationId: durableIdentity!.operationId,
        requestFingerprint: durableIdentity!.requestFingerprint,
        nowMs,
      })
    : null;
  return {
    finalAnswer: behavioralFinalAnswer?.result ?? null,
    interactionModeClassification: interactionModeClassification?.classification ?? null,
    practiceRecord,
  };
}

export async function markFinalizationPublished(ownerId: string, activityId: string, nowMs: number) {
  const db = getDb();
  await db
    .update(activityFinalizations)
    .set({ status: "published", publishedAt: nowMs, updatedAt: nowMs })
    .where(and(eq(activityFinalizations.ownerId, ownerId), eq(activityFinalizations.activityId, activityId)));
}

export async function scheduleReview(
  ownerId: string,
  input: {
    activityId: string;
    questionId?: string;
    specialty: Specialty;
    completedDate: string;
    reason: ReviewReason;
    intervalDays?: number;
  },
  nowMs: number,
) {
  const db = getDb();
  const reviewKey = `${input.specialty}:${input.questionId ?? input.activityId}`;
  const rows = await db
    .select()
    .from(reviewSchedules)
    .where(and(eq(reviewSchedules.ownerId, ownerId), eq(reviewSchedules.reviewKey, reviewKey)));
  const prior = rows[0];
  const nextInterval = input.intervalDays ?? reviewIntervalDays(input.reason, prior?.intervalDays);
  await db
    .insert(reviewSchedules)
    .values({
      ownerId,
      reviewKey,
      activityId: input.activityId,
      questionId: input.questionId ?? null,
      specialty: input.specialty,
      status: "scheduled",
      reason: input.reason,
      dueDate: addDays(input.completedDate, nextInterval),
      intervalDays: nextInterval,
      stage: input.reason === "successful_recall" ? (prior?.stage ?? 0) + 1 : 0,
      reviewCount: prior?.reviewCount ?? 0,
      createdAt: prior?.createdAt ?? nowMs,
      updatedAt: nowMs,
    })
    .onConflictDoUpdate({
      target: [reviewSchedules.ownerId, reviewSchedules.reviewKey],
      set: {
        activityId: input.activityId,
        questionId: input.questionId ?? null,
        specialty: input.specialty,
        status: "scheduled",
        reason: input.reason,
        dueDate: addDays(input.completedDate, nextInterval),
        intervalDays: nextInterval,
        stage: input.reason === "successful_recall" ? (prior?.stage ?? 0) + 1 : 0,
        reviewCount: input.reason === "successful_recall" ? (prior?.reviewCount ?? 0) + 1 : (prior?.reviewCount ?? 0),
        updatedAt: nowMs,
      },
    });
}

export async function dismissReview(ownerId: string, reviewKey: string, nowMs: number) {
  const db = getDb();
  await db
    .update(reviewSchedules)
    .set({ status: "dismissed", updatedAt: nowMs })
    .where(and(eq(reviewSchedules.ownerId, ownerId), eq(reviewSchedules.reviewKey, reviewKey)));
}

export async function clearActivityReviewSchedules(ownerId: string, activityId: string) {
  const db = getDb();
  await db
    .delete(reviewSchedules)
    .where(and(eq(reviewSchedules.ownerId, ownerId), eq(reviewSchedules.activityId, activityId)));
}

export async function registerSpecialistTask(
  ownerId: string,
  input: { specialty: SpecialistTaskType; threadId: string; hostId?: string; title: string },
  nowMs: number,
) {
  const db = getDb();
  await db
    .insert(specialistTasks)
    .values({ ownerId, ...input, hostId: input.hostId ?? null, connectedAt: nowMs, updatedAt: nowMs })
    .onConflictDoUpdate({
      target: [specialistTasks.ownerId, specialistTasks.specialty],
      set: { threadId: input.threadId, hostId: input.hostId ?? null, title: input.title, updatedAt: nowMs },
    });
}

export async function registerActivityAudioClip(
  ownerId: string,
  input: {
    id: string;
    activityId: string;
    transcriptTurnId?: string;
    filename: string;
    mimeType: string;
    label?: string;
    durationSeconds?: number;
    objectKey?: string;
    status?: "local_only" | "uploading" | "available" | "failed";
  },
  nowMs: number,
) {
  const db = getDb();
  const status = input.status ?? "local_only";
  if (input.transcriptTurnId) {
    const turns = await db.select({ speaker: practiceTranscriptTurns.speaker }).from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, input.activityId),
      eq(practiceTranscriptTurns.turnId, input.transcriptTurnId),
    ));
    if (turns[0]?.speaker !== "user") {
      throw new Error("Answer audio must reference an existing user transcript turn in the same activity.");
    }
  }
  const audioWrite = db
    .insert(activityAudioClips)
    .values({
      ownerId,
      id: input.id,
      activityId: input.activityId,
      transcriptTurnId: input.transcriptTurnId ?? null,
      objectKey: input.objectKey ?? `local-only/${input.id}`,
      filename: input.filename,
      mimeType: input.mimeType,
      label: input.label ?? "Practice answer",
      durationSeconds: input.durationSeconds ?? null,
      status,
      createdAt: nowMs,
      updatedAt: nowMs,
    })
    .onConflictDoUpdate({
      target: [activityAudioClips.ownerId, activityAudioClips.id],
      set: {
        activityId: input.activityId,
        transcriptTurnId: input.transcriptTurnId ?? null,
        objectKey: input.objectKey ?? `local-only/${input.id}`,
        filename: input.filename,
        mimeType: input.mimeType,
        label: input.label ?? "Practice answer",
        durationSeconds: input.durationSeconds ?? null,
        status,
        updatedAt: nowMs,
      },
    });
  if (!input.transcriptTurnId) {
    await audioWrite;
    return;
  }
  const exactTranscriptGuard = d1TransactionalInvariantGuard(db, and(
    exists(db.select({ one: sql<number>`1` }).from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      eq(practiceTranscriptTurns.activityId, input.activityId),
      eq(practiceTranscriptTurns.turnId, input.transcriptTurnId),
      eq(practiceTranscriptTurns.speaker, "user"),
    ))),
    typedExchangeIdentityNotDeletedCondition(
      db,
      ownerId,
      input.activityId,
      [input.transcriptTurnId],
    ),
  )!);
  try {
    await db.batch([exactTranscriptGuard, audioWrite]);
  } catch (error) {
    if (isD1TransactionalInvariantFailure(error)) {
      throw new Error("Answer audio transcript evidence changed during registration; reread the activity before retrying.");
    }
    throw error;
  }
}

export async function acknowledgeVoiceAudioLossForCapture(
  ownerId: string,
  input: {
    captureId: string;
    activityId: string;
    turnId: string;
    lossReason: "local_source_missing" | "local_source_unreadable";
    reason: string;
  },
  nowMs: number,
) {
  const db = getDb();
  const intents = await db.select().from(voiceCaptureIntents).where(and(
    eq(voiceCaptureIntents.ownerId, ownerId),
    eq(voiceCaptureIntents.captureId, input.captureId),
  ));
  const intent = intents[0];
  if (!intent || intent.status !== "accepted"
      || intent.activityId !== input.activityId || intent.turnId !== input.turnId) {
    throw new Error("Audio loss acknowledgement requires the matching accepted Voice capture.");
  }

  let clip = await readActivityAudioClip(ownerId, intent.clipId);
  if (clip?.status === "available") {
    throw new Error("The original recording is already durable in private storage.");
  }
  const lossReason = `${input.lossReason}: ${input.reason.trim()}`.slice(0, 500);
  if (!clip) {
    await db.insert(activityAudioClips).values({
      ownerId,
      id: intent.clipId,
      activityId: input.activityId,
      transcriptTurnId: input.turnId,
      objectKey: `audio-lost/${ownerId}/${intent.clipId}`,
      filename: "voice-recording-unavailable",
      mimeType: "application/x-interview-arc-audio-unavailable",
      label: "Voice recording (unavailable)",
      durationSeconds: null,
      status: "audio_lost",
      audioLostReason: lossReason,
      audioLostDetectedAt: nowMs,
      audioLostAcknowledgedAt: nowMs,
      createdAt: nowMs,
      updatedAt: nowMs,
    }).onConflictDoNothing();
    clip = await readActivityAudioClip(ownerId, intent.clipId);
  }
  if (!clip) throw new Error("The audio-loss record could not be created safely.");
  const duplicate = clip.status === "audio_lost" && Boolean(clip.audioLostAcknowledgedAt);
  if (!duplicate) {
    await db.update(activityAudioClips).set({
      status: "audio_lost",
      audioLostReason: lossReason,
      audioLostDetectedAt: clip.audioLostDetectedAt ?? nowMs,
      audioLostAcknowledgedAt: clip.audioLostAcknowledgedAt ?? nowMs,
      updatedAt: nowMs,
    }).where(and(
      eq(activityAudioClips.ownerId, ownerId),
      eq(activityAudioClips.id, intent.clipId),
    ));
  }
  return {
    captureId: input.captureId,
    activityId: input.activityId,
    turnId: input.turnId,
    clipId: intent.clipId,
    status: "audio_lost" as const,
    acknowledged: true,
    duplicate,
    transcriptPreserved: true,
    lossReason,
  };
}

export async function readActivityAudioClip(ownerId: string, id: string) {
  const db = getDb();
  const rows = await db.select().from(activityAudioClips).where(and(eq(activityAudioClips.ownerId, ownerId), eq(activityAudioClips.id, id)));
  return rows[0] ?? null;
}

export async function readActivityAudioClips(ownerId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const db = getDb();
  return db.select().from(activityAudioClips).where(and(
    eq(activityAudioClips.ownerId, ownerId),
    inArray(activityAudioClips.id, ids),
  ));
}

export async function updateActivityAudioClipStatus(
  ownerId: string,
  id: string,
  status: "local_only" | "uploading" | "available" | "failed",
  nowMs: number,
) {
  const db = getDb();
  await db.update(activityAudioClips).set({ status, updatedAt: nowMs }).where(and(eq(activityAudioClips.ownerId, ownerId), eq(activityAudioClips.id, id)));
}

export async function reportActivityAudioLost(
  ownerId: string,
  id: string,
  reason: string,
  nowMs: number,
) {
  const db = getDb();
  const rows = await db.select().from(activityAudioClips).where(and(
    eq(activityAudioClips.ownerId, ownerId),
    eq(activityAudioClips.id, id),
  ));
  const clip = rows[0];
  if (!clip) throw new Error("The audio clip does not exist.");
  if (clip.status === "available") throw new Error("Available cloud audio cannot be declared lost.");
  await db.update(activityAudioClips).set({
    status: "audio_lost",
    audioLostReason: reason.trim().slice(0, 500) || "The original local recording is unavailable.",
    audioLostDetectedAt: clip.audioLostDetectedAt ?? nowMs,
    updatedAt: nowMs,
  }).where(and(eq(activityAudioClips.ownerId, ownerId), eq(activityAudioClips.id, id)));
}

export async function acknowledgeActivityAudioLost(ownerId: string, id: string, nowMs: number) {
  const db = getDb();
  const rows = await db.select().from(activityAudioClips).where(and(
    eq(activityAudioClips.ownerId, ownerId),
    eq(activityAudioClips.id, id),
  ));
  if (rows[0]?.status !== "audio_lost") throw new Error("Only a confirmed recording-loss incident can be acknowledged.");
  await db.update(activityAudioClips).set({
    audioLostAcknowledgedAt: rows[0].audioLostAcknowledgedAt ?? nowMs,
    updatedAt: nowMs,
  }).where(and(eq(activityAudioClips.ownerId, ownerId), eq(activityAudioClips.id, id)));
}

export async function acknowledgePublishWithoutDeliveryReview(ownerId: string, id: string, nowMs: number) {
  const db = getDb();
  const rows = await db.select().from(activityDeliveryAnalyses).where(and(
    eq(activityDeliveryAnalyses.ownerId, ownerId),
    eq(activityDeliveryAnalyses.id, id),
  ));
  if (rows[0]?.status !== "failed") throw new Error("Only a failed delivery review can be explicitly skipped.");
  await db.update(activityDeliveryAnalyses).set({
    publishWithoutReviewAcknowledgedAt: rows[0].publishWithoutReviewAcknowledgedAt ?? nowMs,
    updatedAt: nowMs,
  }).where(and(eq(activityDeliveryAnalyses.ownerId, ownerId), eq(activityDeliveryAnalyses.id, id)));
}

export type PublicationEvidenceBlocker = {
  activityId: string;
  captureId: string;
  clipId: string;
  kind: "transcript_not_materialized" | "audio_not_available" | "audio_lost_unacknowledged" | "delivery_review_pending" | "delivery_review_failed";
  status: string;
};

export async function readPublicationEvidenceState(ownerId: string, activityIds: string[]) {
  const requestedActivityIds = [...new Set(activityIds.filter(Boolean))];
  if (!requestedActivityIds.length) {
    return { blockers: [] as PublicationEvidenceBlocker[], unavailableClipIds: [] as string[] };
  }
  const db = getDb();
  const intents = await readD1RowsInBatches(requestedActivityIds, (batch) => (
    db.select().from(voiceCaptureIntents).where(and(
      eq(voiceCaptureIntents.ownerId, ownerId),
      inArray(voiceCaptureIntents.activityId, batch),
      eq(voiceCaptureIntents.status, "accepted"),
    )).orderBy(
      asc(voiceCaptureIntents.activityId),
      asc(voiceCaptureIntents.occurredAt),
      asc(voiceCaptureIntents.captureId),
    )
  ));
  if (!intents.length) return { blockers: [] as PublicationEvidenceBlocker[], unavailableClipIds: [] as string[] };
  intents.sort((left, right) => (
    left.activityId.localeCompare(right.activityId)
    || left.occurredAt - right.occurredAt
    || left.captureId.localeCompare(right.captureId)
  ));
  const clipIds = [...new Set(intents.map((intent) => intent.clipId))];
  const captureIds = [...new Set(intents.map((intent) => intent.captureId))];
  const [clips, analyses, responses, groupMembers] = await Promise.all([
    readD1RowsInBatches(clipIds, (batch) => db.select().from(activityAudioClips).where(and(
      eq(activityAudioClips.ownerId, ownerId),
      inArray(activityAudioClips.id, batch),
    ))),
    readD1RowsInBatches(clipIds, (batch) => db.select().from(activityDeliveryAnalyses).where(and(
      eq(activityDeliveryAnalyses.ownerId, ownerId),
      inArray(activityDeliveryAnalyses.audioClipId, batch),
    ))),
    readD1RowsInBatches(captureIds, (batch) => db.select().from(voiceSpecialistResponses).where(and(
      eq(voiceSpecialistResponses.ownerId, ownerId),
      inArray(voiceSpecialistResponses.captureId, batch),
    ))),
    readD1RowsInBatches(captureIds, (batch) => db.select().from(voiceResponseGroupMembers).where(and(
      eq(voiceResponseGroupMembers.ownerId, ownerId),
      inArray(voiceResponseGroupMembers.captureId, batch),
    ))),
  ]);
  const groupResponseTurnIds = [...new Set(groupMembers.map((member) => member.responseTurnId))];
  const responseGroups = await readD1RowsInBatches(groupResponseTurnIds, (batch) => (
    db.select().from(voiceResponseGroups).where(and(
      eq(voiceResponseGroups.ownerId, ownerId),
      inArray(voiceResponseGroups.responseTurnId, batch),
    ))
  ));
  const canonicalTurnIds = [...new Set([
    ...responses.flatMap((response) => [response.userTurnId, response.responseTurnId]),
    ...groupMembers.map((member) => member.userTurnId),
    ...groupResponseTurnIds,
  ])];
  // Query canonical turns by their bounded IDs only. The composite
  // activity/turn map below keeps exact activity identity without combining
  // two independent IN lists into one statement.
  const canonicalTurns = await readD1RowsInBatches(canonicalTurnIds, (batch) => (
    db.select().from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      inArray(practiceTranscriptTurns.turnId, batch),
    ))
  ));
  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const analysisByClipId = new Map(analyses.map((analysis) => [analysis.audioClipId, analysis]));
  const responseByCaptureId = new Map(responses.map((response) => [response.captureId, response]));
  const groupMemberByCaptureId = new Map(groupMembers.map((member) => [member.captureId, member]));
  const groupByResponseTurnId = new Map(responseGroups.map((group) => [group.responseTurnId, group]));
  const turnByActivityAndId = new Map(canonicalTurns.map((turn) => [`${turn.activityId}\u0000${turn.turnId}`, turn]));
  const blockers: PublicationEvidenceBlocker[] = [];
  const unavailableClipIds: string[] = [];
  for (const intent of intents) {
    const response = responseByCaptureId.get(intent.captureId);
    const member = groupMemberByCaptureId.get(intent.captureId);
    const group = member ? groupByResponseTurnId.get(member.responseTurnId) : undefined;
    const userTurnId = response?.userTurnId ?? member?.userTurnId;
    const responseTurnId = response?.responseTurnId ?? group?.responseTurnId;
    const userTurn = userTurnId
      ? turnByActivityAndId.get(`${intent.activityId}\u0000${userTurnId}`)
      : undefined;
    const specialistTurn = responseTurnId
      ? turnByActivityAndId.get(`${intent.activityId}\u0000${responseTurnId}`)
      : undefined;
    const hasCanonicalExchange = response
      ? hasCanonicalMaterializedVoiceExchange(intent, response, userTurn, specialistTurn)
      : hasCanonicalMaterializedVoiceGroupMember(intent, member, group, userTurn, specialistTurn);
    if (!hasCanonicalExchange) {
      blockers.push({
        activityId: intent.activityId,
        captureId: intent.captureId,
        clipId: intent.clipId,
        kind: "transcript_not_materialized",
        status: response?.status ?? group?.status ?? "missing",
      });
      continue;
    }
    const clip = clipById.get(intent.clipId);
    if (clip?.status === "audio_lost") {
      if (clip.audioLostAcknowledgedAt) unavailableClipIds.push(intent.clipId);
      else blockers.push({
        activityId: intent.activityId,
        captureId: intent.captureId,
        clipId: intent.clipId,
        kind: "audio_lost_unacknowledged",
        status: "audio_lost",
      });
      continue;
    }
    if (clip?.status !== "available") {
      blockers.push({
        activityId: intent.activityId,
        captureId: intent.captureId,
        clipId: intent.clipId,
        kind: "audio_not_available",
        status: clip?.status ?? "missing",
      });
      continue;
    }
    const analysis = analysisByClipId.get(intent.clipId);
    if (analysis?.status === "queued" || analysis?.status === "processing") {
      blockers.push({
        activityId: intent.activityId,
        captureId: intent.captureId,
        clipId: intent.clipId,
        kind: "delivery_review_pending",
        status: analysis.status,
      });
    } else if (analysis?.status === "failed" && !analysis.publishWithoutReviewAcknowledgedAt) {
      blockers.push({
        activityId: intent.activityId,
        captureId: intent.captureId,
        clipId: intent.clipId,
        kind: "delivery_review_failed",
        status: "failed",
      });
    }
  }
  return { blockers, unavailableClipIds };
}

export async function saveActivityDeliveryAnalysis(
  ownerId: string,
  input: {
    id: string;
    activityId: string;
    audioClipId: string;
    transcriptTurnId: string;
    specialty: Specialty;
    status: "queued" | "processing" | "available" | "failed";
    payload?: DeliveryAnalysisPayload;
    error?: string;
  },
  nowMs: number,
) {
  const db = getDb();
  const clips = await db.select().from(activityAudioClips).where(and(
    eq(activityAudioClips.ownerId, ownerId),
    eq(activityAudioClips.id, input.audioClipId),
    eq(activityAudioClips.activityId, input.activityId),
  ));
  if (!clips[0] || clips[0].transcriptTurnId !== input.transcriptTurnId) {
    throw new Error("Delivery analysis must reference a private clip linked to the same user transcript turn.");
  }
  if (input.status === "available" && !input.payload) {
    throw new Error("Available delivery analysis requires an evidence payload.");
  }
  await db.insert(activityDeliveryAnalyses).values({
    ownerId,
    id: input.id,
    activityId: input.activityId,
    audioClipId: input.audioClipId,
    transcriptTurnId: input.transcriptTurnId,
    specialty: input.specialty,
    status: input.status,
    payload: input.payload ?? null,
    error: input.error?.slice(0, 2_000) ?? null,
    createdAt: nowMs,
    updatedAt: nowMs,
  }).onConflictDoUpdate({
    target: [activityDeliveryAnalyses.ownerId, activityDeliveryAnalyses.id],
    set: {
      activityId: input.activityId,
      audioClipId: input.audioClipId,
      transcriptTurnId: input.transcriptTurnId,
      specialty: input.specialty,
      status: input.status,
      payload: input.payload ?? null,
      error: input.error?.slice(0, 2_000) ?? null,
      updatedAt: nowMs,
    },
  });
}

export async function deleteActivityAudioClip(ownerId: string, id: string) {
  const db = getDb();
  await db.delete(activityDeliveryAnalyses).where(and(
    eq(activityDeliveryAnalyses.ownerId, ownerId),
    eq(activityDeliveryAnalyses.audioClipId, id),
  ));
  await db.delete(activityAudioClips).where(and(eq(activityAudioClips.ownerId, ownerId), eq(activityAudioClips.id, id)));
}

export async function setProblemStar(
  ownerId: string,
  specialty: Specialty,
  questionId: string,
  starred: boolean,
  nowMs: number,
) {
  const db = getDb();
  await db.insert(problemPreferences).values({ ownerId, specialty, questionId, starred, updatedAt: nowMs }).onConflictDoUpdate({
    target: [problemPreferences.ownerId, problemPreferences.specialty, problemPreferences.questionId],
    set: { starred, updatedAt: nowMs },
  });
}

export async function upsertOwnerBankQuestion(
  ownerId: string,
  specialty: Specialty,
  question: {
    questionId: string;
    title: string;
    prompt?: string;
    url?: string;
    source?: string;
    tags?: string[];
    priority?: number;
    targetMinutes?: number;
    active?: boolean;
    metadata?: LeetCodeQuestionMetadata;
  },
  nowMs: number,
) {
  const db = getDb();
  if (question.metadata && specialty !== "leetcode") {
    throw new Error("LeetCode metadata is only valid for LeetCode bank questions.");
  }
  if (question.metadata) validateLeetCodeQuestionMetadata(question.metadata);
  const tags = normalizedTags(question.tags ?? []);
  const values = {
    ownerId,
    specialty,
    questionId: question.questionId,
    title: question.title,
    prompt: question.prompt ?? null,
    url: question.url ?? null,
    source: question.source ?? "personal",
    tags,
    problemNumber: null,
    difficulty: null,
    acceptanceRate: null,
    topics: [],
    companyTags: [],
    companySignals: [],
    metadataReferences: [],
    metadataCapturedAt: null,
    priority: question.priority ?? 0,
    targetMinutes: question.targetMinutes ?? (specialty === "leetcode" ? 40 : 60),
    active: question.active ?? true,
    updatedAt: nowMs,
  };
  await db.insert(ownerBankQuestions).values(values).onConflictDoUpdate({
    target: [ownerBankQuestions.ownerId, ownerBankQuestions.specialty, ownerBankQuestions.questionId],
    set: {
      title: values.title,
      prompt: values.prompt,
      url: values.url,
      source: values.source,
      ...(tags.length ? {
        tags: sql`(
          SELECT COALESCE(json_group_array(value), '[]')
          FROM (
            SELECT DISTINCT value
            FROM (
              SELECT value FROM json_each(${ownerBankQuestions.tags})
              UNION ALL
              SELECT value FROM json_each(${JSON.stringify(tags)})
            )
            WHERE value <> ''
          )
        )`,
      } : {}),
      priority: values.priority,
      targetMinutes: values.targetMinutes,
      active: values.active,
      updatedAt: values.updatedAt,
    },
  });
  if (question.metadata) {
    await enrichPersonalLeetCodeQuestion(ownerId, question.questionId, tags, question.metadata, nowMs);
  }
  const rows = await db.select({
    tags: ownerBankQuestions.tags,
    problemNumber: ownerBankQuestions.problemNumber,
    difficulty: ownerBankQuestions.difficulty,
    acceptanceRate: ownerBankQuestions.acceptanceRate,
    topics: ownerBankQuestions.topics,
    companyTags: ownerBankQuestions.companyTags,
    companySignals: ownerBankQuestions.companySignals,
    metadataReferences: ownerBankQuestions.metadataReferences,
    metadataCapturedAt: ownerBankQuestions.metadataCapturedAt,
  }).from(ownerBankQuestions).where(and(
    eq(ownerBankQuestions.ownerId, ownerId),
    eq(ownerBankQuestions.specialty, specialty),
    eq(ownerBankQuestions.questionId, question.questionId),
  ));
  const saved = rows[0];
  return saved ? {
    tags: Array.isArray(saved.tags) ? saved.tags as string[] : [],
    metadata: readStoredQuestionMetadata(saved),
  } : null;
}

export async function readSpecialistTasks(ownerId: string) {
  const db = getDb();
  return db.select().from(specialistTasks).where(eq(specialistTasks.ownerId, ownerId));
}

export async function readActivityPracticeRecord(ownerId: string, activityId: string) {
  const db = getDb();
  const [turns, notes, finalizations, classificationRows, modeTransitions, modeTurnOverrides, finalAnswerRows, resumeContextRows, reviews, clips, deliveryAnalyses, codeAttempts, typedExchangeDeletions, solutionLinks, projectLinks, practiceRecord] = await Promise.all([
    db
      .select()
      .from(practiceTranscriptTurns)
      .where(and(eq(practiceTranscriptTurns.ownerId, ownerId), eq(practiceTranscriptTurns.activityId, activityId)))
      .orderBy(asc(practiceTranscriptTurns.sequence), asc(practiceTranscriptTurns.occurredAt)),
    db.select().from(practiceNotes).where(and(eq(practiceNotes.ownerId, ownerId), eq(practiceNotes.activityId, activityId))),
    db.select().from(activityFinalizations).where(and(eq(activityFinalizations.ownerId, ownerId), eq(activityFinalizations.activityId, activityId))),
    db.select().from(practiceInteractionModeClassifications).where(and(
      eq(practiceInteractionModeClassifications.ownerId, ownerId),
      eq(practiceInteractionModeClassifications.activityId, activityId),
    )).orderBy(desc(practiceInteractionModeClassifications.snapshotRevision)).limit(101),
    db.select().from(practiceInteractionModeTransitions).where(and(
      eq(practiceInteractionModeTransitions.ownerId, ownerId),
      eq(practiceInteractionModeTransitions.activityId, activityId),
    )).orderBy(asc(practiceInteractionModeTransitions.occurredAt), asc(practiceInteractionModeTransitions.toRevision)),
    db.select().from(practiceInteractionModeTurnOverrides).where(and(
      eq(practiceInteractionModeTurnOverrides.ownerId, ownerId),
      eq(practiceInteractionModeTurnOverrides.activityId, activityId),
    )).orderBy(asc(practiceInteractionModeTurnOverrides.createdAt)),
    db.select().from(behavioralFinalAnswerSnapshots).where(and(
      eq(behavioralFinalAnswerSnapshots.ownerId, ownerId),
      eq(behavioralFinalAnswerSnapshots.activityId, activityId),
    )).orderBy(desc(behavioralFinalAnswerSnapshots.snapshotRevision)).limit(101),
    db.select().from(activityResumeContexts).where(and(
      eq(activityResumeContexts.ownerId, ownerId),
      eq(activityResumeContexts.activityId, activityId),
    )).orderBy(desc(activityResumeContexts.snapshotRevision)).limit(101),
    db.select().from(reviewSchedules).where(and(eq(reviewSchedules.ownerId, ownerId), eq(reviewSchedules.activityId, activityId))),
    db.select().from(activityAudioClips).where(and(eq(activityAudioClips.ownerId, ownerId), eq(activityAudioClips.activityId, activityId))),
    db.select().from(activityDeliveryAnalyses).where(and(eq(activityDeliveryAnalyses.ownerId, ownerId), eq(activityDeliveryAnalyses.activityId, activityId))),
    db.select().from(leetcodeCodeAttempts).where(and(
      eq(leetcodeCodeAttempts.ownerId, ownerId),
      eq(leetcodeCodeAttempts.activityId, activityId),
    )).orderBy(asc(leetcodeCodeAttempts.sequence), asc(leetcodeCodeAttempts.occurredAt)),
    db.select().from(typedPracticeExchangeDeletions).where(and(
      eq(typedPracticeExchangeDeletions.ownerId, ownerId),
      eq(typedPracticeExchangeDeletions.activityId, activityId),
    )).orderBy(asc(typedPracticeExchangeDeletions.deletedAt)),
    db.select().from(activitySolutionLinks).where(and(
      eq(activitySolutionLinks.ownerId, ownerId),
      eq(activitySolutionLinks.activityId, activityId),
    )).limit(1),
    db.select().from(behavioralProjectActivityLinks).where(and(
      eq(behavioralProjectActivityLinks.ownerId, ownerId),
      eq(behavioralProjectActivityLinks.activityId, activityId),
    )).limit(1),
    readCurrentPracticeRecord(ownerId, activityId),
  ]);
  const finalAnswerSnapshots: StoredBehavioralFinalAnswerSnapshot[] = finalAnswerRows.slice(0, 100).reverse().map((row) => ({
    snapshotRevision: row.snapshotRevision,
    correctionOfRevision: row.correctionOfRevision,
    correctionReason: row.correctionReason,
    finalizedAt: row.finalizedAt,
    snapshot: behavioralFinalAnswerSnapshotInputSchema.parse(row.snapshot),
  }));
  const resumeContextHistory = resumeContextRows.slice(0, 100).reverse().map((row) => storedActivityResumeContextSchema.parse({
    schemaVersion: 1,
    state: row.state,
    snapshotRevision: row.snapshotRevision,
    resumeId: row.resumeId,
    resumeRevisionId: row.resumeRevisionId,
    sourceLabel: row.sourceLabel,
    resumeImportedAt: row.resumeImportedAt,
    claimIds: row.claimIds,
    evidenceIds: row.evidenceIds,
    capturedAt: row.capturedAt,
  }));
  const finalizationPayload = finalizations[0]?.payload as Partial<SpecialistFinalization> | undefined;
  const solutionLink = solutionLinks[0];
  const linkedSolutionRevisions = solutionLink?.specialty === "behavioral"
    ? await db.select().from(problemSolutionRevisions).where(and(
      eq(problemSolutionRevisions.ownerId, ownerId),
      eq(problemSolutionRevisions.specialty, "behavioral"),
      eq(problemSolutionRevisions.questionId, solutionLink.questionId),
      eq(problemSolutionRevisions.revision, solutionLink.solutionRevision),
    )).limit(1)
    : [];
  const linkedSolutionRevision = linkedSolutionRevisions[0];
  const linkedSolutionPayload = linkedSolutionRevision?.payload as SpecialistFinalization["solutionProfile"] | undefined;
  const practiceScenarios = solutionLink?.specialty === "behavioral" && linkedSolutionRevision
    ? projectBehavioralPracticeScenarios({
      questionId: solutionLink.questionId,
      solutionProfileRevision: solutionLink.solutionRevision,
      scenarios: linkedSolutionPayload?.practiceScenarios,
    })
    : null;
  const interactionModeClassificationHistory = classificationRows.slice(0, 100).reverse().map((row) => ({
    snapshotRevision: row.snapshotRevision,
    correctionOfRevision: row.correctionOfRevision,
    correctionReason: row.correctionReason,
    finalizedAt: row.finalizedAt,
    classification: interactionModeClassificationSchema.parse(row.classification),
  }));
  const finalAnswer = projectBehavioralFinalAnswer({
    snapshots: finalAnswerSnapshots,
    legacyModelAnswer: finalizations[0]?.specialty === "behavioral"
      ? finalizationPayload?.modelAnswer
      : null,
  });
  const behavioralAnalysis = projectBehavioralAttemptAnalysis(finalAnswer);
  const resumeContext = finalAnswer?.source === "snapshot_v1"
    ? resumeContextHistory.find((context) => context.snapshotRevision === finalAnswer.snapshotRevision) ?? null
    : null;
  let transitionIndex = 0;
  const modeOverrideByTurn = new Map(modeTurnOverrides.map((override) => [
    override.responseTurnId,
    { interactionModeId: override.overrideInteractionModeId, revision: override.stateRevision, turnOverride: true },
  ]));
  const turnsWithModes = turns.map((turn) => {
    while (
      transitionIndex + 1 < modeTransitions.length
      && modeTransitions[transitionIndex + 1].occurredAt <= turn.occurredAt
    ) transitionIndex += 1;
    const transition = modeTransitions[transitionIndex];
    const effective = modeOverrideByTurn.get(turn.turnId) ?? (transition && transition.occurredAt <= turn.occurredAt
      ? { interactionModeId: transition.toInteractionModeId, revision: transition.toRevision }
      : null);
    return { ...turn, interactionMode: effective };
  });
  return {
    turns: turnsWithModes,
    typedExchanges: listTypedExchangePairs(turns),
    typedExchangeDeletions: typedExchangeDeletions.map((deletion) => ({
      operationId: deletion.operationId,
      activityId: deletion.activityId,
      userTurnId: deletion.userTurnId,
      responseTurnId: deletion.responseTurnId,
      specialty: deletion.specialty,
      expectedRevision: deletion.expectedRevision,
      reason: deletion.reason,
      receipt: deletion.receipt,
      deletedAt: deletion.deletedAt,
    })),
    notes,
    finalization: finalizations[0] ?? null,
    interactionModeClassification: interactionModeClassificationHistory.at(-1) ?? null,
    interactionModeClassificationHistory,
    interactionModeClassificationHistoryTruncated: classificationRows.length > 100,
    interactionModeTransitions: modeTransitions.map((transition) => ({
      transitionId: transition.transitionId,
      fromInteractionModeId: transition.fromInteractionModeId,
      toInteractionModeId: transition.toInteractionModeId,
      toRevision: transition.toRevision,
      triggerTurnId: transition.triggerTurnId,
      source: transition.source,
      reason: transition.reason,
      occurredAt: transition.occurredAt,
    })),
    interactionModeTurnOverrides: modeTurnOverrides.map((override) => ({
      mutationId: override.mutationId,
      responseTurnId: override.responseTurnId,
      triggerTurnId: override.triggerTurnId,
      baseInteractionModeId: override.baseInteractionModeId,
      overrideInteractionModeId: override.overrideInteractionModeId,
      stateRevision: override.stateRevision,
      reason: override.reason,
      occurredAt: override.occurredAt,
    })),
    finalAnswerSnapshots,
    finalAnswerSnapshotsTruncated: finalAnswerRows.length > 100,
    finalAnswer,
    finalAnswerMarkdown: renderBehavioralFinalAnswerMarkdown(finalAnswer),
    finalAnswerHtml: renderBehavioralFinalAnswerHtml(finalAnswer),
    resumeContext,
    resumeContextHistory,
    resumeContextHistoryTruncated: resumeContextRows.length > 100,
    resumeContextMarkdown: renderActivityResumeContextMarkdown(resumeContext),
    resumeContextHtml: renderActivityResumeContextHtml(resumeContext),
    practiceScenarios,
    practiceScenariosMarkdown: renderBehavioralPracticeScenariosMarkdown(practiceScenarios),
    practiceScenariosHtml: renderBehavioralPracticeScenariosHtml(practiceScenarios),
    behavioralAnalysis,
    behavioralAnalysisMarkdown: renderBehavioralAttemptAnalysisMarkdown(behavioralAnalysis),
    behavioralAnalysisHtml: renderBehavioralAttemptAnalysisHtml(behavioralAnalysis),
    reviews,
    audioClips: clips,
    deliveryAnalyses,
    codeAttempts,
    practiceRecord,
    projectDeepDiveLink: projectLinks[0] ?? null,
  };
}

export async function readProblemSolutionProfile(
  ownerId: string,
  specialty: Specialty,
  questionId: string,
  options?: { revisionLimit?: number },
) {
  const db = getDb();
  const category = specialty === "system_design" ? "systemDesign" : specialty;
  const revisionQuery = db.select({
    revision: problemSolutionRevisions.revision,
    activityId: problemSolutionRevisions.activityId,
    createdAt: problemSolutionRevisions.createdAt,
  }).from(problemSolutionRevisions).where(and(
    eq(problemSolutionRevisions.ownerId, ownerId),
    eq(problemSolutionRevisions.specialty, specialty),
    eq(problemSolutionRevisions.questionId, questionId),
  )).orderBy(desc(problemSolutionRevisions.revision));
  const [profiles, provisionalProfiles, revisions, canonicalQuestions, projectBinding] = await Promise.all([
    db.select().from(problemSolutionProfiles).where(and(
      eq(problemSolutionProfiles.ownerId, ownerId),
      eq(problemSolutionProfiles.specialty, specialty),
      eq(problemSolutionProfiles.questionId, questionId),
    )),
    db.select().from(provisionalSolutionProfiles).where(and(
      eq(provisionalSolutionProfiles.ownerId, ownerId),
      eq(provisionalSolutionProfiles.specialty, specialty),
      eq(provisionalSolutionProfiles.questionId, questionId),
    )),
    options?.revisionLimit ? revisionQuery.limit(options.revisionLimit) : revisionQuery,
    db.select({ payload: contentBank.payload }).from(contentBank).where(and(
      eq(contentBank.category, category),
      eq(contentBank.id, questionId),
    )),
    specialty === "behavioral"
      ? readCurrentBehavioralProjectBinding(ownerId, questionId)
      : Promise.resolve(null),
  ]);
  const canonicalQuestion = canonicalQuestions[0]?.payload as {
    title?: string;
    solutionProfile?: SpecialistFinalization["solutionProfile"];
  } | undefined;
  const canonicalProfile = canonicalQuestion?.solutionProfile
    ? {
        ownerId: "shared",
        specialty,
        questionId,
        title: canonicalQuestion.title ?? questionId,
        currentRevision: 1,
        tags: canonicalQuestion.solutionProfile.tags,
        payload: canonicalQuestion.solutionProfile,
        updatedAt: 0,
      }
    : null;
  const profile = profiles[0] ?? canonicalProfile;
  const profilePayload = profile?.payload as SpecialistFinalization["solutionProfile"];
  const missingRequirements = [
    ...solutionProfileMissingRequirements(specialty, profilePayload),
    ...(specialty === "behavioral" && profilePayload
      ? projectProfileMissingRequirements(profilePayload, projectBinding)
      : []),
  ];
  return {
    profile,
    reusable: missingRequirements.length === 0,
    missingRequirements,
    provisionalProfile: provisionalProfiles[0] ?? null,
    revisions,
    projectDeepDiveBinding: projectBinding,
  };
}

export async function readDurablePracticeSummary(ownerId: string, _activityIds: string[], today: string) {
  const db = getDb();
  const [notes, reviews, finalizations, classifications, clips, deliveryAnalyses, preferences, profiles, revisions, links, personalQuestions, projectBindings, projectActivityLinks] = await Promise.all([
    db.select().from(practiceNotes).where(eq(practiceNotes.ownerId, ownerId)),
    db.select().from(reviewSchedules).where(eq(reviewSchedules.ownerId, ownerId)),
    db.select().from(activityFinalizations).where(eq(activityFinalizations.ownerId, ownerId)),
    db.select().from(practiceInteractionModeClassifications)
      .where(eq(practiceInteractionModeClassifications.ownerId, ownerId))
      .orderBy(desc(practiceInteractionModeClassifications.snapshotRevision)),
    db.select().from(activityAudioClips).where(eq(activityAudioClips.ownerId, ownerId)),
    db.select().from(activityDeliveryAnalyses).where(eq(activityDeliveryAnalyses.ownerId, ownerId)),
    db.select().from(problemPreferences).where(eq(problemPreferences.ownerId, ownerId)),
    db.select().from(problemSolutionProfiles).where(eq(problemSolutionProfiles.ownerId, ownerId)),
    db.select().from(problemSolutionRevisions).where(eq(problemSolutionRevisions.ownerId, ownerId)).orderBy(desc(problemSolutionRevisions.createdAt)),
    db.select().from(activitySolutionLinks).where(eq(activitySolutionLinks.ownerId, ownerId)),
    db.select().from(ownerBankQuestions).where(eq(ownerBankQuestions.ownerId, ownerId)),
    db.select().from(behavioralProjectQuestionBindings).where(eq(behavioralProjectQuestionBindings.ownerId, ownerId)),
    db.select().from(behavioralProjectActivityLinks).where(eq(behavioralProjectActivityLinks.ownerId, ownerId)),
  ]);
  const group = <T extends { activityId: string }>(rows: T[]) => rows.reduce<Record<string, T[]>>((result, row) => {
    (result[row.activityId] ??= []).push(row);
    return result;
  }, {});
  return {
    notes: group(notes),
    reviews: reviews.reduce<Record<string, typeof reviews[number]>>((result, row) => {
      result[row.activityId] = { ...row, status: row.status === "scheduled" && row.dueDate <= today ? "due" : row.status };
      return result;
    }, {}),
    finalizations: finalizations.reduce<Record<string, typeof finalizations[number]>>((result, row) => {
      result[row.activityId] = row;
      return result;
    }, {}),
    interactionModeClassifications: classifications.reduce<Record<string, {
      snapshotRevision: number;
      classification: ReturnType<typeof interactionModeClassificationSchema.parse>;
    }>>((result, row) => {
      if (!result[row.activityId]) {
        result[row.activityId] = {
          snapshotRevision: row.snapshotRevision,
          classification: interactionModeClassificationSchema.parse(row.classification),
        };
      }
      return result;
    }, {}),
    audioClips: group(clips),
    deliveryAnalyses: group(deliveryAnalyses),
    problemPreferences: preferences,
    solutionProfiles: profiles,
    solutionRevisions: revisions,
    activitySolutionLinks: links,
    personalQuestions,
    behavioralProjectBindings: projectBindings,
    behavioralProjectActivityLinks: projectActivityLinks,
  };
}

export async function readPendingFinalizations(ownerId: string) {
  const db = getDb();
  return db
    .select()
    .from(activityFinalizations)
    .where(and(eq(activityFinalizations.ownerId, ownerId), inArray(activityFinalizations.status, ["draft", "ready"])));
}
