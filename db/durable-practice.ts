import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  activityDeliveryAnalyses,
  activityAudioClips,
  activityFinalizations,
  activitySolutionLinks,
  contentBank,
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
} from "./schema";
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
      .onConflictDoUpdate({
        target: [
          practiceTranscriptTurns.ownerId,
          practiceTranscriptTurns.activityId,
          practiceTranscriptTurns.turnId,
        ],
        set: {
          body: turn.body,
          source: turn.source ?? "codex",
          sequence: turn.sequence,
          occurredAt: turn.occurredAt,
          updatedAt: nowMs,
        },
      });
  }
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
) {
  const db = getDb();
  const existing = await readVoiceCaptureIntent(ownerId, captureId);
  if (!existing) {
    throw new Error("The voice capture is unavailable or already resolved.");
  }
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
  if (!intent
      || intent.status !== "activity_related"
      || intent.activityId !== input.activityId
      || intent.specialty !== input.specialty
      || intent.turnId !== input.turnId
      || intent.checksum !== input.checksum) {
    throw new Error("Only an acknowledged activity-related capture can be committed.");
  }
  const turn = await appendVoiceTranscriptTurn(ownerId, {
    activityId: input.activityId,
    specialty: input.specialty,
    turnId: input.turnId,
    body: input.transcript,
    occurredAt: input.occurredAt,
  }, nowMs);
  await db.update(voiceCaptureIntents).set({
    status: "accepted",
    updatedAt: nowMs,
    lastError: null,
  }).where(and(
    eq(voiceCaptureIntents.ownerId, ownerId),
    eq(voiceCaptureIntents.captureId, input.captureId),
  ));
  return turn;
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
    eq(practiceTranscriptTurns.turnId, intent.turnId),
  ));
  await db.update(voiceCaptureIntents).set({
    status: "deleted",
    updatedAt: nowMs,
    lastError: null,
  }).where(and(eq(voiceCaptureIntents.ownerId, ownerId), eq(voiceCaptureIntents.captureId, captureId)));
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
    inArray(voiceCaptureIntents.status, ["pending", "activity_related", "uncertain", "deleting"]),
  ));
  return Number(rows[0]?.count ?? 0);
}

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
    const unresolvedCaptures = await unresolvedVoiceCaptureCount(ownerId, activityId);
    if (unresolvedCaptures > 0) {
      throw new Error(
        `${unresolvedCaptures} voice capture${unresolvedCaptures === 1 ? " is" : "s are"} still awaiting an attach/delete decision.`,
      );
    }
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
