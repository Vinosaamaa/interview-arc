import { and, asc, desc, eq, exists, gt, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
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
  voiceSpecialistResponses,
} from "./schema";
import {
  finishDispositionForVoiceStatus,
  sameCanonicalExchange,
  sameVoiceCommitTurn,
  type CanonicalExchangeIdentity,
  voiceCaptureAllowsCommit,
  voiceCaptureDeleteTurnIds,
  type VoiceFinishGuard,
  type VoiceIntentStatus,
  voiceFinishGuardMessage,
} from "./practice-exchange-policy";
import {
  mergePersonalLeetCodeQuestionMetadata,
  questionMetadataUpdateFields,
  readStoredQuestionMetadata,
  validateLeetCodeQuestionMetadata,
  type LeetCodeQuestionMetadata,
} from "./question-metadata";
import { reviewIntervalDays, type ReviewReason } from "./review-cadence";

export type Specialty = "leetcode" | "system_design" | "behavioral";
export type NoteKind = "remember" | "insight" | "mistake" | "pattern" | "question";
export type TranscriptSpeaker = "user" | "specialist";
export type TranscriptSource = "codex" | "dictation" | "audio_transcript";
export type VoiceCaptureDecision = "activity_related" | "unrelated" | "uncertain";
export type { ReviewReason } from "./review-cadence";

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
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase().replace(/[^a-z0-9+#.]+/g, "-")).filter(Boolean))]
    .slice(0, 32);
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
      tags: normalizedTags([...((question.tags ?? []) as string[]), ...tags]),
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

  if (intent) {
    await db.batch([
      responseInsert,
      db.update(voiceCaptureIntents).set({
        status: "activity_related",
        decisionSource: "specialist",
        decisionReason: input.reason.slice(0, 2_000),
        decidedAt: nowMs,
        lastError: null,
        updatedAt: nowMs,
      }).where(and(
        eq(voiceCaptureIntents.ownerId, ownerId),
        eq(voiceCaptureIntents.captureId, input.captureId),
      )),
    ]);
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
    await db.batch([
      responseInsert,
      db.insert(deferredVoiceCaptureDecisions).values({
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
      }).onConflictDoNothing(),
    ]);
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

export async function beginDeleteVoiceCapture(ownerId: string, captureId: string, nowMs: number) {
  const db = getDb();
  const intent = await readVoiceCaptureIntent(ownerId, captureId);
  if (!intent) throw new Error("Voice capture not found.");
  await db.update(voiceCaptureIntents).set({
    status: "deleting",
    updatedAt: nowMs,
    lastError: null,
  }).where(and(eq(voiceCaptureIntents.ownerId, ownerId), eq(voiceCaptureIntents.captureId, captureId)));
  return intent;
}

export async function completeDeleteVoiceCapture(ownerId: string, captureId: string, nowMs: number) {
  const db = getDb();
  const intent = await readVoiceCaptureIntent(ownerId, captureId);
  if (!intent) return;
  const response = (await db.select({
    userTurnId: voiceSpecialistResponses.userTurnId,
    responseTurnId: voiceSpecialistResponses.responseTurnId,
  }).from(voiceSpecialistResponses).where(and(
    eq(voiceSpecialistResponses.ownerId, ownerId),
    eq(voiceSpecialistResponses.captureId, captureId),
  )).limit(1))[0] ?? null;
  const transcriptTurnIds = voiceCaptureDeleteTurnIds(intent.turnId, response);
  await db.delete(activityDeliveryAnalyses).where(and(
    eq(activityDeliveryAnalyses.ownerId, ownerId),
    eq(activityDeliveryAnalyses.transcriptTurnId, intent.turnId),
  ));
  await db.delete(activityAudioClips).where(and(
    eq(activityAudioClips.ownerId, ownerId),
    eq(activityAudioClips.id, intent.clipId),
  ));
  await db.delete(practiceTranscriptTurns).where(and(
    eq(practiceTranscriptTurns.ownerId, ownerId),
    eq(practiceTranscriptTurns.activityId, intent.activityId),
    inArray(practiceTranscriptTurns.turnId, transcriptTurnIds),
  ));
  await db.batch([
    db.delete(voiceSpecialistResponses).where(and(
      eq(voiceSpecialistResponses.ownerId, ownerId),
      eq(voiceSpecialistResponses.captureId, captureId),
    )),
    db.update(voiceCaptureIntents).set({
      status: "deleted",
      updatedAt: nowMs,
      lastError: null,
    }).where(and(eq(voiceCaptureIntents.ownerId, ownerId), eq(voiceCaptureIntents.captureId, captureId))),
  ]);
}

export async function failDeleteVoiceCapture(ownerId: string, captureId: string, message: string, nowMs: number) {
  const db = getDb();
  await db.update(voiceCaptureIntents).set({
    status: "deleting",
    lastError: message.slice(0, 2_000),
    updatedAt: nowMs,
  }).where(and(eq(voiceCaptureIntents.ownerId, ownerId), eq(voiceCaptureIntents.captureId, captureId)));
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
  const canonicalTurnIds = responses.flatMap((response) => [response.userTurnId, response.responseTurnId]);
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
      const userTurn = response ? turnById.get(response.userTurnId) : null;
      const specialistTurn = response ? turnById.get(response.responseTurnId) : null;
      const hasCanonicalExchange = hasCanonicalMaterializedVoiceExchange(
        intent,
        response,
        userTurn,
        specialistTurn,
      );
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

export async function saveLeetCodeCodeAttempt(
  ownerId: string,
  input: {
    id: string;
    activityId: string;
    originatingTurnId: string;
    sequence: number;
    language: string;
    code: string;
    occurredAt: number;
    review?: unknown;
    observedCorrectness: "not_verified" | "appears_correct" | "issues_found" | "incomplete";
    concreteFindings: string[];
    edgeCases: string[];
    complexity?: { time?: string; space?: string };
    finalDeclaration: string;
  },
  nowMs: number,
) {
  const db = getDb();
  const values = {
    ownerId,
    ...input,
    language: input.language.trim().slice(0, 40),
    code: input.code,
    lineCount: input.code.split(/\r?\n/).length,
    review: input.review ?? null,
    concreteFindings: input.concreteFindings,
    edgeCases: input.edgeCases,
    complexity: input.complexity ?? null,
    createdAt: nowMs,
    updatedAt: nowMs,
  };
  await db.insert(leetcodeCodeAttempts).values(values).onConflictDoUpdate({
    target: [leetcodeCodeAttempts.ownerId, leetcodeCodeAttempts.id],
    set: {
      review: values.review,
      observedCorrectness: values.observedCorrectness,
      concreteFindings: values.concreteFindings,
      edgeCases: values.edgeCases,
      complexity: values.complexity,
      finalDeclaration: values.finalDeclaration,
      updatedAt: nowMs,
    },
  });
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
  await db
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
  },
  nowMs: number,
) {
  const db = getDb();
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
