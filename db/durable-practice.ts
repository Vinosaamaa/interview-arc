import { and, asc, desc, eq, exists, gt, inArray, isNotNull, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  activityDeliveryAnalyses,
  activityAudioClips,
  activityFinalizations,
  activitySolutionLinks,
  contentBank,
  deferredVoiceCaptureDecisions,
  leetcodeCodeAttempts,
  ownerBankQuestions,
  practiceNotes,
  practiceTranscriptTurns,
  problemPreferences,
  problemSolutionProfiles,
  problemSolutionRevisions,
  provisionalSolutionProfiles,
  reviewSchedules,
  specialistTasks,
  voiceCaptureIntents,
  voiceExchangeReservations,
  voiceResponseGroupMembers,
  voiceResponseGroupRepairEvents,
  voiceResponseGroups,
  voiceSpecialistResponses,
} from "./schema";
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

export type Specialty = "leetcode" | "system_design" | "behavioral";
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
  modelAnswer: string;
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
    sections: Array<{ title: string; body: string }>;
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
  };
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
        ...(metadata ? deriveQuestionMetadataTags(metadata) : []),
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

function validateSolutionProfile(specialty: Specialty, payload: SpecialistFinalization["solutionProfile"]) {
  if (!payload?.summary.trim() || payload.sections.length === 0) {
    throw new Error("A complete finalization needs a reusable Solution Profile.");
  }
  if (specialty === "behavioral" && payload.sections.some((section) => TRANSCRIPT_SECTION.test(section.title))) {
    throw new Error("Behavioral Solution Profiles cannot contain a transcript; keep it on the dated Past attempt.");
  }
  if (specialty === "behavioral" && !payload.behavioralAnswer?.preferred.answer.trim()) {
    throw new Error("Behavioral Solution Profiles require the user's polished, evidence-grounded preferred personal answer.");
  }
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

function profileFingerprint(payload: NonNullable<SpecialistFinalization["solutionProfile"]>) {
  return JSON.stringify({
    summary: payload.summary.trim(),
    sections: payload.sections.map((section) => ({ title: section.title.trim(), body: section.body.trim() })),
    tags: normalizedTags(payload.tags).sort(),
    references: payload.references.map((reference) => ({ title: reference.title.trim(), url: reference.url.trim() }))
      .sort((left, right) => left.url.localeCompare(right.url)),
    behavioralAnswer: payload.behavioralAnswer,
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
  const db = getDb();
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
  for (const turn of turns) {
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
      continue;
    }
    await db
      .insert(practiceTranscriptTurns)
      .values({
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
      })
      .onConflictDoNothing();
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
  await db.batch([
    db.insert(practiceTranscriptTurns).values(values[0]).onConflictDoNothing(),
    db.insert(practiceTranscriptTurns).values(values[1]).onConflictDoNothing(),
  ]);
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
      await db.batch([
        db.update(voiceSpecialistResponses).set({
          status: "quarantined_conflict",
          updatedAt: nowMs,
        }).where(and(
          eq(voiceSpecialistResponses.ownerId, ownerId),
          eq(voiceSpecialistResponses.captureId, input.captureId),
        )),
        db.update(voiceCaptureIntents).set({
          status: "quarantined_conflict",
          lastError: "A canonical specialist response was retried with different content or identity.",
          updatedAt: nowMs,
        }).where(and(
          eq(voiceCaptureIntents.ownerId, ownerId),
          eq(voiceCaptureIntents.captureId, input.captureId),
        )),
      ]);
      throw new Error("The Voice envelope already has a different canonical specialist response.");
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

async function readVoiceResponseGroup(ownerId: string, responseTurnId: string) {
  const db = getDb();
  const group = (await db.select().from(voiceResponseGroups).where(and(
    eq(voiceResponseGroups.ownerId, ownerId),
    eq(voiceResponseGroups.responseTurnId, responseTurnId),
  )).limit(1))[0] ?? null;
  if (!group) return null;
  const members = await db.select().from(voiceResponseGroupMembers).where(and(
    eq(voiceResponseGroupMembers.ownerId, ownerId),
    eq(voiceResponseGroupMembers.responseTurnId, responseTurnId),
  )).orderBy(asc(voiceResponseGroupMembers.memberOrder));
  return { group, members };
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
  stored: NonNullable<Awaited<ReturnType<typeof readVoiceResponseGroup>>>,
) {
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
  const responseTurnIds = [...new Set(members.map((member) => member.responseTurnId))];
  const groups = await Promise.all(responseTurnIds.map((responseTurnId) =>
    readVoiceResponseGroup(ownerId, responseTurnId)));
  const groupByResponse = new Map(groups.filter(Boolean).map((stored) => [stored!.group.responseTurnId, stored!]));
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
      const clip = clipById.get(intent.clipId);
      const allowedActions = intent.status === "quarantined_conflict" && group
        ? ["restore_exact_group", "delete_exact_group"]
        : intent.status === "activity_related" || intent.status === "accepted"
          ? ["retry_delivery", "delete_exact_group"]
          : intent.status === "uncertain"
            ? ["attach", "discard"]
            : ["wait"];
      return {
        captureId: intent.captureId,
        turnId: intent.turnId,
        status: intent.status,
        responseTurnId: member?.responseTurnId ?? null,
        memberOrder: member?.memberOrder ?? null,
        memberCount: group?.group.memberCount ?? null,
        groupStatus: group?.group.status ?? null,
        groupDigest: member ? receipts.get(member.responseTurnId)?.digest ?? null : null,
        canonicalUserTurnPresent: presentTurnIds.has(intent.turnId),
        canonicalResponseTurnPresent: member ? presentTurnIds.has(member.responseTurnId) : false,
        transcriptDeliveryState: member?.transcript != null
          ? "received"
          : intent.status === "accepted"
            ? "accepted_without_group_member"
            : "awaiting_delivery",
        audioState: clip?.status ?? "not_registered",
        audioLossAcknowledged: Boolean(clip?.audioLostAcknowledgedAt),
        deletionState: intent.status === "deleting" ? "in_progress" : "not_started",
        lastError: intent.lastError,
        retryable: intent.status === "activity_related" || intent.status === "accepted",
        allowedActions,
      };
    }),
  };
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
  await db.batch([
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
    db.insert(voiceResponseGroupRepairEvents).values({
      ownerId,
      id: `voice-repair-${crypto.randomUUID()}`,
      responseTurnId: input.responseTurnId,
      activityId: input.activityId,
      priorStatus: "quarantined_conflict",
      resultStatus: "provisional",
      reason: input.reason.slice(0, 2_000),
      createdAt: nowMs,
    }),
  ] as unknown as Parameters<typeof db.batch>[0]);
  const repaired = await readVoiceResponseGroup(ownerId, input.responseTurnId);
  if (!repaired || repaired.group.status !== "provisional") {
    throw new VoiceResponseGroupConflictError("The Voice response group repair did not commit atomically.");
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
      ...input,
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
  await db.batch([
    ...userValues.map(guardedTranscriptInsert),
    guardedTranscriptInsert(responseValue),
    db.update(voiceResponseGroups).set({ status: "materialized", updatedAt: nowMs }).where(materializableGroupPredicate),
  ] as unknown as Parameters<typeof db.batch>[0]);
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
    await db.batch([
      guardedTranscriptInsert(userValue),
      db.update(voiceCaptureIntents).set({
        status: "accepted",
        updatedAt: nowMs,
        lastError: null,
      }).where(commitIntentPredicate),
    ]);
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
  await db.batch([
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
  if (untouchedIds.length) {
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
  const incoming = codeAttemptWrite({ ...input, review });
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
  if (!originatingTurn || originatingTurn.speaker !== "user") {
    throw new Error("The Code Attempt originating turn is not an owner-scoped user turn in this activity.");
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
    try {
      await db.batch([
        noReadyFinalizationGuard,
        db.insert(leetcodeCodeAttempts).values(values),
      ]);
    } catch (error) {
      const message = String(error).toLowerCase();
      if (isD1TransactionalInvariantFailure(error)) {
        throw new Error("A Code Attempt cannot be added after its activity is ready or published.");
      }
      if (message.includes("unique constraint")) {
        throw new Error(`Code Attempt ${incoming.sequence} already belongs to another code version.`);
      }
      throw error;
    }
    return { status: "inserted" as const, reviewStatus: review.status };
  }
  if (plan.kind === "backfill_review") throw new Error("Historical review backfill requires the coordinator audit command.");
  const updated = await db.update(leetcodeCodeAttempts).set({
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
  )).returning({ id: leetcodeCodeAttempts.id });
  if (!updated.length) throw new Error("The Code Attempt changed during review completion; reread it and retry.");
  return { status: "updated" as const, reviewStatus: review.status };
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

export async function saveSpecialistFinalization(
  ownerId: string,
  activityId: string,
  specialty: Specialty,
  questionId: string | null,
  payload: SpecialistFinalization,
  nowMs: number,
) {
  const db = getDb();
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
  if (payload.questionMetadata) {
    if (specialty !== "leetcode") {
      throw new Error("Question metadata enrichment is currently supported only for LeetCode finalizations.");
    }
    validateLeetCodeQuestionMetadata(payload.questionMetadata);
  }
  let currentProfile: typeof problemSolutionProfiles.$inferSelect | undefined;
  if (payload.complete) {
    if (!questionId) throw new Error("A complete finalization needs the stable questionId.");
    if (profileAction === "reuse_current") {
      const rows = await db.select().from(problemSolutionProfiles).where(and(
        eq(problemSolutionProfiles.ownerId, ownerId),
        eq(problemSolutionProfiles.specialty, specialty),
        eq(problemSolutionProfiles.questionId, questionId),
      ));
      currentProfile = rows[0];
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
        validateSolutionProfile(specialty, canonicalQuestion.solutionProfile);
        const profile = normalizedSolutionProfile(canonicalQuestion.solutionProfile, payload.references);
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
      validateSolutionProfile(specialty, payload.solutionProfile);
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
  const status = payload.complete ? "ready" : "draft";
  const finalizationWrite = db
    .insert(activityFinalizations)
    .values({
      ownerId,
      activityId,
      specialty,
      status,
      payload,
      finalizedAt: payload.complete ? nowMs : null,
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
        revision: sql`${activityFinalizations.revision} + 1`,
        updatedAt: nowMs,
      },
    });
  if (payload.complete && specialty === "leetcode") {
    const noPendingReviewGuard = d1TransactionalInvariantGuard(db, sql`NOT EXISTS (
          SELECT 1 FROM ${leetcodeCodeAttempts}
          WHERE ${leetcodeCodeAttempts.ownerId} = ${ownerId}
            AND ${leetcodeCodeAttempts.activityId} = ${activityId}
            AND json_extract(${leetcodeCodeAttempts.review}, '$.schemaVersion') = 1
            AND json_extract(${leetcodeCodeAttempts.review}, '$.status') = 'pending'
        )`);
    try {
      await db.batch([noPendingReviewGuard, finalizationWrite]);
    } catch (error) {
      if (isD1TransactionalInvariantFailure(error)) {
        throw new Error("Complete every pending Code Attempt review before finalization.");
      }
      throw error;
    }
  } else {
    await finalizationWrite;
  }

  let linkedRevision: number | null = null;
  if (payload.complete && questionId && profileAction === "reuse_current" && currentProfile) {
    linkedRevision = currentProfile.currentRevision;
  }
  if (payload.complete && questionId && profileAction === "create_or_revise" && payload.solutionProfile) {
    const prior = await db
      .select()
      .from(problemSolutionProfiles)
      .where(and(
        eq(problemSolutionProfiles.ownerId, ownerId),
        eq(problemSolutionProfiles.specialty, specialty),
        eq(problemSolutionProfiles.questionId, questionId),
      ));
    const profile = normalizedSolutionProfile(payload.solutionProfile, payload.references);
    const priorProfile = prior[0];
    if (priorProfile && profileFingerprint(priorProfile.payload as NonNullable<SpecialistFinalization["solutionProfile"]>) === profileFingerprint(profile)) {
      linkedRevision = priorProfile.currentRevision;
    } else {
      const revision = (priorProfile?.currentRevision ?? 0) + 1;
      await db
        .insert(problemSolutionProfiles)
        .values({ ownerId, specialty, questionId, title: payload.title, currentRevision: revision, tags: profile.tags, payload: profile, updatedAt: nowMs })
        .onConflictDoUpdate({
          target: [problemSolutionProfiles.ownerId, problemSolutionProfiles.specialty, problemSolutionProfiles.questionId],
          set: { title: payload.title, currentRevision: revision, tags: profile.tags, payload: profile, updatedAt: nowMs },
        });
      await db.insert(problemSolutionRevisions).values({
        ownerId,
        specialty,
        questionId,
        revision,
        activityId,
        payload: profile,
        createdAt: nowMs,
      });
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
  input: { specialty: Specialty; threadId: string; hostId?: string; title: string },
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
  await db
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
  if (!activityIds.length) return { blockers: [] as PublicationEvidenceBlocker[], unavailableClipIds: [] as string[] };
  const db = getDb();
  const intents = await db.select().from(voiceCaptureIntents).where(and(
    eq(voiceCaptureIntents.ownerId, ownerId),
    inArray(voiceCaptureIntents.activityId, activityIds),
    eq(voiceCaptureIntents.status, "accepted"),
  ));
  if (!intents.length) return { blockers: [] as PublicationEvidenceBlocker[], unavailableClipIds: [] as string[] };
  const clipIds = intents.map((intent) => intent.clipId);
  const [clips, analyses, responses] = await Promise.all([
    db.select().from(activityAudioClips).where(and(
      eq(activityAudioClips.ownerId, ownerId),
      inArray(activityAudioClips.id, clipIds),
    )),
    db.select().from(activityDeliveryAnalyses).where(and(
      eq(activityDeliveryAnalyses.ownerId, ownerId),
      inArray(activityDeliveryAnalyses.audioClipId, clipIds),
    )),
    db.select().from(voiceSpecialistResponses).where(and(
      eq(voiceSpecialistResponses.ownerId, ownerId),
      inArray(voiceSpecialistResponses.captureId, intents.map((intent) => intent.captureId)),
    )),
  ]);
  const canonicalTurnIds = responses.flatMap((response) => [response.userTurnId, response.responseTurnId]);
  const canonicalTurns = canonicalTurnIds.length
    ? await db.select().from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, ownerId),
      inArray(practiceTranscriptTurns.activityId, activityIds),
      inArray(practiceTranscriptTurns.turnId, canonicalTurnIds),
    ))
    : [];
  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const analysisByClipId = new Map(analyses.map((analysis) => [analysis.audioClipId, analysis]));
  const responseByCaptureId = new Map(responses.map((response) => [response.captureId, response]));
  const turnByActivityAndId = new Map(canonicalTurns.map((turn) => [`${turn.activityId}\u0000${turn.turnId}`, turn]));
  const blockers: PublicationEvidenceBlocker[] = [];
  const unavailableClipIds: string[] = [];
  for (const intent of intents) {
    const response = responseByCaptureId.get(intent.captureId);
    const userTurn = response
      ? turnByActivityAndId.get(`${intent.activityId}\u0000${response.userTurnId}`)
      : undefined;
    const specialistTurn = response
      ? turnByActivityAndId.get(`${intent.activityId}\u0000${response.responseTurnId}`)
      : undefined;
    if (!hasCanonicalMaterializedVoiceExchange(intent, response, userTurn, specialistTurn)) {
      blockers.push({
        activityId: intent.activityId,
        captureId: intent.captureId,
        clipId: intent.clipId,
        kind: "transcript_not_materialized",
        status: response?.status ?? "missing",
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
  const [turns, notes, finalizations, reviews, clips, deliveryAnalyses, codeAttempts] = await Promise.all([
    db
      .select()
      .from(practiceTranscriptTurns)
      .where(and(eq(practiceTranscriptTurns.ownerId, ownerId), eq(practiceTranscriptTurns.activityId, activityId)))
      .orderBy(asc(practiceTranscriptTurns.sequence), asc(practiceTranscriptTurns.occurredAt)),
    db.select().from(practiceNotes).where(and(eq(practiceNotes.ownerId, ownerId), eq(practiceNotes.activityId, activityId))),
    db.select().from(activityFinalizations).where(and(eq(activityFinalizations.ownerId, ownerId), eq(activityFinalizations.activityId, activityId))),
    db.select().from(reviewSchedules).where(and(eq(reviewSchedules.ownerId, ownerId), eq(reviewSchedules.activityId, activityId))),
    db.select().from(activityAudioClips).where(and(eq(activityAudioClips.ownerId, ownerId), eq(activityAudioClips.activityId, activityId))),
    db.select().from(activityDeliveryAnalyses).where(and(eq(activityDeliveryAnalyses.ownerId, ownerId), eq(activityDeliveryAnalyses.activityId, activityId))),
    db.select().from(leetcodeCodeAttempts).where(and(
      eq(leetcodeCodeAttempts.ownerId, ownerId),
      eq(leetcodeCodeAttempts.activityId, activityId),
    )).orderBy(asc(leetcodeCodeAttempts.sequence), asc(leetcodeCodeAttempts.occurredAt)),
  ]);
  return { turns, notes, finalization: finalizations[0] ?? null, reviews, audioClips: clips, deliveryAnalyses, codeAttempts };
}

export async function readProblemSolutionProfile(ownerId: string, specialty: Specialty, questionId: string) {
  const db = getDb();
  const category = specialty === "system_design" ? "systemDesign" : specialty;
  const [profiles, provisionalProfiles, revisions, canonicalQuestions] = await Promise.all([
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
    db.select({
      revision: problemSolutionRevisions.revision,
      activityId: problemSolutionRevisions.activityId,
      createdAt: problemSolutionRevisions.createdAt,
    }).from(problemSolutionRevisions).where(and(
      eq(problemSolutionRevisions.ownerId, ownerId),
      eq(problemSolutionRevisions.specialty, specialty),
      eq(problemSolutionRevisions.questionId, questionId),
    )).orderBy(desc(problemSolutionRevisions.revision)),
    db.select({ payload: contentBank.payload }).from(contentBank).where(and(
      eq(contentBank.category, category),
      eq(contentBank.id, questionId),
    )),
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
  return {
    profile: profiles[0] ?? canonicalProfile,
    provisionalProfile: provisionalProfiles[0] ?? null,
    revisions,
  };
}

export async function readDurablePracticeSummary(ownerId: string, _activityIds: string[], today: string) {
  const db = getDb();
  const [notes, reviews, finalizations, clips, deliveryAnalyses, preferences, profiles, revisions, links, personalQuestions] = await Promise.all([
    db.select().from(practiceNotes).where(eq(practiceNotes.ownerId, ownerId)),
    db.select().from(reviewSchedules).where(eq(reviewSchedules.ownerId, ownerId)),
    db.select().from(activityFinalizations).where(eq(activityFinalizations.ownerId, ownerId)),
    db.select().from(activityAudioClips).where(eq(activityAudioClips.ownerId, ownerId)),
    db.select().from(activityDeliveryAnalyses).where(eq(activityDeliveryAnalyses.ownerId, ownerId)),
    db.select().from(problemPreferences).where(eq(problemPreferences.ownerId, ownerId)),
    db.select().from(problemSolutionProfiles).where(eq(problemSolutionProfiles.ownerId, ownerId)),
    db.select().from(problemSolutionRevisions).where(eq(problemSolutionRevisions.ownerId, ownerId)).orderBy(desc(problemSolutionRevisions.createdAt)),
    db.select().from(activitySolutionLinks).where(eq(activitySolutionLinks.ownerId, ownerId)),
    db.select().from(ownerBankQuestions).where(eq(ownerBankQuestions.ownerId, ownerId)),
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
    audioClips: group(clips),
    deliveryAnalyses: group(deliveryAnalyses),
    problemPreferences: preferences,
    solutionProfiles: profiles,
    solutionRevisions: revisions,
    activitySolutionLinks: links,
    personalQuestions,
  };
}

export async function readPendingFinalizations(ownerId: string) {
  const db = getDb();
  return db
    .select()
    .from(activityFinalizations)
    .where(and(eq(activityFinalizations.ownerId, ownerId), inArray(activityFinalizations.status, ["draft", "ready"])));
}
