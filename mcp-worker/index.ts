import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { codeAttemptReviewInputSchema } from "./code-attempt-review-schema";
import { codeLineCount } from "../db/code-attempt-review";
import { loadContentIndex } from "../db/content";
import { resolveIntegrationOwner } from "../db/integrations";
import {
  applyFocusTimerAction,
  applyTimerAction,
  activityTimerWasRunningAt,
  readActiveVoiceActivity,
  readLiveState,
  readVoiceTimerInstrument,
  readVoiceTimerTarget,
  removeExtraActivity,
  removeFocusBlock,
  removeLiveSession,
  startFreshWorkbench,
  setActivityNote,
  setOutcome,
  setPublicationStatus,
  rolloverPublishedWorkbench,
  TimerStateConflictError,
  upsertExtraActivity,
  type OutcomeValue,
  type PublicationStatusValue,
  type TimerAction,
  type LiveState,
} from "../db/live-state";
import { buildPracticeSnapshot, buildPublicationQueue, dateInPracticeTimeZone } from "../db/practice-snapshot";
import { leetCodeQuestionMetadataSchema } from "../db/question-metadata";
import { connectOwnerLiveUpdates, publishOwnerLiveUpdate } from "../worker/live-update-hub";
import {
  addPracticeNote,
  acknowledgeActivityAudioLost,
  acknowledgePublishWithoutDeliveryReview,
  appendTranscriptTurns,
  appendVoiceTranscriptTurn,
  beginDeleteVoiceCaptureGraph,
  clearActivityReviewSchedules,
  commitRelatedVoiceCapture,
  completeDeleteVoiceCapture,
  expireUnclassifiedVoiceCapture,
  failDeleteVoiceCapture,
  markFinalizationPublished,
  prepareVoiceCapturesForFinish,
  prepareLegacyVoiceCaptureDeletion,
  readActivityAudioClip,
  readActivityAudioClips,
  readActivityPracticeRecord,
  readLikelyLegacyVoiceOrphans,
  readProblemSolutionProfile,
  readSpecialistTasks,
  readVoiceCaptureIntent,
  readVoiceCaptureIntents,
  readVoiceCaptureIntentsPage,
  registerVoiceCaptureIntent,
  registerActivityAudioClip,
  registerSpecialistTask,
  reportActivityAudioLost,
  resolveVoiceCaptureAndSaveResponse,
  resolveVoiceCaptureBatchAndSaveResponse,
  resolveVoiceCaptureIntent,
  saveActivityDeliveryAnalysis,
  saveLeetCodeCodeAttempt,
  saveProvisionalSolutionProfile,
  saveSpecialistFinalization,
  saveTypedPracticeExchange,
  scheduleReview,
  setProblemStar,
  updateActivityAudioClipStatus,
  upsertOwnerBankQuestion,
  voiceFinishGuardMessage,
} from "../db/durable-practice";
import {
  typedExchangeReceipt,
  voiceDecisionReceipt,
} from "../db/practice-exchange-policy";
import {
  applyPlanningSelection,
  readPlanningMutation,
  rememberPlanningMutation,
  TodayPlanningConflictError,
} from "../db/today-planning";
import {
  filterPlanningCatalog,
  planningRequestFingerprint,
  specialistPlanningReplay,
  PlanningSelectionError,
  selectExactPlanningQuestions,
  type PlanningSelection,
  type PlanningSpecialty,
  type PlanningAttention,
} from "../db/today-planning-policy";
import { SpecialistControlError } from "../db/specialist-controls-policy";
import {
  controlSessionPracticeTimer,
  finishAndAdvancePracticeActivity,
  setPracticeResultAtomic,
  startFreshPracticeWorkbench,
  startSessionPracticeActivity,
} from "../db/specialist-controls-store";
import {
  controlPracticeWorkbench,
  controlPracticeSessionTimer,
  controlPracticeTimer,
  setPracticeResult,
  type PracticeResultControlDependencies,
  type PracticeTimerControlDependencies,
  type PracticeWorkbenchControlDependencies,
  type SpecialistPracticeActivity,
} from "../db/specialist-controls-runtime";
import {
  remediateRelatedVoiceCapture,
  voiceCaptureRemediationAnnotations,
  voiceCaptureRemediationInputSchema,
} from "./voice-capture-remediation";
import {
  resolveVoiceCaptureBatch,
  voiceCaptureBatchInputSchema,
} from "./voice-capture-batch";

interface Env {
  DB: D1Database;
  AUDIO: R2Bucket;
  LIVE_UPDATES: DurableObjectNamespace;
}

function safeAudioFilename(value: string) {
  return value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "practice-audio";
}

async function uploadPracticeAudio(ownerId: string, request: Request, env: Env) {
  const form = await request.formData();
  const captureId = String(form.get("captureId") ?? "").trim();
  const requestedClipId = String(form.get("clipId") ?? "").trim();
  const activityId = String(form.get("activityId") ?? "").trim();
  const transcriptTurnId = String(form.get("transcriptTurnId") ?? "").trim() || undefined;
  const label = String(form.get("label") ?? "Practice answer").trim().slice(0, 120) || "Practice answer";
  const durationValue = Number(form.get("durationSeconds") ?? "");
  const durationSeconds = Number.isFinite(durationValue) && durationValue >= 0 ? Math.round(durationValue) : undefined;
  const file = form.get("file");
  const intent = captureId ? await readVoiceCaptureIntent(ownerId, captureId) : null;
  if ((requestedClipId && !/^[a-zA-Z0-9._-]{1,120}$/.test(requestedClipId))
      || !activityId || !(file instanceof File) || !file.type.startsWith("audio/") || file.size === 0 || file.size > 100 * 1024 * 1024) {
    return json(request, { error: "An activityId and non-empty audio file no larger than 100 MB are required." }, { status: 400 });
  }
  if (captureId && (!intent
      || intent.status !== "accepted"
      || intent.activityId !== activityId
      || intent.turnId !== transcriptTurnId
      || intent.clipId !== requestedClipId)) {
    return json(request, { error: "Audio upload requires the matching accepted voice-capture intent." }, { status: 409 });
  }
  const clipId = requestedClipId || crypto.randomUUID();
  const filename = safeAudioFilename(file.name);
  const objectKey = `${ownerId}/${activityId}/${clipId}-${filename}`;
  await registerActivityAudioClip(ownerId, { id: clipId, activityId, transcriptTurnId, filename, mimeType: file.type, label, durationSeconds, objectKey, status: "uploading" }, Date.now());
  try {
    await env.AUDIO.put(objectKey, file.stream(), {
      httpMetadata: { contentType: file.type, contentDisposition: `inline; filename="${filename}"` },
      customMetadata: { ownerId, activityId, clipId, ...(transcriptTurnId ? { transcriptTurnId } : {}) },
    });
    if (captureId) {
      const finalIntent = await readVoiceCaptureIntent(ownerId, captureId);
      if (!finalIntent || finalIntent.status !== "accepted") {
        await env.AUDIO.delete(objectKey);
        await completeDeleteVoiceCapture(ownerId, captureId, Date.now());
        return json(request, {
          error: "Voice capture deletion won the upload race; the late object was removed.",
          code: "voice_capture_deleting",
          retryable: false,
        }, { status: 409 });
      }
    }
    await updateActivityAudioClipStatus(ownerId, clipId, "available", Date.now());
  } catch (error) {
    await updateActivityAudioClipStatus(ownerId, clipId, "failed", Date.now());
    throw error;
  }
  return json(request, { clipId, activityId, transcriptTurnId: transcriptTurnId ?? null, filename, mimeType: file.type, label, durationSeconds: durationSeconds ?? null, status: "available" }, { status: 201 });
}

async function reportVoiceAudioLoss(
  ownerId: string,
  request: Request,
  captureId: string,
  env: Env,
) {
  const body = (await request.json()) as {
    clipId?: string;
    reason?: "local_source_missing" | "local_source_unreadable";
  };
  const intent = await readVoiceCaptureIntent(ownerId, captureId);
  if (!intent || intent.status !== "accepted" || !body.clipId || intent.clipId !== body.clipId) {
    return json(request, {
      error: "Audio loss can be reported only for the matching accepted Voice capture.",
    }, { status: 409 });
  }
  if (!body.reason || !["local_source_missing", "local_source_unreadable"].includes(body.reason)) {
    return json(request, { error: "A supported privacy-safe loss reason is required." }, { status: 400 });
  }
  const clip = await readActivityAudioClip(ownerId, body.clipId);
  if (clip?.status === "available") {
    return json(request, {
      error: "The original recording is already durable in private storage.",
      code: "audio_already_available",
      retryable: false,
    }, { status: 409 });
  }
  await reportActivityAudioLost(ownerId, body.clipId, body.reason, Date.now());
  await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "voice_capture");
  return json(request, {
    captureId,
    clipId: body.clipId,
    status: "audio_lost",
    acknowledged: false,
  });
}

async function acknowledgeVoiceAudioLoss(
  ownerId: string,
  request: Request,
  captureId: string,
  env: Env,
) {
  const body = (await request.json()) as { clipId?: string };
  const intent = await readVoiceCaptureIntent(ownerId, captureId);
  if (!intent || intent.status !== "accepted" || !body.clipId || intent.clipId !== body.clipId) {
    return json(request, {
      error: "Audio loss can be acknowledged only for the matching accepted Voice capture.",
    }, { status: 409 });
  }
  await acknowledgeActivityAudioLost(ownerId, body.clipId, Date.now());
  await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "voice_capture");
  return json(request, {
    captureId,
    clipId: body.clipId,
    status: "audio_lost",
    acknowledged: true,
  });
}

async function acknowledgeDeliveryReviewBypass(ownerId: string, request: Request, analysisId: string) {
  await acknowledgePublishWithoutDeliveryReview(ownerId, analysisId, Date.now());
  return json(request, { analysisId, publishWithoutDeliveryReview: true });
}

const VOICE_PROTOCOL_VERSION = 2;

function voiceSpecialty(value: "leetcode" | "system_design" | "behavioral") {
  return value === "leetcode" ? "coding" : value === "system_design" ? "system-design" : "behavioral";
}

async function voiceContext(ownerId: string, request: Request) {
  // Voice polls this route every second. Reading the entire owner history,
  // durable practice graph, and published journal on every idle poll made a
  // newly started stopwatch appear several seconds—or minutes—late. Resolve
  // the one running timer directly, and load richer metadata only when it exists.
  const date = dateInPracticeTimeZone();
  const [activity, timerInstrument] = await Promise.all([
    readActiveVoiceActivity(ownerId),
    readVoiceTimerInstrument(ownerId),
  ]);
  if (!activity) {
    return json(request, {
      protocolVersion: VOICE_PROTOCOL_VERSION,
      date,
      focusedActivity: null,
      timerInstrument,
      specialist: null,
      message: "Start an activity stopwatch in Interview Arc before recording a linked answer.",
    });
  }
  const [content, specialists] = await Promise.all([
    loadContentIndex(),
    readSpecialistTasks(ownerId),
  ]);
  const bank = activity.type === "system_design"
    ? content.questionBanks.systemDesign
    : activity.type === "behavioral"
      ? content.questionBanks.behavioral
      : content.questionBanks.leetcode;
  const question = bank.find((candidate) => candidate.id === activity.questionId)
    ?? bank.find((candidate) => activity.url && candidate.url === activity.url)
    ?? null;
  const specialist = specialists.find((candidate) => candidate.specialty === activity.type) ?? null;
  return json(request, {
    protocolVersion: VOICE_PROTOCOL_VERSION,
    date,
    focusedActivity: {
      activityId: activity.id,
      workbenchId: typeof activity.workbenchId === "string"
        ? activity.workbenchId
        : timerInstrument.workbenchId,
      questionId: activity.questionId ?? null,
      specialty: voiceSpecialty(activity.type),
      interviewArcSpecialty: activity.type,
      title: activity.title,
      prompt: activity.prompt ?? question?.prompt ?? null,
      topics: question?.topics ?? [],
      tags: [...new Set([...(question?.tags ?? []), ...(question?.companyTags ?? [])])],
      companies: question?.companyTags ?? [],
      projects: [],
      vocabularyPackIds: activity.vocabularyPackIds ?? question?.vocabularyPackIds ?? [],
      speechTerms: activity.speechTerms ?? question?.speechTerms ?? [],
      startedAt: activity.timer.startedAt,
      runningSince: activity.timer.runningSince,
    },
    timerInstrument,
    specialist: specialist ? {
      specialty: specialist.specialty,
      threadId: specialist.threadId,
      hostId: specialist.hostId,
      title: specialist.title,
    } : null,
    message: specialist ? null : `Connect the ${activity.type} specialist task before sending a recording.`,
  });
}

async function scheduleCompletedVoiceActivity(
  ownerId: string,
  activity: Pick<SpecialistPracticeActivity, "id" | "type" | "questionId" | "reviewOfActivityId">,
  outcome: OutcomeValue,
  date: string,
  now: number,
) {
  if (outcome === "failed" || outcome === "solved_after_reviewing_approach") {
    await scheduleReview(ownerId, {
      activityId: activity.id,
      questionId: activity.questionId,
      specialty: activity.type,
      completedDate: date,
      reason: outcome === "failed" ? "failed" : "approach_review",
    }, now);
  } else if (outcome === "solved" && typeof activity.reviewOfActivityId === "string") {
    await scheduleReview(ownerId, {
      activityId: activity.id,
      questionId: activity.questionId,
      specialty: activity.type,
      completedDate: date,
      reason: "successful_recall",
    }, now);
  } else {
    await clearActivityReviewSchedules(ownerId, activity.id);
  }
}

async function voiceTimerMutation(ownerId: string, request: Request, env: Env) {
  const body = (await request.json()) as {
    protocolVersion?: number;
    mutation?:
      | { type: "timer"; subjectId: string; kind: "activity" | "session"; action: TimerAction }
      | { type: "finish-activity"; activityId: string; outcome: OutcomeValue; starred: boolean };
  };
  if (body.protocolVersion !== VOICE_PROTOCOL_VERSION || !body.mutation) {
    return json(request, { error: "A supported protocol version and timer mutation are required." }, { status: 400 });
  }
  const mutation = body.mutation;
  const now = Date.now();
  const date = dateInPracticeTimeZone(new Date(now));
  try {
    const instrument = await readVoiceTimerInstrument(ownerId);
    if (mutation.type === "timer") {
      if (
        !mutation.subjectId
        || !["activity", "session"].includes(mutation.kind)
        || !["start", "pause", "finish"].includes(mutation.action)
      ) {
        return json(request, { error: "Invalid timer mutation." }, { status: 400 });
      }
      if (mutation.kind === "session") {
        if (!instrument.session || instrument.session.id !== mutation.subjectId) {
          return json(request, { error: "The requested session is not the current open session." }, { status: 404 });
        }
        await applyTimerAction(ownerId, mutation.subjectId, "session", mutation.action, now, {
          activityIds: instrument.session.activityIds,
        });
      } else {
        const target = await readVoiceTimerTarget(ownerId, mutation.subjectId);
        const activity = target?.activity;
        if (!target || !activity) {
          return json(request, { error: "The requested activity is not available in the open workbench." }, { status: 404 });
        }
        if (mutation.action === "finish" && activity.requiresOutcome) {
          return json(request, {
            error: "Choose a result in the Finish drawer before completing this activity.",
          }, { status: 409 });
        }
        if (activity.activityClass === "focus_block") {
          await applyFocusTimerAction(ownerId, activity.id, mutation.action, now, instrument.session?.id);
        } else {
          const session = target.session;
          if (mutation.action === "start" && session) {
            const mutationId = `voice-timer-${crypto.randomUUID()}`;
            const result = {
              mutationId,
              activityId: activity.id,
              action: "start",
              advancedTo: null,
              applied: true,
            };
            await startSessionPracticeActivity({
              ownerId,
              activityId: activity.id,
              expectedActivityRevision: activity.timer?.revision ?? 0,
              sessionId: session.id,
              sessionActivityIds: session.activityIds,
              mutationId,
              workbenchId: target.workbenchId,
              requestHash: await planningRequestFingerprint(result),
              receipt: result,
              now,
            });
          } else {
            await applyTimerAction(ownerId, activity.id, "activity", mutation.action, now, {
              sessionId: target.session?.id ?? instrument.session?.id,
            });
          }
        }
      }
    } else if (mutation.type === "finish-activity") {
      if (
        !mutation.activityId
        || !["solved", "solved_after_reviewing_approach", "failed"].includes(mutation.outcome)
        || typeof mutation.starred !== "boolean"
      ) {
        return json(request, { error: "A result and star choice are required to finish this activity." }, { status: 400 });
      }
      const activity = instrument.activities.find((candidate) => candidate.id === mutation.activityId);
      if (!activity || !activity.timer?.startedAt) {
        return json(request, { error: "Start the activity stopwatch before finishing it." }, { status: 409 });
      }
      if (activity.activityClass !== "practice") {
        return json(request, { error: "Career focus blocks finish directly and do not accept a result." }, { status: 409 });
      }
      const voiceGuard = await prepareVoiceCapturesForFinish(ownerId, activity.id, now);
      const voiceConflict = voiceFinishGuardMessage(voiceGuard);
      if (voiceConflict) {
        return json(request, {
          error: voiceConflict,
        }, { status: 409 });
      }
      await setOutcome(ownerId, activity.id, mutation.outcome, now);
      if (activity.questionId) {
        await setProblemStar(ownerId, activity.type, activity.questionId, mutation.starred, now);
      }
      await applyTimerAction(ownerId, activity.id, "activity", "finish", now, {
        sessionId: instrument.session?.id,
      });
      await scheduleCompletedVoiceActivity(ownerId, activity, mutation.outcome, date, now);
    } else {
      return json(request, { error: "Unsupported timer mutation." }, { status: 400 });
    }
    await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "timer");
    return json(request, {
      protocolVersion: VOICE_PROTOCOL_VERSION,
      timerInstrument: await readVoiceTimerInstrument(ownerId),
    });
  } catch (error) {
    if (error instanceof TimerStateConflictError) {
      return json(request, { error: error.message }, { status: 409 });
    }
    throw error;
  }
}

const planningSpecialties = ["leetcode", "system_design", "behavioral"] as const;

function planningBankKey(specialty: PlanningSpecialty) {
  return specialty === "system_design" ? "systemDesign" : specialty;
}

function mergePlanningQuestions(
  specialty: PlanningSpecialty,
  canonical: Awaited<ReturnType<typeof loadContentIndex>>["questionBanks"]["leetcode"],
  personalRows: unknown[],
) {
  const personal = personalRows
    .filter((row): row is Record<string, unknown> => (
      Boolean(row)
      && typeof row === "object"
      && (row as { specialty?: unknown }).specialty === specialty
      && typeof (row as { questionId?: unknown }).questionId === "string"
    ))
    .map((row) => ({
      id: String(row.questionId),
      title: String(row.title ?? row.questionId),
      prompt: typeof row.prompt === "string" ? row.prompt : undefined,
      url: typeof row.url === "string" ? row.url : undefined,
      difficulty: ["easy", "medium", "hard"].includes(String(row.difficulty))
        ? row.difficulty as "easy" | "medium" | "hard"
        : undefined,
      acceptanceRate: typeof row.acceptanceRate === "number" ? row.acceptanceRate : undefined,
      source: typeof row.source === "string" ? row.source : "personal",
      companyTags: Array.isArray(row.companyTags) ? row.companyTags.map(String) : [],
      companySignals: Array.isArray(row.companySignals) ? row.companySignals as never[] : [],
      topics: Array.isArray(row.topics) ? row.topics.map(String) : [],
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      priority: typeof row.priority === "number" ? row.priority : 0,
      targetMinutes: typeof row.targetMinutes === "number"
        ? row.targetMinutes
        : specialty === "leetcode" ? 40 : 60,
      active: row.active !== false,
    }));
  const personalById = new Map(personal.map((question) => [question.id, question]));
  return [
    ...personal.filter((question) => !canonical.some((item) => item.id === question.id)),
    ...canonical.map((question) => ({
      ...question,
      ...(personalById.get(question.id) ?? {}),
      topics: [...new Set([
        ...question.topics,
        ...(personalById.get(question.id)?.topics ?? []),
      ])],
      tags: [...new Set([
        ...(question.tags ?? []),
        ...(personalById.get(question.id)?.tags ?? []),
      ])],
    })),
  ];
}

function planningAttentionByQuestionId(
  specialty: PlanningSpecialty,
  state: Awaited<ReturnType<typeof readLiveState>>,
  date: string,
) {
  const latest = new Map<string, { activityId: string; completedAt: number }>();
  for (const candidate of state.historyActivities) {
    const row = candidate as {
      id?: unknown;
      questionId?: unknown;
      type?: unknown;
    };
    if (
      typeof row.id !== "string"
      || typeof row.questionId !== "string"
      || row.type !== specialty
    ) continue;
    const completedAt = state.timers[row.id]?.completedAt;
    if (!completedAt) continue;
    const current = latest.get(row.questionId);
    if (!current || completedAt > current.completedAt) {
      latest.set(row.questionId, { activityId: row.id, completedAt });
    }
  }
  return new Map(
    [...latest.entries()].map(([questionId, attempt]) => {
      const attention = new Set<PlanningAttention>();
      const outcome = state.outcomes[attempt.activityId];
      if (outcome === "solved") attention.add("solved");
      if (outcome === "solved_after_reviewing_approach") attention.add("helped");
      if (outcome === "failed") attention.add("failed");
      const review = state.reviews[attempt.activityId] as {
        status?: unknown;
        dueDate?: unknown;
      } | undefined;
      const reviewOpen = review
        && review.status !== "dismissed"
        && review.status !== "completed";
      if (reviewOpen) attention.add("needs_review");
      if (
        review?.status === "due"
        || (review?.status === "scheduled"
          && typeof review.dueDate === "string"
          && review.dueDate <= date)
      ) attention.add("due");
      return [questionId, attention] as const;
    }),
  );
}

type PlanningDataContext = {
  date: string;
  content: Awaited<ReturnType<typeof loadContentIndex>>;
  state: Awaited<ReturnType<typeof readLiveState>>;
};

async function planningData(
  ownerId: string,
  request: Request,
  context?: PlanningDataContext,
) {
  const url = new URL(request.url);
  const specialtyValue = url.searchParams.get("specialty") ?? "leetcode";
  if (!planningSpecialties.includes(specialtyValue as PlanningSpecialty)) {
    return json(request, { error: "Invalid planning specialty." }, { status: 400 });
  }
  const specialty = specialtyValue as PlanningSpecialty;
  const date = context?.date ?? dateInPracticeTimeZone();
  const [content, state] = context
    ? [context.content, context.state]
    : await Promise.all([
      loadContentIndex(),
      readLiveState(ownerId, date),
    ]);
  const canonical = content.questionBanks[planningBankKey(specialty)];
  const questions = mergePlanningQuestions(
    specialty,
    canonical,
    state.personalQuestions,
  );
  const starredQuestionIds = new Set(
    state.problemPreferences.flatMap((candidate) => {
      const row = candidate as {
        specialty?: unknown;
        questionId?: unknown;
        starred?: unknown;
      };
      return row.specialty === specialty
        && typeof row.questionId === "string"
        && row.starred === true
        ? [row.questionId]
        : [];
    }),
  );
  const blockedQuestionIds = new Set(
    state.extraActivities.flatMap((candidate) => {
      const row = candidate as { questionId?: unknown };
      return typeof row.questionId === "string" ? [row.questionId] : [];
    }),
  );
  const recencyByQuestionId = new Map<string, number>();
  for (const candidate of state.historyActivities) {
    const row = candidate as { id?: unknown; questionId?: unknown };
    if (typeof row.id !== "string" || typeof row.questionId !== "string") continue;
    const completedAt = state.timers[row.id]?.completedAt;
    if (completedAt && completedAt > (recencyByQuestionId.get(row.questionId) ?? 0)) {
      recencyByQuestionId.set(row.questionId, completedAt);
    }
  }
  const levels = new Set(
    (url.searchParams.get("difficulty") ?? "")
      .split(",")
      .filter((value): value is "easy" | "medium" | "hard" => (
        ["easy", "medium", "hard"].includes(value)
      )),
  );
  const attentionFilters = new Set(
    (url.searchParams.get("attention") ?? "")
      .split(",")
      .filter((value): value is PlanningAttention => (
        ["due", "needs_review", "solved", "helped", "failed", "todo"].includes(value)
      )),
  );
  const attentionByQuestionId = planningAttentionByQuestionId(specialty, state, date);
  for (const question of questions) {
    if (!attentionByQuestionId.has(question.id)) {
      attentionByQuestionId.set(question.id, new Set(["todo"]));
    }
  }
  const catalog = filterPlanningCatalog(questions, {
    search: url.searchParams.get("search") ?? "",
    starredQuestionIds,
    starredOnly: url.searchParams.get("starred") === "true",
    levels,
    attentionFilters,
    attentionByQuestionId,
    sort: ["frequency", "recent", "acceptance"].includes(url.searchParams.get("sort") ?? "")
      ? url.searchParams.get("sort") as "frequency" | "recent" | "acceptance"
      : "frequency",
    direction: url.searchParams.get("direction") === "asc" ? "asc" : "desc",
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 30),
    blockedQuestionIds,
    recencyByQuestionId,
  });
  return json(request, {
    protocolVersion: 1,
    date,
    workbench: state.workbench,
    summary: {
      sessionCount: state.sessions.length,
      activityCount: state.extraActivities.length,
      focusBlockCount: state.focusBlocks.length,
      plannedSeconds: [
        ...state.sessions.map((candidate) => Number((candidate as { allocatedSeconds?: unknown }).allocatedSeconds ?? 0)),
        ...state.extraActivities
          .filter((candidate) => !(candidate as { sessionId?: unknown }).sessionId)
          .map((candidate) => Number((candidate as { allocatedSeconds?: unknown }).allocatedSeconds ?? 0)),
        ...state.focusBlocks
          .filter((candidate) => !state.sessions.some((session) => (
            Array.isArray((session as { activityIds?: unknown }).activityIds)
            && ((session as { activityIds: unknown[] }).activityIds).includes(
              (candidate as { id?: unknown }).id,
            )
          )))
          .map((candidate) => Number((candidate as { plannedSeconds?: unknown }).plannedSeconds ?? 0)),
      ].reduce((total, seconds) => total + seconds, 0),
    },
    current: {
      sessions: state.sessions,
      activities: state.extraActivities,
      focusBlocks: state.focusBlocks,
      timers: state.timers,
      sessionTimers: state.sessionTimers,
    },
    catalog: { specialty, ...catalog },
  });
}

const planningSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("practice"),
    specialty: z.enum(planningSpecialties),
    questionId: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(500),
    url: z.string().url().max(2_000).optional(),
    prompt: z.string().max(20_000).optional(),
    minutes: z.number().int().min(1).max(720),
    topics: z.array(z.string().min(1).max(120)).max(50).optional(),
  }),
  z.object({
    kind: z.literal("focus"),
    focusCategory: z.literal("job_applications"),
    title: z.string().trim().min(1).max(500),
    minutes: z.number().int().min(1).max(720),
    note: z.string().max(20_000).optional(),
  }),
]);

const planningMutationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add_selection"),
    mutationId: z.string().min(1).max(120),
    workbenchId: z.string().min(1),
    destination: z.enum(["standalone", "session"]),
    selections: z.array(planningSelectionSchema).min(1).max(30),
    specialistRequestHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }),
  z.object({
    type: z.literal("create_full_session"),
    mutationId: z.string().min(1).max(120),
    workbenchId: z.string().min(1),
    coding: z.number().int().min(0).max(20),
    systemDesign: z.number().int().min(0).max(10),
    behavioral: z.number().int().min(0).max(10),
  }).refine((value) => value.coding + value.systemDesign + value.behavioral > 0),
  z.object({
    type: z.literal("problem_star"),
    mutationId: z.string().min(1).max(120),
    workbenchId: z.string().min(1),
    specialty: z.enum(planningSpecialties),
    questionId: z.string().min(1),
    starred: z.boolean(),
  }),
  z.object({
    type: z.literal("personal_question_upsert"),
    mutationId: z.string().min(1).max(120),
    workbenchId: z.string().min(1),
    specialty: z.enum(planningSpecialties),
    question: z.object({
      questionId: z.string().min(1),
      title: z.string().trim().min(1).max(500),
      prompt: z.string().max(20_000).optional(),
      url: z.string().url().max(2_000).optional(),
      tags: z.array(z.string().max(120)).max(50).optional(),
      targetMinutes: z.number().int().min(1).max(720).optional(),
    }),
  }),
  z.object({
    type: z.literal("remove"),
    mutationId: z.string().min(1).max(120),
    workbenchId: z.string().min(1),
    kind: z.enum(["activity", "focus", "session"]),
    id: z.string().min(1),
  }),
  z.object({
    type: z.literal("start_fresh_today"),
    mutationId: z.string().min(1).max(120),
    workbenchId: z.string().min(1),
    newWorkbenchId: z.string().min(1).max(180),
  }),
]);

async function voicePlanningMutation(
  ownerId: string,
  request: Request,
  env: Env,
  preflightReceipt?: Awaited<ReturnType<typeof readPlanningMutation>>,
) {
  const parsed = planningMutationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return json(request, {
      error: "Invalid planning mutation.",
      details: parsed.error.issues,
    }, { status: 400 });
  }
  const mutation = parsed.data;
  const date = dateInPracticeTimeZone();
  try {
    const state = await readLiveState(ownerId, date);
    if (mutation.type === "start_fresh_today") {
      const requestHash = await planningRequestFingerprint(mutation);
      const receipt = await readPlanningMutation(ownerId, mutation.mutationId);
      if (receipt) {
        if (receipt.requestHash !== requestHash) {
          throw new TodayPlanningConflictError(
            "planning_mutation_identity_conflict",
            "That mutation identifier was already used for different content.",
          );
        }
        const authoritative = await readLiveState(ownerId, date);
        return json(request, {
          protocolVersion: 1,
          duplicate: true,
          result: receipt.response,
          authoritative: {
            workbench: authoritative.workbench,
            sessions: authoritative.sessions,
            activities: authoritative.extraActivities,
            focusBlocks: authoritative.focusBlocks,
          },
        });
      }
      if (!state.workbench || state.workbench.id !== mutation.workbenchId) {
        return json(request, {
          error: "Today changed in another surface. Refresh before starting fresh.",
          code: "stale_workbench",
          retryable: false,
        }, { status: 409 });
      }
      await startFreshWorkbench(ownerId, date, Date.now(), mutation.newWorkbenchId);
      const response = {
        mutationId: mutation.mutationId,
        applied: true,
        workbenchId: mutation.newWorkbenchId,
      };
      await rememberPlanningMutation(ownerId, {
        mutationId: mutation.mutationId,
        workbenchId: mutation.workbenchId,
        requestHash,
        response,
        createdAt: Date.now(),
      });
      await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "practice");
      const authoritative = await readLiveState(ownerId, date);
      return json(request, {
        protocolVersion: 1,
        duplicate: false,
        result: response,
        authoritative: {
          workbench: authoritative.workbench,
          sessions: authoritative.sessions,
          activities: authoritative.extraActivities,
          focusBlocks: authoritative.focusBlocks,
        },
      });
    }
    if (!state.workbench || state.workbench.id !== mutation.workbenchId) {
      return json(request, {
        error: "Today changed in another surface. Refresh and review your selection.",
        code: "stale_workbench",
        retryable: false,
      }, { status: 409 });
    }
    let result: unknown;
    if (mutation.type === "add_selection") {
      result = await applyPlanningSelection(ownerId, {
        date,
        workbenchId: mutation.workbenchId,
        mutationId: mutation.mutationId,
        destination: mutation.destination,
        sessionNumber: state.sessions.length + 1,
        selections: mutation.selections as PlanningSelection[],
        specialistRequestHash: mutation.specialistRequestHash,
      }, Date.now(), preflightReceipt);
    } else if (mutation.type === "create_full_session") {
      const content = await loadContentIndex();
      const blocked = new Set(state.extraActivities.flatMap((candidate) => {
        const questionId = (candidate as { questionId?: unknown }).questionId;
        return typeof questionId === "string" ? [questionId] : [];
      }));
      const take = (
        specialty: PlanningSpecialty,
        count: number,
      ): PlanningSelection[] => {
        const questions = filterPlanningCatalog(
          content.questionBanks[planningBankKey(specialty)],
          {
            blockedQuestionIds: blocked,
            sort: "frequency",
            direction: "desc",
            page: 1,
            pageSize: Math.max(1, count),
          },
        ).items.filter((question) => question.eligible).slice(0, count);
        questions.forEach((question) => blocked.add(question.id));
        return questions.map((question) => ({
          kind: "practice",
          specialty,
          questionId: question.id,
          title: question.title,
          url: question.url,
          prompt: question.prompt,
          minutes: question.targetMinutes,
          topics: question.topics,
        }));
      };
      const selections = [
        ...take("leetcode", mutation.coding),
        ...take("system_design", mutation.systemDesign),
        ...take("behavioral", mutation.behavioral),
      ];
      if (selections.length !== mutation.coding + mutation.systemDesign + mutation.behavioral) {
        return json(request, {
          error: "Not enough eligible questions remain for that full session.",
          code: "insufficient_eligible_questions",
          retryable: false,
        }, { status: 409 });
      }
      result = await applyPlanningSelection(ownerId, {
        date,
        workbenchId: mutation.workbenchId,
        mutationId: mutation.mutationId,
        destination: "session",
        sessionNumber: state.sessions.length + 1,
        selections,
      });
    } else {
      const requestHash = await planningRequestFingerprint(mutation);
      const receipt = await readPlanningMutation(ownerId, mutation.mutationId);
      if (receipt) {
        if (receipt.requestHash !== requestHash) {
          throw new TodayPlanningConflictError(
            "planning_mutation_identity_conflict",
            "That mutation identifier was already used for different content.",
          );
        }
        result = { duplicate: true, result: receipt.response };
      } else {
        if (mutation.type === "problem_star") {
          await setProblemStar(
            ownerId,
            mutation.specialty,
            mutation.questionId,
            mutation.starred,
            Date.now(),
          );
        } else if (mutation.type === "personal_question_upsert") {
          await upsertOwnerBankQuestion(
            ownerId,
            mutation.specialty,
            mutation.question,
            Date.now(),
          );
        } else if (mutation.kind === "activity") {
          await removeExtraActivity(ownerId, mutation.id);
        } else if (mutation.kind === "focus") {
          await removeFocusBlock(ownerId, mutation.id);
        } else {
          await removeLiveSession(ownerId, mutation.id);
        }
        const response = { mutationId: mutation.mutationId, applied: true };
        await rememberPlanningMutation(ownerId, {
          mutationId: mutation.mutationId,
          workbenchId: mutation.workbenchId,
          requestHash,
          response,
          createdAt: Date.now(),
        });
        result = { duplicate: false, result: response };
      }
    }
    await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "practice");
    const authoritative = await readLiveState(ownerId, date);
    return json(request, {
      protocolVersion: 1,
      ...result as Record<string, unknown>,
      authoritative: {
        workbench: authoritative.workbench,
        sessions: authoritative.sessions,
        activities: authoritative.extraActivities,
        focusBlocks: authoritative.focusBlocks,
      },
    });
  } catch (error) {
    if (error instanceof TodayPlanningConflictError) {
      return json(request, {
        error: error.message,
        code: error.code,
        retryable: false,
      }, { status: 409 });
    }
    if (error instanceof TimerStateConflictError) {
      return json(request, {
        error: error.message,
        code: "planning_conflict",
        retryable: false,
      }, { status: 409 });
    }
    throw error;
  }
}

async function saveVoiceCapture(ownerId: string, request: Request, env: Env) {
  const body = (await request.json()) as {
    protocolVersion?: number;
    activityId?: string;
    specialty?: "leetcode" | "system_design" | "behavioral";
    turnId?: string;
    captureId?: string;
    checksum?: string;
    transcript?: string;
    occurredAt?: number;
  };
  if (body.protocolVersion !== VOICE_PROTOCOL_VERSION) {
    return json(request, { error: "Unsupported Interview Arc Voice protocol version." }, { status: 409 });
  }
  const activityId = body.activityId?.trim() ?? "";
  const turnId = body.turnId?.trim() ?? "";
  const captureId = body.captureId?.trim() ?? "";
  const checksum = body.checksum?.trim() ?? "";
  const transcript = body.transcript?.trim() ?? "";
  const specialty = body.specialty;
  const occurredAt = Number.isFinite(body.occurredAt) ? Number(body.occurredAt) : Date.now();
  if (!activityId || !specialty || !turnId || !transcript || transcript.length > 200_000) {
    return json(request, { error: "A focused activity, specialty, stable turnId, and transcript are required." }, { status: 400 });
  }
  if (!captureId || !checksum) {
    const snapshot = await buildPracticeSnapshot(ownerId, dateInPracticeTimeZone(), { includeAll: true });
    const activity = snapshot.activities.find((candidate) => candidate.id === activityId);
    const beganWhileRunning = await activityTimerWasRunningAt(ownerId, activityId, occurredAt);
    if (!activity || activity.type !== specialty || !beganWhileRunning) {
      return json(request, { error: "The legacy recording did not begin while this activity stopwatch was running." }, { status: 409 });
    }
    const turn = await appendVoiceTranscriptTurn(ownerId, {
      activityId,
      specialty,
      turnId,
      body: transcript,
      occurredAt,
    }, Date.now());
    await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "voice_capture");
    return json(request, { protocolVersion: VOICE_PROTOCOL_VERSION, turn, legacyAccepted: true }, { status: 201 });
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(transcript));
  const actualChecksum = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  if (actualChecksum !== checksum) {
    return json(request, { error: "Transcript checksum does not match the registered capture." }, { status: 409 });
  }
  const turn = await commitRelatedVoiceCapture(ownerId, {
    captureId,
    activityId,
    specialty,
    turnId,
    transcript,
    checksum,
    occurredAt,
  }, Date.now());
  await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "voice_capture");
  return json(request, { protocolVersion: VOICE_PROTOCOL_VERSION, turn }, { status: 201 });
}

async function registerVoiceIntent(ownerId: string, request: Request, env: Env) {
  const body = (await request.json()) as {
    protocolVersion?: number;
    captureId?: string;
    activityId?: string;
    turnId?: string;
    clipId?: string;
    specialty?: "leetcode" | "system_design" | "behavioral";
    checksum?: string;
    occurredAt?: number;
  };
  if (body.protocolVersion !== VOICE_PROTOCOL_VERSION) {
    return json(request, { error: "Unsupported Interview Arc Voice protocol version." }, { status: 409 });
  }
  const input = {
    captureId: body.captureId?.trim() ?? "",
    activityId: body.activityId?.trim() ?? "",
    turnId: body.turnId?.trim() ?? "",
    clipId: body.clipId?.trim() ?? "",
    specialty: body.specialty,
    checksum: body.checksum?.trim().toLowerCase() ?? "",
    occurredAt: Number.isFinite(body.occurredAt) ? Number(body.occurredAt) : Date.now(),
  };
  if (!input.captureId || !input.activityId || !input.turnId || !input.clipId || !input.specialty
      || !/^[a-f0-9]{64}$/.test(input.checksum)) {
    return json(request, { error: "Complete capture identity, specialty, and SHA-256 checksum are required." }, { status: 400 });
  }
  const existing = await readVoiceCaptureIntent(ownerId, input.captureId);
  if (existing) {
    const identityMatches = existing.activityId === input.activityId
      && existing.turnId === input.turnId
      && existing.clipId === input.clipId
      && existing.specialty === input.specialty
      && existing.checksum === input.checksum
      && existing.occurredAt === input.occurredAt;
    if (!identityMatches) {
      return json(request, {
        error: "This capture ID is already registered with different immutable identity fields.",
        code: "voice_capture_identity_conflict",
        retryable: false,
        existingStatus: existing.status,
      }, { status: 409 });
    }
    return json(request, { protocolVersion: VOICE_PROTOCOL_VERSION, intent: existing, idempotent: true });
  }
  const snapshot = await buildPracticeSnapshot(ownerId, dateInPracticeTimeZone(), { includeAll: true });
  const activity = snapshot.activities.find((candidate) => candidate.id === input.activityId);
  const beganWhileRunning = await activityTimerWasRunningAt(ownerId, input.activityId, input.occurredAt);
  if (!activity || activity.type !== input.specialty || !beganWhileRunning) {
    return json(request, { error: "The recording did not begin while this Interview Arc activity stopwatch was running." }, { status: 409 });
  }
  let intent;
  try {
    intent = await registerVoiceCaptureIntent(
      ownerId,
      input as Parameters<typeof registerVoiceCaptureIntent>[1],
      Date.now(),
    );
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes("cannot be rebound")
      || error.message.includes("deferred voice decision does not match")
    )) {
      return json(request, {
        error: error.message,
        code: "voice_capture_identity_conflict",
        retryable: false,
      }, { status: 409 });
    }
    throw error;
  }
  await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "voice_intent");
  return json(request, { protocolVersion: VOICE_PROTOCOL_VERSION, intent }, { status: 201 });
}

async function listVoiceIntents(ownerId: string, request: Request) {
  const url = new URL(request.url);
  const ids = url.searchParams.getAll("captureId").map((value) => value.trim()).filter(Boolean);
  const status = url.searchParams.get("status");
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 100)));
  const cursor = url.searchParams.get("cursor");
  let cursorUpdatedAt: number | undefined;
  let cursorCaptureId: string | undefined;
  if (cursor) {
    try {
      const normalizedCursor = cursor.replace(/-/g, "+").replace(/_/g, "/")
        .padEnd(Math.ceil(cursor.length / 4) * 4, "=");
      const decoded = JSON.parse(new TextDecoder().decode(
        Uint8Array.from(atob(normalizedCursor), (character) => character.charCodeAt(0)),
      )) as { updatedAt?: number; captureId?: string };
      if (Number.isFinite(decoded.updatedAt) && decoded.captureId) {
        cursorUpdatedAt = Number(decoded.updatedAt);
        cursorCaptureId = decoded.captureId;
      }
    } catch {
      return json(request, { error: "Invalid voice-intent cursor." }, { status: 400 });
    }
  }
  const unresolvedStatuses = ["pending", "activity_related", "uncertain", "deleting"] as const;
  const page = (status === "unresolved" || status === "retained") && ids.length === 0
    ? await readVoiceCaptureIntentsPage(ownerId, {
      statuses: status === "unresolved" ? [...unresolvedStatuses] : undefined,
      cursorUpdatedAt,
      cursorCaptureId,
      limit: limit + 1,
    })
    : null;
  const pageRows = page?.slice(0, limit) ?? null;
  const last = pageRows?.at(-1);
  const nextCursor = page && page.length > limit && last
    ? btoa(JSON.stringify({ updatedAt: last.updatedAt, captureId: last.captureId }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
    : null;
  const [intents, legacyOrphans] = await Promise.all([
    pageRows ? Promise.resolve(pageRows) : readVoiceCaptureIntents(ownerId, ids.length ? ids : undefined),
    ids.length || status === "unresolved" || status === "retained"
      ? Promise.resolve([])
      : readLikelyLegacyVoiceOrphans(ownerId),
  ]);
  return json(request, { protocolVersion: VOICE_PROTOCOL_VERSION, intents, legacyOrphans, nextCursor });
}

async function decideVoiceIntent(ownerId: string, request: Request, captureId: string, env: Env) {
  const body = (await request.json()) as {
    protocolVersion?: number;
    decision?: "activity_related" | "unrelated" | "uncertain";
    reason?: string;
    activityId?: string;
    turnId?: string;
  };
  if (body.protocolVersion !== VOICE_PROTOCOL_VERSION || !body.decision) {
    return json(request, { error: "A supported protocol version and decision are required." }, { status: 400 });
  }
  const intent = await resolveVoiceCaptureIntent(
    ownerId,
    captureId,
    body.decision,
    "voice-user",
    body.reason ?? "Resolved from the local pending-capture card.",
    Date.now(),
    body.activityId && body.turnId ? { activityId: body.activityId, turnId: body.turnId } : undefined,
  );
  await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "voice_intent");
  return json(request, { protocolVersion: VOICE_PROTOCOL_VERSION, intent });
}

async function expireVoiceIntent(ownerId: string, request: Request, captureId: string, env: Env) {
  const body = (await request.json()) as {
    protocolVersion?: number;
    activityId?: string;
    turnId?: string;
  };
  if (body.protocolVersion !== VOICE_PROTOCOL_VERSION || !body.activityId || !body.turnId) {
    return json(request, { error: "A supported protocol version and stable capture identity are required." }, { status: 400 });
  }
  const intent = await expireUnclassifiedVoiceCapture(
    ownerId,
    captureId,
    Date.now(),
    { activityId: body.activityId, turnId: body.turnId },
  );
  await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "voice_intent");
  return json(request, { protocolVersion: VOICE_PROTOCOL_VERSION, intent });
}

async function deleteVoiceCaptureGraph(
  ownerId: string,
  request: Request,
  env: Env,
  captureId: string,
  deletion?: { source: string; reason: string },
) {
  const scope = await beginDeleteVoiceCaptureGraph(ownerId, captureId, Date.now(), deletion);
  try {
    const clips = await readActivityAudioClips(ownerId, scope.intents.map((intent) => intent.clipId));
    await Promise.all(clips
      .filter((clip) => clip.objectKey && !clip.objectKey.startsWith("local-only/"))
      .map((clip) => env.AUDIO.delete(clip.objectKey)));
    await completeDeleteVoiceCapture(ownerId, captureId, Date.now());
    await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "voice_capture");
    return json(request, {
      protocolVersion: VOICE_PROTOCOL_VERSION,
      captureId,
      captureIds: scope.captureIds,
      status: "deleted",
    });
  } catch (error) {
    await failDeleteVoiceCapture(ownerId, captureId, error instanceof Error ? error.message : String(error), Date.now());
    throw error;
  }
}

async function deleteLegacyVoiceCaptureGraph(ownerId: string, request: Request, env: Env, clipId: string) {
  const intent = await prepareLegacyVoiceCaptureDeletion(ownerId, clipId, Date.now());
  if (!intent) throw new Error("Legacy Voice capture not found.");
  return deleteVoiceCaptureGraph(ownerId, request, env, intent.captureId);
}

async function saveVoiceDelivery(ownerId: string, request: Request) {
  const body = (await request.json()) as Parameters<typeof saveActivityDeliveryAnalysis>[1] & { protocolVersion?: number };
  if (body.protocolVersion !== VOICE_PROTOCOL_VERSION) {
    return json(request, { error: "Unsupported Interview Arc Voice protocol version." }, { status: 409 });
  }
  if (!body.id || !body.activityId || !body.audioClipId || !body.transcriptTurnId || !body.specialty
      || !["queued", "processing", "available", "failed"].includes(body.status)) {
    return json(request, { error: "Complete delivery-analysis identity and status are required." }, { status: 400 });
  }
  await saveActivityDeliveryAnalysis(ownerId, body, Date.now());
  return json(request, { protocolVersion: VOICE_PROTOCOL_VERSION, analysisId: body.id, status: body.status }, { status: 201 });
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]) return match[1].trim();
  const encoded = (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((value) => value.trim())
    .find((value) => value.startsWith("ia-bearer."));
  if (!encoded) return "";
  try {
    const body = encoded.slice("ia-bearer.".length).replace(/-/g, "+").replace(/_/g, "/");
    return atob(body.padEnd(Math.ceil(body.length / 4) * 4, "="));
  } catch {
    return "";
  }
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const allowedOrigin = origin.startsWith("chrome-extension://") ? origin : "";
  return {
    ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin } : {}),
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function json(request: Request, body: unknown, init: ResponseInit = {}) {
  return Response.json(body, {
    ...init,
    headers: { ...corsHeaders(request), "cache-control": "no-store", ...init.headers },
  });
}

function normalizeLeetCodeUrl(value: string) {
  try {
    const url = new URL(value);
    const match = url.hostname.endsWith("leetcode.com") && url.pathname.match(/^\/problems\/([a-z0-9-]+)/i);
    return match ? `https://leetcode.com/problems/${match[1].toLowerCase()}/` : "";
  } catch {
    return "";
  }
}

function titleFromLeetCodeUrl(value: string) {
  const normalized = normalizeLeetCodeUrl(value);
  const slug = normalized.match(/\/problems\/([^/]+)/)?.[1] ?? "leetcode-problem";
  const acronyms: Record<string, string> = { lru: "LRU", bfs: "BFS", dfs: "DFS", sql: "SQL", xor: "XOR" };
  return slug.split("-").map((word) => acronyms[word] ?? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
}

async function companionState(ownerId: string, request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? dateInPracticeTimeZone();
  const problemUrl = normalizeLeetCodeUrl(url.searchParams.get("url") ?? "");
  const snapshot = await buildPracticeSnapshot(ownerId, date);
  const activeCodingActivity = snapshot.activeActivity?.type === "leetcode"
    ? snapshot.activeActivity
    : null;
  const focusedCodingActivity = (
    snapshot.focusedActivity?.type === "leetcode"
    && !snapshot.focusedActivity.timer?.completed
  )
    ? snapshot.focusedActivity
    : null;
  const currentActivity = problemUrl
    ? snapshot.activities.find((activity) => normalizeLeetCodeUrl(activity.url ?? "") === problemUrl) ?? null
    : activeCodingActivity ?? focusedCodingActivity;
  return json(request, { ...snapshot, currentActivity });
}

async function companionMutation(ownerId: string, request: Request, env: Env) {
  const body = (await request.json()) as {
    date?: string;
    url?: string;
    mutation?:
      | { type: "timer"; activityId: string; action: TimerAction }
      | { type: "outcome"; activityId: string; outcome: OutcomeValue | null }
      | { type: "publication-status"; activityId: string; status: PublicationStatusValue }
      | { type: "activity-note"; activityId: string; note: string }
      | { type: "problem-star"; specialty: "leetcode" | "system_design" | "behavioral"; questionId: string; starred: boolean }
      | { type: "add-leetcode"; url: string };
  };
  const date = body.date ?? dateInPracticeTimeZone();
  const problemUrl = normalizeLeetCodeUrl(body.url ?? "");
  const mutation = body.mutation;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !mutation) {
    return json(request, { error: "A valid date and mutation are required." }, { status: 400 });
  }
  const now = Date.now();
  if (mutation.type === "timer") {
    if (!mutation.activityId || !["start", "pause", "finish"].includes(mutation.action)) {
      return json(request, { error: "Invalid timer mutation." }, { status: 400 });
    }
    const snapshot = await buildPracticeSnapshot(ownerId, date);
    const activity = snapshot.activities.find((candidate) => candidate.id === mutation.activityId);
    const session = activity?.sessionId
      ? snapshot.sessions.find((candidate) => candidate.id === activity.sessionId)
      : undefined;
    if (mutation.action === "finish" && !activity?.timer?.startedAt) {
      return json(request, { error: "Start the activity stopwatch before finishing it." }, { status: 409 });
    }
    if (mutation.action === "finish") {
      const voiceGuard = await prepareVoiceCapturesForFinish(ownerId, mutation.activityId, now);
      const voiceConflict = voiceFinishGuardMessage(voiceGuard);
      if (voiceConflict) {
        return json(request, {
          error: voiceConflict,
        }, { status: 409 });
      }
    }
    if (mutation.action === "start" && session && !snapshot.sessionTimers[session.id]?.completed) {
      await applyTimerAction(ownerId, session.id, "session", "start", now, { activityIds: session.activityIds });
    }
    await applyTimerAction(ownerId, mutation.activityId, "activity", mutation.action, now, {
      sessionId: activity?.sessionId,
    });
    if (mutation.action === "finish") {
      if (activity?.outcome === "failed" || activity?.outcome === "solved_after_reviewing_approach") {
        await scheduleReview(ownerId, {
          activityId: mutation.activityId,
          questionId: activity.questionId,
          specialty: activity.type,
          completedDate: date,
          reason: activity.outcome === "failed" ? "failed" : "approach_review",
        }, now);
      } else if (activity?.outcome === "solved" && activity.reviewOfActivityId) {
        await scheduleReview(ownerId, {
          activityId: mutation.activityId,
          questionId: activity.questionId,
          specialty: activity.type,
          completedDate: date,
          reason: "successful_recall",
        }, now);
      } else {
        await clearActivityReviewSchedules(ownerId, mutation.activityId);
      }
    }
  } else if (mutation.type === "outcome") {
    const snapshot = await buildPracticeSnapshot(ownerId, date);
    const activity = snapshot.activities.find((candidate) => candidate.id === mutation.activityId);
    await setOutcome(ownerId, mutation.activityId, mutation.outcome, now);
    if (!activity?.timer?.completed) {
      await clearActivityReviewSchedules(ownerId, mutation.activityId);
    } else if (mutation.outcome === "failed" || mutation.outcome === "solved_after_reviewing_approach") {
      await scheduleReview(ownerId, {
        activityId: mutation.activityId,
        questionId: activity?.questionId,
        specialty: activity?.type ?? "leetcode",
        completedDate: date,
        reason: mutation.outcome === "failed" ? "failed" : "approach_review",
      }, now);
    } else if (mutation.outcome === "solved" && activity?.reviewOfActivityId) {
      await scheduleReview(ownerId, {
        activityId: mutation.activityId,
        questionId: activity.questionId,
        specialty: activity.type ?? "leetcode",
        completedDate: date,
        reason: "successful_recall",
      }, now);
    } else {
      await clearActivityReviewSchedules(ownerId, mutation.activityId);
    }
  } else if (mutation.type === "publication-status") {
    if (!["draft", "ready", "published"].includes(mutation.status)) {
      return json(request, { error: "Invalid publication status." }, { status: 400 });
    }
    await setPublicationStatus(ownerId, mutation.activityId, date, mutation.status, now);
  } else if (mutation.type === "activity-note") {
    if (mutation.note.length > 20_000) return json(request, { error: "Note is too long." }, { status: 400 });
    await setActivityNote(ownerId, mutation.activityId, date, mutation.note, now);
  } else if (mutation.type === "problem-star") {
    if (!mutation.questionId || !["leetcode", "system_design", "behavioral"].includes(mutation.specialty) || typeof mutation.starred !== "boolean") {
      return json(request, { error: "Invalid problem-star mutation." }, { status: 400 });
    }
    await setProblemStar(ownerId, mutation.specialty, mutation.questionId, mutation.starred, now);
  } else if (mutation.type === "add-leetcode") {
    const normalizedUrl = normalizeLeetCodeUrl(mutation.url);
    if (!normalizedUrl) return json(request, { error: "A public LeetCode problem URL is required." }, { status: 400 });
    const content = await loadContentIndex();
    const known = content.questionBanks.leetcode.find(
      (question) => normalizeLeetCodeUrl(question.url ?? "") === normalizedUrl,
    );
    const id = `${date}-extra-${normalizedUrl.match(/\/problems\/([^/]+)/)?.[1] ?? "leetcode"}-${now.toString(36)}`;
    await upsertExtraActivity(ownerId, {
      schemaVersion: 2,
      id,
      ...(known?.id ? { questionId: known.id } : {}),
      date,
      source: "extra",
      type: "leetcode",
      recordKind: "attempt",
      title: known?.title ?? titleFromLeetCodeUrl(normalizedUrl),
      url: normalizedUrl,
      allocatedSeconds: (known?.targetMinutes ?? 30) * 60,
      timerGroupId: id,
      timingSource: "website",
      status: "planned",
      ...(known?.topics.length ? { notes: known.topics.join(", ") } : {}),
    }, now);
  }
  const responseUrl = new URL("/companion/state", request.url);
  responseUrl.searchParams.set("date", date);
  if (problemUrl) responseUrl.searchParams.set("url", problemUrl);
  await publishOwnerLiveUpdate(
    env.LIVE_UPDATES,
    ownerId,
    mutation.type === "timer" ? "timer" : "practice",
  );
  return companionState(ownerId, new Request(responseUrl, {
    headers: request.headers,
  }));
}

async function decodeInternalResponse(response: Response) {
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new SpecialistControlError(
      typeof payload.code === "string" ? payload.code : `http_${response.status}`,
      typeof payload.error === "string" ? payload.error : "The authoritative Interview Arc mutation failed.",
    );
  }
  return payload;
}

async function prepareSpecialistMutation(
  ownerId: string,
  input: {
    operation: string;
    mutationId: string;
    expectedWorkbenchId: string;
  } & Record<string, unknown>,
) {
  const requestHash = await planningRequestFingerprint(input);
  const receipt = await readPlanningMutation(ownerId, input.mutationId);
  const date = dateInPracticeTimeZone();
  if (receipt) {
    if (receipt.requestHash !== requestHash) {
      throw new SpecialistControlError(
        "specialist_mutation_identity_conflict",
        "That mutation identifier was already used for different content.",
      );
    }
    return {
      date,
      duplicate: true as const,
      requestHash,
      priorResponse: receipt.response,
      state: await readLiveState(ownerId, date),
    };
  }
  const state = await readLiveState(ownerId, date);
  if (!state.workbench || state.workbench.id !== input.expectedWorkbenchId) {
    throw new SpecialistControlError(
      "stale_workbench",
      "Today changed in another surface. Read Today again before retrying the command.",
    );
  }
  return {
    date,
    duplicate: false as const,
    requestHash,
    priorResponse: null,
    state,
  };
}

async function rememberSpecialistMutation(
  ownerId: string,
  input: { mutationId: string; expectedWorkbenchId: string },
  requestHash: string,
  response: Record<string, unknown>,
) {
  await rememberPlanningMutation(ownerId, {
    mutationId: input.mutationId,
    workbenchId: input.expectedWorkbenchId,
    requestHash,
    response,
    createdAt: Date.now(),
  });
}

function specialistControlDependencies(ownerId: string, date: string): {
  timer: PracticeTimerControlDependencies;
  result: PracticeResultControlDependencies;
  workbench: PracticeWorkbenchControlDependencies;
} {
  const scheduleCompletedActivity = (
    activity: Parameters<typeof scheduleCompletedVoiceActivity>[1],
    outcome: OutcomeValue,
    now: number,
  ) => scheduleCompletedVoiceActivity(ownerId, activity, outcome, date, now);

  return {
    timer: {
      now: Date.now,
      applyTimerAction: async (subjectId, kind, action, now, options) => {
        await applyTimerAction(ownerId, subjectId, kind, action, now, options);
      },
      prepareVoiceCapturesForFinish: (activityId, now) => (
        prepareVoiceCapturesForFinish(ownerId, activityId, now)
      ),
      voiceFinishGuardMessage: (guard) => voiceFinishGuardMessage(
        guard as Awaited<ReturnType<typeof prepareVoiceCapturesForFinish>>,
      ),
      finishAndAdvancePracticeActivity: (control) => (
        finishAndAdvancePracticeActivity({ ownerId, ...control })
      ),
      startSessionPracticeActivity: (control) => (
        startSessionPracticeActivity({ ownerId, ...control })
      ),
      controlSessionPracticeTimer: (control) => (
        controlSessionPracticeTimer({ ownerId, ...control })
      ),
      scheduleCompletedActivity,
    },
    result: {
      now: Date.now,
      setPracticeResultAtomic: (control) => setPracticeResultAtomic({ ownerId, ...control }),
    },
    workbench: {
      now: Date.now,
      newWorkbenchId: () => `workbench-${date}-${crypto.randomUUID()}`,
      startFreshPracticeWorkbench: (control) => startFreshPracticeWorkbench({ ownerId, ...control }),
    },
  };
}

function specialistToolFailure(error: unknown) {
  if (
    error instanceof SpecialistControlError
    || error instanceof PlanningSelectionError
    || error instanceof TodayPlanningConflictError
    || error instanceof TimerStateConflictError
  ) {
    const code = "code" in error && typeof error.code === "string"
      ? error.code
      : error instanceof TimerStateConflictError
        ? "timer_state_conflict"
        : "specialist_control_conflict";
    return {
      isError: true,
      content: [{ type: "text" as const, text: error.message }],
      structuredContent: { error: error.message, code, retryable: false },
    };
  }
  throw error;
}

type SpecialistTimerMutationInput = {
  expectedWorkbenchId: string;
  mutationId: string;
};

async function runSpecialistTimerMutation<TInput extends SpecialistTimerMutationInput>(
  ownerId: string,
  env: Env,
  operation: string,
  input: TInput,
  mutate: (
    state: LiveState,
    requestHash: string,
    dependencies: PracticeTimerControlDependencies,
  ) => Promise<{ result: Record<string, unknown>; receiptStored: boolean }>,
) {
  try {
    const prepared = await prepareSpecialistMutation(ownerId, { operation, ...input });
    if (prepared.duplicate) {
      const authoritative = await authoritativeSpecialistState(ownerId, prepared.date);
      const payload = { duplicate: true, result: prepared.priorResponse, authoritative };
      return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    }
    const dependencies = specialistControlDependencies(ownerId, prepared.date).timer;
    const { result, receiptStored } = await mutate(prepared.state, prepared.requestHash, dependencies);
    if (!receiptStored) {
      await rememberSpecialistMutation(ownerId, input, prepared.requestHash, result);
    }
    await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "timer");
    const authoritative = await authoritativeSpecialistState(ownerId, prepared.date);
    const payload = { duplicate: false, result, authoritative };
    return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
  } catch (error) {
    return specialistToolFailure(error);
  }
}

const specialistCatalogSchema = z.object({
  specialty: z.enum(planningSpecialties),
  search: z.string().max(500).optional(),
  questionId: z.string().min(1).max(500).optional(),
  title: z.string().min(1).max(500).optional(),
  starredOnly: z.boolean().optional(),
  difficulty: z.array(z.enum(["easy", "medium", "hard"])).max(3).optional(),
  attention: z.array(z.enum(["due", "needs_review", "solved", "helped", "failed", "todo"])).max(6).optional(),
  sort: z.enum(["frequency", "recent", "acceptance"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

type SpecialistCatalogInput = z.infer<typeof specialistCatalogSchema>;

function specialistPlanningRequest(input: SpecialistCatalogInput) {
  const url = new URL("https://interview-arc.local/voice/planning");
  url.searchParams.set("specialty", input.specialty);
  const search = input.questionId ?? input.title ?? input.search;
  if (search) url.searchParams.set("search", search);
  if (input.starredOnly) url.searchParams.set("starred", "true");
  if (input.difficulty?.length) url.searchParams.set("difficulty", input.difficulty.join(","));
  if (input.attention?.length) url.searchParams.set("attention", input.attention.join(","));
  if (input.sort) url.searchParams.set("sort", input.sort);
  if (input.direction) url.searchParams.set("direction", input.direction);
  if (input.page) url.searchParams.set("page", String(input.page));
  if (input.pageSize) url.searchParams.set("pageSize", String(input.pageSize));
  return new Request(url);
}

async function specialistCatalog(
  ownerId: string,
  input: SpecialistCatalogInput,
  context?: PlanningDataContext,
) {
  const payload = await decodeInternalResponse(
    await planningData(ownerId, specialistPlanningRequest(input), context),
  );
  const catalog = payload.catalog as { items?: unknown[] } | undefined;
  if (input.questionId || input.title) {
    const expected = (input.questionId ?? input.title ?? "").normalize("NFKC").toLowerCase();
    const exact = (catalog?.items ?? []).filter((candidate) => {
      const item = candidate as { id?: unknown; title?: unknown };
      const value = input.questionId ? item.id : item.title;
      return typeof value === "string" && value.normalize("NFKC").toLowerCase() === expected;
    });
    if (exact.length !== 1) {
      throw new SpecialistControlError(
        "catalog_question_not_found",
        `No authoritative ${input.specialty} question matched the requested ${input.questionId ? "ID" : "title"}.`,
      );
    }
    payload.catalog = { ...catalog, items: exact, total: 1, hasMore: false };
  }
  return payload;
}

function planningSelectionFromCatalogItem(
  specialty: PlanningSpecialty,
  candidate: unknown,
): PlanningSelection {
  const item = candidate as {
    id?: unknown;
    title?: unknown;
    url?: unknown;
    prompt?: unknown;
    targetMinutes?: unknown;
    topics?: unknown;
    eligible?: unknown;
    disabledReason?: unknown;
  };
  if (item.eligible !== true) {
    throw new SpecialistControlError(
      "practice_question_ineligible",
      typeof item.disabledReason === "string" ? item.disabledReason : "That question is not eligible for Today.",
    );
  }
  if (typeof item.id !== "string" || typeof item.title !== "string" || typeof item.targetMinutes !== "number") {
    throw new SpecialistControlError("invalid_catalog_item", "The authoritative catalog returned an incomplete question.");
  }
  return {
    kind: "practice",
    specialty,
    questionId: item.id,
    title: item.title,
    ...(typeof item.url === "string" ? { url: item.url } : {}),
    ...(typeof item.prompt === "string" ? { prompt: item.prompt } : {}),
    minutes: item.targetMinutes,
    ...(Array.isArray(item.topics) ? { topics: item.topics.map(String) } : {}),
  };
}

async function authoritativeSpecialistState(ownerId: string, date?: string) {
  const [snapshot, timerInstrument] = await Promise.all([
    buildPracticeSnapshot(ownerId, date),
    readVoiceTimerInstrument(ownerId),
  ]);
  return { snapshot, timerInstrument };
}

function createServer(ownerId: string, env: Env) {
  const server = new McpServer({ name: "Interview Arc", version: "1.0.0" });

  server.registerTool(
    "save_practice_exchange",
    {
      description: "Atomically save one related typed user question and its canonical specialist response to the focused activity. Use stable turn IDs; an exact retry is idempotent and changed content is rejected.",
      inputSchema: {
        activityId: z.string().min(1),
        activityTitle: z.string().min(1).max(500),
        specialty: z.enum(["leetcode", "system_design", "behavioral"]),
        userTurn: z.object({
          turnId: z.string().min(1),
          body: z.string().min(1).max(100_000),
          occurredAt: z.number().int().positive(),
        }),
        specialistTurn: z.object({
          turnId: z.string().min(1),
          body: z.string().min(1).max(100_000),
          occurredAt: z.number().int().positive(),
        }),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ activityId, activityTitle, specialty, userTurn, specialistTurn }) => {
      const saved = await saveTypedPracticeExchange(ownerId, {
        activityId,
        specialty,
        userTurn,
        specialistTurn,
      }, Date.now());
      const receipt = typedExchangeReceipt(activityTitle);
      return {
        content: [{ type: "text", text: receipt }],
        structuredContent: {
          activityId,
          userTurnId: saved.userTurn.turnId,
          responseTurnId: saved.specialistTurn.turnId,
          duplicate: saved.duplicate,
          receipt,
        },
      };
    },
  );

  server.registerTool(
    "resolve_voice_capture_and_save_response",
    {
      description: "Atomically classify one protocol-v2 Voice envelope as activity-related and reserve exactly one canonical specialist response linked by replyToTurnId. The response remains provisional until Voice delivers the user transcript.",
      inputSchema: {
        captureId: z.string().min(1),
        activityId: z.string().min(1),
        activityTitle: z.string().min(1).max(500),
        userTurnId: z.string().min(1),
        responseTurnId: z.string().min(1),
        specialty: z.enum(["leetcode", "system_design", "behavioral"]),
        responseBody: z.string().min(1).max(100_000),
        responseOccurredAt: z.number().int().positive(),
        reason: z.string().min(1).max(2_000),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({
      captureId,
      activityId,
      activityTitle,
      userTurnId,
      responseTurnId,
      specialty,
      responseBody,
      responseOccurredAt,
      reason,
    }) => {
      const saved = await resolveVoiceCaptureAndSaveResponse(ownerId, {
        captureId,
        activityId,
        userTurnId,
        responseTurnId,
        specialty,
        responseBody,
        responseOccurredAt,
        reason,
      }, Date.now());
      await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "voice_intent");
      const receipt = voiceDecisionReceipt(saved.duplicate ? "duplicate" : "activity_related", activityTitle);
      return {
        content: [{ type: "text", text: receipt }],
        structuredContent: {
          captureId,
          activityId,
          userTurnId,
          responseTurnId,
          status: saved.intent?.status ?? "deferred",
          duplicate: saved.duplicate,
          receipt,
        },
      };
    },
  );

  server.registerTool(
    "resolve_voice_captures_and_save_response",
    {
      description: "Atomically classify 2–20 ordered protocol-v2 Voice envelopes as one logical answer and reserve exactly one canonical specialist response. Each capture keeps its own transcript/audio identity; the response materializes once after every ordered transcript arrives.",
      inputSchema: voiceCaptureBatchInputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        const result = await resolveVoiceCaptureBatch(input, async (reservation) => {
          const saved = await resolveVoiceCaptureBatchAndSaveResponse(ownerId, reservation, Date.now());
          await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "voice_intent");
          return { duplicate: saved.duplicate, status: saved.group.status };
        });
        return {
          content: [{ type: "text", text: result.receipt }],
          structuredContent: result,
        };
      } catch (error) {
        return specialistToolFailure(error);
      }
    },
  );

  server.registerTool(
    "append_practice_transcript",
    {
      description: "Append activity-scoped user/specialist transcript turns to the durable D1 draft. Exclude unrelated task, website, or administration conversation.",
      inputSchema: {
        activityId: z.string().min(1),
        specialty: z.enum(["leetcode", "system_design", "behavioral"]),
        turns: z.array(z.object({
          turnId: z.string().min(1),
          speaker: z.enum(["user", "specialist"]),
          body: z.string().min(1).max(100_000),
          source: z.enum(["codex", "dictation", "audio_transcript"]).optional(),
          sequence: z.number().int().nonnegative(),
          occurredAt: z.number().int().positive(),
        })).min(1).max(50),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ activityId, specialty, turns }) => {
      await appendTranscriptTurns(ownerId, activityId, specialty, turns, Date.now());
      return {
        content: [{ type: "text", text: `Saved ${turns.length} transcript turn${turns.length === 1 ? "" : "s"} for ${activityId}.` }],
        structuredContent: { activityId, saved: turns.length },
      };
    },
  );

  server.registerTool(
    "resolve_voice_capture",
    {
      description: "Classify one protocol-v2 Voice turn as unrelated or uncertain. Related turns with a specialist answer must use resolve_voice_capture_and_save_response so the decision and response cannot drift.",
      inputSchema: {
        captureId: z.string().min(1),
        activityId: z.string().min(1),
        turnId: z.string().min(1),
        decision: z.enum(["unrelated", "uncertain"]),
        reason: z.string().min(1).max(2_000),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ captureId, activityId, turnId, decision, reason }) => {
      const intent = await resolveVoiceCaptureIntent(
        ownerId,
        captureId,
        decision,
        "specialist",
        reason,
        Date.now(),
        { activityId, turnId },
      );
      await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "voice_intent");
      const receipt = voiceDecisionReceipt(decision, activityId);
      return {
        content: [{ type: "text", text: receipt }],
        structuredContent: { captureId, activityId, turnId, decision, status: intent?.status, receipt },
      };
    },
  );

  server.registerTool(
    "delete_related_voice_capture",
    {
      description: "Permanently delete one exact misclassified related Voice capture after explicit user instruction. Requires the registered capture/activity/turn identity and removes the fenced D1 transcript/response/audio/analysis graph. Pending captures must be classified as unrelated instead.",
      inputSchema: voiceCaptureRemediationInputSchema.shape,
      annotations: voiceCaptureRemediationAnnotations,
    },
    async (input) => {
      try {
        const result = await remediateRelatedVoiceCapture(input, {
          readIntent: (captureId) => readVoiceCaptureIntent(ownerId, captureId),
          deleteCapture: async (captureId, reason) => {
            return await decodeInternalResponse(await deleteVoiceCaptureGraph(
              ownerId,
              new Request("https://interview-arc.local/voice/captures/" + encodeURIComponent(captureId), {
                method: "DELETE",
              }),
              env,
              captureId,
              { source: "specialist-mcp", reason },
            ));
          },
        });
        return {
          content: [{ type: "text", text: result.receipt }],
          structuredContent: result,
        };
      } catch (error) {
        return specialistToolFailure(error);
      }
    },
  );

  server.registerTool(
    "save_leetcode_code_attempt",
    {
      description: "Save an exact owner-provided LeetCode attempt after an explicit attempt boundary. Use a pending review while evaluation runs, then complete that same immutable attempt from the visible specialist review. Ordinary snippets and generated reference solutions must not use this tool.",
      inputSchema: {
        id: z.string().min(1),
        activityId: z.string().min(1),
        originatingTurnId: z.string().min(1),
        sequence: z.number().int().positive(),
        language: z.string().min(1).max(40),
        code: z.string().min(1).max(300_000),
        occurredAt: z.number().int().positive(),
        review: codeAttemptReviewInputSchema,
        reviewResponseTurnId: z.string().min(1).optional(),
        observedCorrectness: z.enum(["not_verified", "appears_correct", "issues_found", "incomplete"]),
        concreteFindings: z.array(z.string().max(2_000)).max(100),
        edgeCases: z.array(z.string().max(2_000)).max(100),
        complexity: z.object({ time: z.string().optional(), space: z.string().optional() }).optional(),
        finalDeclaration: z.string().min(1).max(2_000),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      const saved = await saveLeetCodeCodeAttempt(ownerId, input, Date.now());
      const lineCount = codeLineCount(input.code);
      return {
        content: [{ type: "text", text: `Saved Code Attempt ${input.sequence} · ${input.language} · ${lineCount} lines.` }],
        structuredContent: {
          id: input.id,
          activityId: input.activityId,
          sequence: input.sequence,
          language: input.language,
          lineCount,
          status: saved.status,
          reviewStatus: saved.reviewStatus,
        },
      };
    },
  );

  server.registerTool(
    "add_practice_note",
    {
      description: "Save an exact, pinned note for any LeetCode, system-design, or behavioral activity.",
      inputSchema: {
        activityId: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        body: z.string().min(1).max(20_000),
        kind: z.enum(["remember", "insight", "mistake", "pattern", "question"]).optional(),
        noteId: z.string().min(1).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ activityId, date, body, kind, noteId }) => {
      const now = Date.now();
      const id = noteId ?? `${activityId}-note-${now.toString(36)}`;
      await addPracticeNote(ownerId, { id, activityId, date, body, kind, pinned: true }, now);
      return {
        content: [{ type: "text", text: `Pinned note saved for ${activityId}.` }],
        structuredContent: { id, activityId, date, body, kind: kind ?? "remember", pinned: true },
      };
    },
  );

  server.registerTool(
    "save_specialist_finalization",
    {
      description: "Save a specialist finalization bundle in D1. This does not publish Git artifacts, open a PR, or deploy.",
      inputSchema: z.object({
        activityId: z.string().min(1),
        specialty: z.enum(["leetcode", "system_design", "behavioral"]),
        questionId: z.string().min(1).optional(),
        finalization: z.object({
          title: z.string().min(1),
          complete: z.boolean(),
          summary: z.string().optional(),
          transcriptScope: z.enum(["full_activity", "activity_exchanges", "none_observed"]),
          review: z.object({
            didWell: z.array(z.string()),
            improve: z.array(z.string()),
          }),
          modelAnswer: z.string().min(1),
          solution: z.string().optional(),
          improvedAnswer: z.string().optional(),
          complexity: z.object({ time: z.string().optional(), space: z.string().optional() }).optional(),
          alternatives: z.array(z.object({
            title: z.string(),
            summary: z.string(),
            time: z.string().optional(),
            space: z.string().optional(),
          })).max(2).optional(),
          edgeCases: z.array(z.string()).optional(),
          references: z.array(z.object({
            title: z.string().min(1),
            url: z.string().url(),
            accessedAt: z.string().min(1),
          })),
          questionMetadata: leetCodeQuestionMetadataSchema.optional(),
          solutionProfileAction: z.enum(["create_or_revise", "reuse_current"]).optional(),
          solutionProfileDecision: z.object({
            reason: z.string().min(1),
            changedSections: z.array(z.string()),
            researchPerformed: z.boolean(),
            sourcesChecked: z.array(z.string()),
          }).optional(),
          solutionProfile: z.object({
            schemaVersion: z.literal(1),
            summary: z.string().min(1),
            sections: z.array(z.object({ title: z.string().min(1), body: z.string().min(1) })).min(1),
            tags: z.array(z.string().min(1)).max(32),
            references: z.array(z.object({ title: z.string().min(1), url: z.string().url(), accessedAt: z.string().min(1) })),
            behavioralAnswer: z.object({
              preferred: z.object({
                label: z.string().min(1),
                answer: z.string().min(1),
                evidence: z.array(z.string()),
                evidenceGaps: z.array(z.string()),
              }),
              alternatives: z.array(z.object({
                label: z.string().min(1),
                answer: z.string().min(1),
                whenToUse: z.string().optional(),
                evidence: z.array(z.string()),
                evidenceGaps: z.array(z.string()),
              })).max(5),
            }).optional(),
          }).optional(),
        }),
      }).superRefine((input, context) => {
        if (input.specialty !== "leetcode" && input.finalization.questionMetadata) {
          context.addIssue({
            code: "custom",
            path: ["finalization", "questionMetadata"],
            message: "questionMetadata is supported only for LeetCode finalizations.",
          });
        }
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ activityId, specialty, questionId, finalization }) => {
      await saveSpecialistFinalization(ownerId, activityId, specialty, questionId ?? null, finalization, Date.now());
      return {
        content: [{ type: "text", text: `${activityId} specialist bundle saved as ${finalization.complete ? "ready" : "draft"}.` }],
        structuredContent: { activityId, specialty, status: finalization.complete ? "ready" : "draft" },
      };
    },
  );

  server.registerTool(
    "save_provisional_solution_profile",
    {
      description: "Save a reusable reference-preflight profile before an attempt is finalized. Use only when no current or provisional profile exists; this prepares later attempts without creating a numbered revision.",
      inputSchema: {
        activityId: z.string().min(1).optional(),
        specialty: z.enum(["leetcode", "system_design", "behavioral"]),
        questionId: z.string().min(1),
        title: z.string().min(1),
        decision: z.object({
          reason: z.string().min(1),
          changedSections: z.array(z.string()),
          researchPerformed: z.boolean(),
          sourcesChecked: z.array(z.string()),
        }).optional(),
        profile: z.object({
          schemaVersion: z.literal(1),
          summary: z.string().min(1),
          sections: z.array(z.object({ title: z.string().min(1), body: z.string().min(1) })).min(1),
          tags: z.array(z.string().min(1)).max(32),
          references: z.array(z.object({ title: z.string().min(1), url: z.string().url(), accessedAt: z.string().min(1) })),
          behavioralAnswer: z.object({
            preferred: z.object({
              label: z.string().min(1),
              answer: z.string().min(1),
              evidence: z.array(z.string()),
              evidenceGaps: z.array(z.string()),
            }),
            alternatives: z.array(z.object({
              label: z.string().min(1),
              answer: z.string().min(1),
              whenToUse: z.string().optional(),
              evidence: z.array(z.string()),
              evidenceGaps: z.array(z.string()),
            })).max(5),
          }).optional(),
        }),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ activityId, specialty, questionId, title, decision, profile }) => {
      await saveProvisionalSolutionProfile(
        ownerId,
        specialty,
        questionId,
        title,
        profile,
        { activityId, decision, references: profile.references },
        Date.now(),
      );
      return {
        content: [{ type: "text", text: `Prepared a provisional Solution Profile for ${specialty}:${questionId}.` }],
        structuredContent: { specialty, questionId, status: "provisional" },
      };
    },
  );

  server.registerTool(
    "get_problem_solution_profile",
    {
      description: "Load the current, provisional, and immutable Solution Profile history for a stable bank question. Every specialist calls this after resolving questionId and before preparing a first attempt or revisit.",
      inputSchema: {
        specialty: z.enum(["leetcode", "system_design", "behavioral"]),
        questionId: z.string().min(1),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ specialty, questionId }) => {
      const result = await readProblemSolutionProfile(ownerId, specialty, questionId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { specialty, questionId, ...result },
      };
    },
  );

  server.registerTool(
    "get_activity_practice_record",
    {
      description: "Read one activity's ordered transcript, pinned notes, specialist finalization, review schedule, and audio metadata.",
      inputSchema: { activityId: z.string().min(1) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ activityId }) => {
      const record = await readActivityPracticeRecord(ownerId, activityId);
      return {
        content: [{ type: "text", text: JSON.stringify(record, null, 2) }],
        structuredContent: { activityId, ...record },
      };
    },
  );

  server.registerTool(
    "upsert_personal_bank_question",
    {
      description: "Create or update an owner-private bank question. Behavioral specialists use this to build the resume-foundation curriculum without committing private resume details to Git.",
      inputSchema: {
        specialty: z.enum(["leetcode", "system_design", "behavioral"]),
        questionId: z.string().min(1),
        title: z.string().min(1),
        prompt: z.string().optional(),
        url: z.string().url().optional(),
        source: z.string().min(1).optional(),
        tags: z.array(z.string().min(1)).max(32).optional(),
        priority: z.number().int().min(0).max(1000).optional(),
        targetMinutes: z.number().int().min(5).max(480).optional(),
        active: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ specialty, ...question }) => {
      await upsertOwnerBankQuestion(ownerId, specialty, question, Date.now());
      return {
        content: [{ type: "text", text: `Saved ${question.title} to the private ${specialty} bank.` }],
        structuredContent: { specialty, ...question },
      };
    },
  );

  server.registerTool(
    "schedule_practice_review",
    {
      description: "Schedule spaced review for any activity. Failed/full-walkthrough defaults to 4 days; approach review to 7; successful recalls advance to 21 then 60 days.",
      inputSchema: {
        activityId: z.string().min(1),
        questionId: z.string().min(1).optional(),
        specialty: z.enum(["leetcode", "system_design", "behavioral"]),
        completedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        reason: z.enum(["failed", "full_walkthrough", "approach_review", "manual", "successful_recall"]),
        intervalDays: z.number().int().min(1).max(365).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      await scheduleReview(ownerId, input, Date.now());
      return {
        content: [{ type: "text", text: `Review scheduled for ${input.activityId}.` }],
        structuredContent: input,
      };
    },
  );

  server.registerTool(
    "register_specialist_task",
    {
      description: "Register the stable Codex task ID for one specialist so the coordinator can reuse it without asking the user for IDs.",
      inputSchema: {
        specialty: z.enum(["leetcode", "system_design", "behavioral"]),
        threadId: z.string().min(1),
        hostId: z.string().min(1).optional(),
        title: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      await registerSpecialistTask(ownerId, input, Date.now());
      return {
        content: [{ type: "text", text: `Registered ${input.specialty} specialist task.` }],
        structuredContent: input,
      };
    },
  );

  server.registerTool(
    "get_specialist_tasks",
    {
      description: "Read the durable specialist task registry used by the coordinator.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const tasks = await readSpecialistTasks(ownerId);
      return {
        content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }],
        structuredContent: { tasks },
      };
    },
  );

  server.registerTool(
    "register_activity_audio_clip",
    {
      description: "Attach local-only or privately stored audio metadata to a practice activity and, when known, one existing user transcript turn. Raw audio is never placed in Git.",
      inputSchema: {
        activityId: z.string().min(1),
        transcriptTurnId: z.string().min(1).optional(),
        clipId: z.string().min(1),
        filename: z.string().min(1),
        mimeType: z.string().min(1),
        label: z.string().min(1).optional(),
        durationSeconds: z.number().int().nonnegative().optional(),
        status: z.enum(["local_only", "uploading", "available", "failed"]).optional(),
        objectKey: z.string().min(1).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ clipId, ...input }) => {
      await registerActivityAudioClip(ownerId, { id: clipId, ...input }, Date.now());
      return {
        content: [{ type: "text", text: `Registered audio metadata for ${input.activityId}.` }],
        structuredContent: { clipId, ...input, status: input.status ?? "local_only" },
      };
    },
  );

  server.registerTool(
    "save_delivery_analysis",
    {
      description: "Create or update the private, activity-scoped delivery-coaching result for one recorded user answer. Report observable speech evidence only; never infer mental state or sensitive traits.",
      inputSchema: {
        analysisId: z.string().min(1),
        activityId: z.string().min(1),
        audioClipId: z.string().min(1),
        transcriptTurnId: z.string().min(1),
        specialty: z.enum(["leetcode", "system_design", "behavioral"]),
        status: z.enum(["queued", "processing", "available", "failed"]),
        payload: z.object({
          schemaVersion: z.literal(1),
          summary: z.string().min(1),
          durationSeconds: z.number().nonnegative().optional(),
          wordsPerMinute: z.number().nonnegative().optional(),
          fillerWords: z.array(z.object({ word: z.string().min(1), count: z.number().int().nonnegative() })).optional(),
          longPauses: z.array(z.object({ startSeconds: z.number().nonnegative(), durationSeconds: z.number().nonnegative() })).optional(),
          strengths: z.array(z.string()),
          improvements: z.array(z.string()),
          observations: z.array(z.object({
            dimension: z.enum(["pace", "pauses", "fillers", "clarity", "organization", "vocal_variation", "perceived_confidence"]),
            evidence: z.string().min(1),
            coaching: z.string().min(1),
          })),
        }).optional(),
        error: z.string().max(2_000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ analysisId, ...input }) => {
      await saveActivityDeliveryAnalysis(ownerId, { id: analysisId, ...input }, Date.now());
      return {
        content: [{ type: "text", text: `Saved ${input.status} delivery analysis for ${input.activityId}.` }],
        structuredContent: { analysisId, activityId: input.activityId, status: input.status },
      };
    },
  );

  server.registerTool(
    "query_practice_catalog",
    {
      description: "Query the authenticated owner's authoritative practice catalog by specialty, exact public question ID or title, search, star, review/result state, difficulty, and sort order. This is read-only and returns the current workbench identity needed by mutation tools.",
      inputSchema: specialistCatalogSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        const payload = await specialistCatalog(ownerId, input);
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
        };
      } catch (error) {
        return specialistToolFailure(error);
      }
    },
  );

  server.registerTool(
    "plan_today_practice",
    {
      description: "Add an exact authoritative question selection to Today or create one exact-count filtered practice session. Requires the current workbench ID and a stable mutation ID. Filtered sessions never silently relax criteria.",
      inputSchema: {
        mode: z.enum(["exact_selection", "filtered_session"]),
        expectedWorkbenchId: z.string().min(1),
        mutationId: z.string().min(1).max(120),
        destination: z.enum(["standalone", "session"]).optional(),
        selections: z.array(z.object({
          specialty: z.enum(planningSpecialties),
          questionId: z.string().min(1),
        })).min(1).max(30).optional(),
        specialty: z.enum(planningSpecialties).optional(),
        count: z.number().int().min(1).max(30).optional(),
        search: z.string().max(500).optional(),
        starredOnly: z.boolean().optional(),
        difficulty: z.array(z.enum(["easy", "medium", "hard"])).max(3).optional(),
        attention: z.array(z.enum(["due", "needs_review", "solved", "helped", "failed", "todo"])).max(6).optional(),
        sort: z.enum(["frequency", "recent", "acceptance"]).optional(),
        direction: z.enum(["asc", "desc"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        const date = dateInPracticeTimeZone();
        const specialistRequestHash = await planningRequestFingerprint({
          operation: "plan_today_practice",
          practiceDate: date,
          ...input,
        });
        const priorReceipt = await readPlanningMutation(ownerId, input.mutationId);
        const replay = priorReceipt
          ? specialistPlanningReplay(priorReceipt, specialistRequestHash, {
            expectedWorkbenchId: input.expectedWorkbenchId,
            practiceDate: date,
            receiptPracticeDate: dateInPracticeTimeZone(new Date(priorReceipt.createdAt)),
          })
          : null;
        if (replay) {
          const authoritative = await authoritativeSpecialistState(ownerId);
          const payload = { duplicate: true, result: replay, authoritative };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
            structuredContent: payload,
          };
        }
        let selections: PlanningSelection[];
        let destination: "standalone" | "session";
        if (input.mode === "exact_selection") {
          if (!input.selections?.length) {
            throw new SpecialistControlError("selection_required", "Exact planning requires at least one specialty and question ID.");
          }
          const uniqueSelections = new Set(
            input.selections.map((selection) => `${selection.specialty}:${selection.questionId}`),
          );
          if (uniqueSelections.size !== input.selections.length) {
            throw new SpecialistControlError(
              "duplicate_selection",
              "Each specialty and question ID may appear only once in one planning mutation.",
            );
          }
          destination = input.destination ?? "standalone";
          const [content, state] = await Promise.all([
            loadContentIndex(),
            readLiveState(ownerId, date),
          ]);
          const context = { date, content, state };
          selections = await Promise.all(input.selections.map(async (selection) => {
            const payload = await specialistCatalog(ownerId, {
              specialty: selection.specialty,
              questionId: selection.questionId,
              pageSize: 100,
            }, context);
            const item = (payload.catalog as { items: unknown[] }).items[0];
            return planningSelectionFromCatalogItem(selection.specialty, item);
          }));
        } else {
          if (!input.specialty || !input.count) {
            throw new SpecialistControlError("filtered_session_required", "Filtered session planning requires a specialty and exact count.");
          }
          destination = "session";
          const items: unknown[] = [];
          let page = 1;
          let hasMore = true;
          const [content, state] = await Promise.all([
            loadContentIndex(),
            readLiveState(ownerId, date),
          ]);
          const context = { date, content, state };
          while (hasMore) {
            const payload = await specialistCatalog(ownerId, {
              specialty: input.specialty,
              search: input.search,
              starredOnly: input.starredOnly,
              difficulty: input.difficulty,
              attention: input.attention,
              sort: input.sort,
              direction: input.direction,
              page,
              pageSize: 100,
            }, context);
            const catalog = payload.catalog as { items: unknown[]; hasMore: boolean };
            items.push(...catalog.items);
            hasMore = catalog.hasMore;
            page += 1;
          }
          const blocked = new Set(items.flatMap((candidate) => {
            const item = candidate as { id?: unknown; eligible?: unknown };
            return item.eligible === false && typeof item.id === "string" ? [item.id] : [];
          }));
          const chosen = selectExactPlanningQuestions(items as never[], {
            count: input.count,
            blockedQuestionIds: blocked,
            sort: input.sort,
            direction: input.direction,
            levels: input.difficulty?.length ? new Set(input.difficulty) : undefined,
          });
          selections = chosen.map((item) => planningSelectionFromCatalogItem(input.specialty!, item));
        }
        const response = await voicePlanningMutation(ownerId, new Request(
          "https://interview-arc.local/voice/planning/mutations",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              type: "add_selection",
              mutationId: input.mutationId,
              workbenchId: input.expectedWorkbenchId,
              destination,
              selections,
              specialistRequestHash,
            }),
          },
        ), env, priorReceipt);
        const result = await decodeInternalResponse(response);
        const authoritative = await authoritativeSpecialistState(ownerId);
        const payload = { ...result, authoritative };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
        };
      } catch (error) {
        return specialistToolFailure(error);
      }
    },
  );

  server.registerTool(
    "control_practice_timer",
    {
      description: "Execute an explicitly requested authoritative practice-timer command. Supports start, pause, resume, finish, and guarded finish-and-advance. Requires current workbench/timer revisions plus a stable mutation ID; exact retries are idempotent.",
      inputSchema: {
        expectedWorkbenchId: z.string().min(1),
        mutationId: z.string().min(1).max(120),
        activityId: z.string().min(1),
        expectedRevision: z.number().int().nonnegative(),
        action: z.enum(["start", "pause", "resume", "finish", "finish_and_advance"]),
        nextActivityId: z.string().min(1).optional(),
        expectedNextRevision: z.number().int().nonnegative().optional(),
        authorization: z.literal("explicit_user_instruction"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => runSpecialistTimerMutation(
      ownerId,
      env,
      "control_practice_timer",
      input,
      (state, requestHash, dependencies) => controlPracticeTimer(
        state,
        input,
        requestHash,
        dependencies,
      ),
    ),
  );

  server.registerTool(
    "control_practice_session_timer",
    {
      description: "Execute an explicitly requested authoritative session-countdown command. Supports start, pause, resume, and finish. Requires the current workbench and session timer revisions plus a stable mutation ID; exact retries are idempotent.",
      inputSchema: {
        expectedWorkbenchId: z.string().min(1),
        mutationId: z.string().min(1).max(120),
        sessionId: z.string().min(1),
        expectedRevision: z.number().int().nonnegative(),
        action: z.enum(["start", "pause", "resume", "finish"]),
        authorization: z.literal("explicit_user_instruction"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => runSpecialistTimerMutation(
      ownerId,
      env,
      "control_practice_session_timer",
      input,
      (state, requestHash, dependencies) => controlPracticeSessionTimer(
        state,
        input,
        requestHash,
        dependencies,
      ),
    ),
  );

  server.registerTool(
    "control_practice_workbench",
    {
      description: "Archive the current Today workbench and open one empty replacement after an explicit user instruction. Preserves history, finalizes eligible started timers, enforces result and Voice guards, and is identity-idempotent.",
      inputSchema: {
        expectedWorkbenchId: z.string().min(1),
        mutationId: z.string().min(1).max(120),
        action: z.literal("start_fresh"),
        authorization: z.literal("explicit_user_instruction"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        const prepared = await prepareSpecialistMutation(ownerId, {
          operation: "control_practice_workbench",
          ...input,
        });
        if (prepared.duplicate) {
          const authoritative = await authoritativeSpecialistState(ownerId, prepared.date);
          const payload = { duplicate: true, result: prepared.priorResponse, authoritative };
          return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
        }
        const control = await controlPracticeWorkbench(
          prepared.state,
          input,
          prepared.requestHash,
          prepared.date,
          specialistControlDependencies(ownerId, prepared.date).workbench,
        );
        await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "practice");
        const authoritative = await authoritativeSpecialistState(ownerId, prepared.date);
        const payload = { duplicate: false, result: control.result, authoritative };
        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
      } catch (error) {
        return specialistToolFailure(error);
      }
    },
  );

  server.registerTool(
    "set_practice_result",
    {
      description: "Set or clear a practice result only from an explicit user instruction or an authorized platform verdict. Never infer a result from elapsed time, specialist feedback, or generated code. Requires a current workbench ID and stable mutation ID.",
      inputSchema: {
        expectedWorkbenchId: z.string().min(1),
        mutationId: z.string().min(1).max(120),
        activityId: z.string().min(1),
        expectedRevision: z.number().int().nonnegative(),
        result: z.enum(["solved", "solved_after_reviewing_approach", "failed"]).nullable(),
        authorization: z.enum(["explicit_user_instruction", "authorized_platform_verdict"]),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        const prepared = await prepareSpecialistMutation(ownerId, {
          operation: "set_practice_result",
          ...input,
        });
        if (prepared.duplicate) {
          const authoritative = await authoritativeSpecialistState(ownerId, prepared.date);
          const payload = { duplicate: true, result: prepared.priorResponse, authoritative };
          return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
        }
        const dependencies = specialistControlDependencies(ownerId, prepared.date);
        const result = await setPracticeResult(
          prepared.state,
          input,
          prepared.requestHash,
          prepared.date,
          dependencies.result,
        );
        await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "practice");
        const authoritative = await authoritativeSpecialistState(ownerId, prepared.date);
        const payload = { duplicate: false, result, authoritative };
        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
      } catch (error) {
        return specialistToolFailure(error);
      }
    },
  );

  server.registerTool(
    "get_today_practice",
    {
      description: "Read the authenticated owner's Interview Arc plan, timers, outcomes, notes, and publication state for one day.",
      inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ date }) => {
      const snapshot = await buildPracticeSnapshot(ownerId, date);
      return {
        content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }],
        structuredContent: snapshot,
      };
    },
  );

  server.registerTool(
    "get_publication_queue",
    {
      description: "Read every activity ready for publication, grouped by America/Los_Angeles completion date. Failed attempts remain eligible for a postmortem.",
      inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ date }) => {
      const result = await buildPublicationQueue(ownerId, date);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { date: date ?? null, ...result },
      };
    },
  );

  server.registerTool(
    "mark_activities_published",
    {
      description: "Mark finalized Interview Arc activities as published after their repository artifacts have actually been written.",
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        activities: z.array(z.object({ activityId: z.string().min(1), artifactPath: z.string().min(1) })).min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ date, activities }) => {
      const now = Date.now();
      for (const activity of activities) {
        await setPublicationStatus(ownerId, activity.activityId, date, "published", now, activity.artifactPath);
        await markFinalizationPublished(ownerId, activity.activityId, now);
      }
      const workbenchRolledOver = await rolloverPublishedWorkbench(ownerId, dateInPracticeTimeZone(new Date(now)), now);
      return {
        content: [{ type: "text", text: `Marked ${activities.length} activit${activities.length === 1 ? "y" : "ies"} published.` }],
        structuredContent: { date, published: activities, workbenchRolledOver },
      };
    },
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (url.pathname === "/health") return json(request, { ok: true, service: "interview-arc-mcp" });

    const ownerId = await resolveIntegrationOwner(bearerToken(request));
    if (!ownerId) {
      return json(request, { error: "Unauthorized" }, {
        status: 401,
        headers: { "www-authenticate": "Bearer realm=\"Interview Arc\"" },
      });
    }

    if (url.pathname === "/companion/state" && request.method === "GET") {
      return companionState(ownerId, request);
    }
    if (url.pathname === "/events" && request.method === "GET") {
      return connectOwnerLiveUpdates(env.LIVE_UPDATES, ownerId, request);
    }
    if (url.pathname === "/companion/mutations" && request.method === "POST") {
      return companionMutation(ownerId, request, env);
    }
    if (url.pathname === "/audio/upload" && request.method === "POST") {
      return uploadPracticeAudio(ownerId, request, env);
    }
    if (url.pathname === "/voice/context" && request.method === "GET") {
      return voiceContext(ownerId, request);
    }
    if (url.pathname === "/voice/timers" && request.method === "POST") {
      return voiceTimerMutation(ownerId, request, env);
    }
    if (url.pathname === "/voice/planning" && request.method === "GET") {
      return planningData(ownerId, request);
    }
    if (url.pathname === "/voice/planning/mutations" && request.method === "POST") {
      return voicePlanningMutation(ownerId, request, env);
    }
    if (url.pathname === "/voice/intents" && request.method === "POST") {
      return registerVoiceIntent(ownerId, request, env);
    }
    if (url.pathname === "/voice/intents" && request.method === "GET") {
      return listVoiceIntents(ownerId, request);
    }
    const voiceIntentDecision = url.pathname.match(/^\/voice\/intents\/([^/]+)\/decision$/);
    if (voiceIntentDecision && request.method === "POST") {
      return decideVoiceIntent(ownerId, request, decodeURIComponent(voiceIntentDecision[1]), env);
    }
    const voiceIntentExpiry = url.pathname.match(/^\/voice\/intents\/([^/]+)\/expire$/);
    if (voiceIntentExpiry && request.method === "POST") {
      return expireVoiceIntent(ownerId, request, decodeURIComponent(voiceIntentExpiry[1]), env);
    }
    if (url.pathname === "/voice/captures" && request.method === "POST") {
      return saveVoiceCapture(ownerId, request, env);
    }
    const voiceCaptureDelete = url.pathname.match(/^\/voice\/captures\/([^/]+)$/);
    if (voiceCaptureDelete && request.method === "DELETE") {
      return deleteVoiceCaptureGraph(ownerId, request, env, decodeURIComponent(voiceCaptureDelete[1]));
    }
    const voiceAudioLoss = url.pathname.match(/^\/voice\/captures\/([^/]+)\/audio-loss$/);
    if (voiceAudioLoss && request.method === "POST") {
      return reportVoiceAudioLoss(ownerId, request, decodeURIComponent(voiceAudioLoss[1]), env);
    }
    const voiceAudioLossAcknowledgement = url.pathname.match(/^\/voice\/captures\/([^/]+)\/audio-loss\/acknowledge$/);
    if (voiceAudioLossAcknowledgement && request.method === "POST") {
      return acknowledgeVoiceAudioLoss(ownerId, request, decodeURIComponent(voiceAudioLossAcknowledgement[1]), env);
    }
    const legacyVoiceCaptureDelete = url.pathname.match(/^\/voice\/legacy-orphans\/([^/]+)$/);
    if (legacyVoiceCaptureDelete && request.method === "DELETE") {
      return deleteLegacyVoiceCaptureGraph(ownerId, request, env, decodeURIComponent(legacyVoiceCaptureDelete[1]));
    }
    if (url.pathname === "/voice/delivery" && request.method === "POST") {
      return saveVoiceDelivery(ownerId, request);
    }
    const deliveryReviewBypass = url.pathname.match(/^\/voice\/delivery\/([^/]+)\/publish-without-review$/);
    if (deliveryReviewBypass && request.method === "POST") {
      return acknowledgeDeliveryReviewBypass(ownerId, request, decodeURIComponent(deliveryReviewBypass[1]));
    }
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return createMcpHandler(createServer(ownerId, env))(request, env, ctx);
    }
    return json(request, { error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
