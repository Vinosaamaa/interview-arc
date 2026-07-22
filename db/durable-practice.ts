import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  activityDeliveryAnalyses,
  activityAudioClips,
  activityFinalizations,
  activitySolutionLinks,
  contentBank,
  ownerBankQuestions,
  practiceNotes,
  practiceTranscriptTurns,
  problemPreferences,
  problemSolutionProfiles,
  problemSolutionRevisions,
  reviewSchedules,
  specialistTasks,
} from "./schema";
import { reviewIntervalDays, type ReviewReason } from "./review-cadence";

export type Specialty = "leetcode" | "system_design" | "behavioral";
export type NoteKind = "remember" | "insight" | "mistake" | "pattern" | "question";
export type TranscriptSpeaker = "user" | "specialist";
export type TranscriptSource = "codex" | "dictation" | "audio_transcript";
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
  solutionProfileAction?: "create_or_revise" | "reuse_current";
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
  const profileAction = payload.solutionProfileAction ?? "create_or_revise";
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
      if (!currentProfile) throw new Error("Cannot reuse a Solution Profile that does not exist.");
    } else {
      validateSolutionProfile(specialty, payload.solutionProfile);
    }
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
      .select({ currentRevision: problemSolutionProfiles.currentRevision })
      .from(problemSolutionProfiles)
      .where(and(
        eq(problemSolutionProfiles.ownerId, ownerId),
        eq(problemSolutionProfiles.specialty, specialty),
        eq(problemSolutionProfiles.questionId, questionId),
      ));
    const revision = (prior[0]?.currentRevision ?? 0) + 1;
    const profile = {
      ...payload.solutionProfile,
      tags: normalizedTags(payload.solutionProfile.tags),
      references: payload.solutionProfile.references.length ? payload.solutionProfile.references : payload.references,
    };
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
  const values = {
    ownerId,
    specialty,
    questionId: question.questionId,
    title: question.title,
    prompt: question.prompt ?? null,
    url: question.url ?? null,
    source: question.source ?? "personal",
    tags: normalizedTags(question.tags ?? []),
    priority: question.priority ?? 0,
    targetMinutes: question.targetMinutes ?? (specialty === "leetcode" ? 40 : 60),
    active: question.active ?? true,
    updatedAt: nowMs,
  };
  await db.insert(ownerBankQuestions).values(values).onConflictDoUpdate({
    target: [ownerBankQuestions.ownerId, ownerBankQuestions.specialty, ownerBankQuestions.questionId],
    set: values,
  });
}

export async function readSpecialistTasks(ownerId: string) {
  const db = getDb();
  return db.select().from(specialistTasks).where(eq(specialistTasks.ownerId, ownerId));
}

export async function readActivityPracticeRecord(ownerId: string, activityId: string) {
  const db = getDb();
  const [turns, notes, finalizations, reviews, clips, deliveryAnalyses] = await Promise.all([
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
  ]);
  return { turns, notes, finalization: finalizations[0] ?? null, reviews, audioClips: clips, deliveryAnalyses };
}

export async function readProblemSolutionProfile(ownerId: string, specialty: Specialty, questionId: string) {
  const db = getDb();
  const category = specialty === "system_design" ? "systemDesign" : specialty;
  const [profiles, revisions, canonicalQuestions] = await Promise.all([
    db.select().from(problemSolutionProfiles).where(and(
      eq(problemSolutionProfiles.ownerId, ownerId),
      eq(problemSolutionProfiles.specialty, specialty),
      eq(problemSolutionProfiles.questionId, questionId),
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
  return { profile: profiles[0] ?? canonicalProfile, revisions };
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
