import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadContentIndex } from "../db/content";
import { resolveIntegrationOwner } from "../db/integrations";
import {
  applyTimerAction,
  setActivityNote,
  setOutcome,
  setPublicationStatus,
  upsertExtraActivity,
  type OutcomeValue,
  type PublicationStatusValue,
  type TimerAction,
} from "../db/live-state";
import { buildPracticeSnapshot, buildPublicationQueue, dateInPracticeTimeZone } from "../db/practice-snapshot";
import {
  addPracticeNote,
  appendTranscriptTurns,
  appendVoiceTranscriptTurn,
  clearActivityReviewSchedules,
  markFinalizationPublished,
  readActivityPracticeRecord,
  readProblemSolutionProfile,
  readSpecialistTasks,
  registerActivityAudioClip,
  registerSpecialistTask,
  saveActivityDeliveryAnalysis,
  saveSpecialistFinalization,
  scheduleReview,
  updateActivityAudioClipStatus,
  upsertOwnerBankQuestion,
} from "../db/durable-practice";

interface Env {
  DB: D1Database;
  AUDIO: R2Bucket;
}

function safeAudioFilename(value: string) {
  return value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "practice-audio";
}

async function uploadPracticeAudio(ownerId: string, request: Request, env: Env) {
  const form = await request.formData();
  const requestedClipId = String(form.get("clipId") ?? "").trim();
  const activityId = String(form.get("activityId") ?? "").trim();
  const transcriptTurnId = String(form.get("transcriptTurnId") ?? "").trim() || undefined;
  const label = String(form.get("label") ?? "Practice answer").trim().slice(0, 120) || "Practice answer";
  const durationValue = Number(form.get("durationSeconds") ?? "");
  const durationSeconds = Number.isFinite(durationValue) && durationValue >= 0 ? Math.round(durationValue) : undefined;
  const file = form.get("file");
  if ((requestedClipId && !/^[a-zA-Z0-9._-]{1,120}$/.test(requestedClipId))
      || !activityId || !(file instanceof File) || !file.type.startsWith("audio/") || file.size === 0 || file.size > 100 * 1024 * 1024) {
    return json(request, { error: "An activityId and non-empty audio file no larger than 100 MB are required." }, { status: 400 });
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
    await updateActivityAudioClipStatus(ownerId, clipId, "available", Date.now());
  } catch (error) {
    await updateActivityAudioClipStatus(ownerId, clipId, "failed", Date.now());
    throw error;
  }
  return json(request, { clipId, activityId, transcriptTurnId: transcriptTurnId ?? null, filename, mimeType: file.type, label, durationSeconds: durationSeconds ?? null, status: "available" }, { status: 201 });
}

const VOICE_PROTOCOL_VERSION = 1;

function voiceSpecialty(value: "leetcode" | "system_design" | "behavioral") {
  return value === "leetcode" ? "coding" : value === "system_design" ? "system-design" : "behavioral";
}

async function voiceContext(ownerId: string, request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? dateInPracticeTimeZone();
  const [snapshot, content, specialists] = await Promise.all([
    buildPracticeSnapshot(ownerId, date),
    loadContentIndex(),
    readSpecialistTasks(ownerId),
  ]);
  const activity = snapshot.focusedActivity;
  if (!activity) {
    return json(request, {
      protocolVersion: VOICE_PROTOCOL_VERSION,
      date,
      focusedActivity: null,
      specialist: null,
      message: "Focus an activity in Interview Arc before recording.",
    });
  }
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
    },
    specialist: specialist ? {
      specialty: specialist.specialty,
      threadId: specialist.threadId,
      hostId: specialist.hostId,
      title: specialist.title,
    } : null,
    message: specialist ? null : `Connect the ${activity.type} specialist task before sending a recording.`,
  });
}

async function saveVoiceCapture(ownerId: string, request: Request) {
  const body = (await request.json()) as {
    protocolVersion?: number;
    activityId?: string;
    specialty?: "leetcode" | "system_design" | "behavioral";
    turnId?: string;
    transcript?: string;
    occurredAt?: number;
  };
  if (body.protocolVersion !== VOICE_PROTOCOL_VERSION) {
    return json(request, { error: "Unsupported Interview Arc Voice protocol version." }, { status: 409 });
  }
  const activityId = body.activityId?.trim() ?? "";
  const turnId = body.turnId?.trim() ?? "";
  const transcript = body.transcript?.trim() ?? "";
  const specialty = body.specialty;
  const occurredAt = Number.isFinite(body.occurredAt) ? Number(body.occurredAt) : Date.now();
  if (!activityId || !specialty || !turnId || !transcript || transcript.length > 200_000) {
    return json(request, { error: "A focused activity, specialty, stable turnId, and transcript are required." }, { status: 400 });
  }
  const snapshot = await buildPracticeSnapshot(ownerId);
  if (snapshot.focusedActivity?.id !== activityId || snapshot.focusedActivity.type !== specialty) {
    return json(request, { error: "The recording no longer matches the focused Interview Arc activity." }, { status: 409 });
  }
  const turn = await appendVoiceTranscriptTurn(ownerId, { activityId, specialty, turnId, body: transcript, occurredAt }, Date.now());
  return json(request, { protocolVersion: VOICE_PROTOCOL_VERSION, turn }, { status: 201 });
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
  return match?.[1]?.trim() ?? "";
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const allowedOrigin = origin.startsWith("chrome-extension://") ? origin : "";
  return {
    ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin } : {}),
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
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
  const currentActivity = problemUrl
    ? snapshot.activities.find((activity) => normalizeLeetCodeUrl(activity.url ?? "") === problemUrl) ?? null
    : null;
  return json(request, { ...snapshot, currentActivity });
}

async function companionMutation(ownerId: string, request: Request) {
  const body = (await request.json()) as {
    date?: string;
    mutation?:
      | { type: "timer"; activityId: string; action: TimerAction }
      | { type: "outcome"; activityId: string; outcome: OutcomeValue | null }
      | { type: "publication-status"; activityId: string; status: PublicationStatusValue }
      | { type: "activity-note"; activityId: string; note: string }
      | { type: "add-leetcode"; url: string };
  };
  const date = body.date ?? dateInPracticeTimeZone();
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
  return companionState(ownerId, new Request(new URL(`/companion/state?date=${date}`, request.url), {
    headers: request.headers,
  }));
}

function createServer(ownerId: string) {
  const server = new McpServer({ name: "Interview Arc", version: "1.0.0" });

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
      inputSchema: {
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
          solutionProfileAction: z.enum(["create_or_revise", "reuse_current"]).optional(),
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
      },
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
    "get_problem_solution_profile",
    {
      description: "Load the owner-private current Solution Profile and immutable revision history for a stable bank question. Every specialist calls this after resolving questionId and before preparing a first attempt or revisit.",
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
      return {
        content: [{ type: "text", text: `Marked ${activities.length} activit${activities.length === 1 ? "y" : "ies"} published.` }],
        structuredContent: { date, published: activities },
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
    if (url.pathname === "/companion/mutations" && request.method === "POST") {
      return companionMutation(ownerId, request);
    }
    if (url.pathname === "/audio/upload" && request.method === "POST") {
      return uploadPracticeAudio(ownerId, request, env);
    }
    if (url.pathname === "/voice/context" && request.method === "GET") {
      return voiceContext(ownerId, request);
    }
    if (url.pathname === "/voice/captures" && request.method === "POST") {
      return saveVoiceCapture(ownerId, request);
    }
    if (url.pathname === "/voice/delivery" && request.method === "POST") {
      return saveVoiceDelivery(ownerId, request);
    }
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return createMcpHandler(createServer(ownerId))(request, env, ctx);
    }
    return json(request, { error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
