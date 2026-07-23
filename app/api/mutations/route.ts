import {
  applyTimerAction,
  readLiveState,
  removeExtraActivity,
  removeLiveSession,
  setActivityNote,
  setOutcome,
  setPublicationStatus,
  startFreshWorkbench,
  upsertExtraActivity,
  upsertLiveSession,
  type OutcomeValue,
  type PublicationStatusValue,
  type TimerAction,
  type TimerKind,
} from "../../../db/live-state";
import { resolveOwnerId } from "../../../db/owner";
import { buildPracticeSnapshot } from "../../../db/practice-snapshot";
import { toRouteErrorMessage } from "../route-helpers";
import { clearActivityReviewSchedules, scheduleReview, setProblemStar, upsertOwnerBankQuestion } from "../../../db/durable-practice";

type Mutation =
  | {
      type: "timer";
      subjectId: string;
      kind: TimerKind;
      action: TimerAction;
      sessionId?: string;
      activityIds?: string[];
    }
  | { type: "outcome"; activityId: string; outcome: OutcomeValue | null; sessionId?: string }
  | { type: "publication-status"; activityId: string; status: PublicationStatusValue; artifactPath?: string }
  | { type: "activity-note"; activityId: string; note: string }
  | { type: "problem-star"; specialty: "leetcode" | "system_design" | "behavioral"; questionId: string; starred: boolean }
  | { type: "personal-question-upsert"; specialty: "leetcode" | "system_design" | "behavioral"; question: { questionId: string; title: string; prompt?: string; url?: string; tags?: string[]; priority?: number; targetMinutes?: number } }
  | { type: "extra-upsert"; activity: { id: string; date: string } & Record<string, unknown> }
  | { type: "extra-remove"; id: string }
  | { type: "session-upsert"; session: { id: string; date: string } & Record<string, unknown> }
  | { type: "session-remove"; id: string; activityIds: string[] }
  | { type: "workbench-start-fresh"; workbenchId: string };

const TIMER_ACTIONS: TimerAction[] = ["start", "pause", "finish"];
const TIMER_KINDS: TimerKind[] = ["activity", "session"];
const PUBLICATION_STATUSES: PublicationStatusValue[] = ["draft", "ready", "published"];

async function syncCompletedReview(ownerId: string, date: string, activityId: string, now: number) {
  const snapshot = await buildPracticeSnapshot(ownerId, date);
  const activity = snapshot.activities.find((item) => item.id === activityId);
  if (!activity?.timer?.completed) {
    await clearActivityReviewSchedules(ownerId, activityId);
    return;
  }
  const outcome = activity.outcome;
  if (outcome === "failed" || outcome === "solved_after_reviewing_approach") {
    await scheduleReview(ownerId, {
      activityId,
      questionId: activity?.questionId,
      specialty: activity?.type ?? "leetcode",
      completedDate: date,
      reason: outcome === "failed" ? "failed" : "approach_review",
    }, now);
  } else if (outcome === "solved" && activity?.reviewOfActivityId) {
    await scheduleReview(ownerId, {
      activityId,
      questionId: activity.questionId,
      specialty: activity.type ?? "leetcode",
      completedDate: date,
      reason: "successful_recall",
    }, now);
  } else {
    await clearActivityReviewSchedules(ownerId, activityId);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { date?: string; mutation?: Mutation };
    const date = body.date;
    const mutation = body.mutation;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: "A valid `date` (YYYY-MM-DD) is required." }, { status: 400 });
    }
    if (!mutation || typeof mutation !== "object") {
      return Response.json({ error: "A `mutation` object is required." }, { status: 400 });
    }

    const ownerId = await resolveOwnerId(request);
    const now = Date.now();

    switch (mutation.type) {
      case "timer": {
        if (!mutation.subjectId || !TIMER_KINDS.includes(mutation.kind) || !TIMER_ACTIONS.includes(mutation.action)) {
          return Response.json({ error: "Invalid timer mutation." }, { status: 400 });
        }
        if (mutation.action === "finish") {
          const before = await readLiveState(ownerId, date);
          const timer = mutation.kind === "activity"
            ? before.timers[mutation.subjectId]
            : before.sessionTimers[mutation.subjectId];
          if (!timer?.startedAt) {
            return Response.json({ error: `Start the ${mutation.kind === "activity" ? "activity stopwatch" : "session countdown"} before finishing it.` }, { status: 409 });
          }
        }
        await applyTimerAction(ownerId, mutation.subjectId, mutation.kind, mutation.action, now, {
          sessionId: mutation.sessionId,
          activityIds: mutation.activityIds,
        });
        if (mutation.kind === "activity" && mutation.action === "finish") {
          await syncCompletedReview(ownerId, date, mutation.subjectId, now);
        }
        break;
      }
      case "outcome": {
        if (!mutation.activityId) {
          return Response.json({ error: "Invalid outcome mutation." }, { status: 400 });
        }
        await setOutcome(ownerId, mutation.activityId, mutation.outcome ?? null, now);
        await syncCompletedReview(ownerId, date, mutation.activityId, now);
        break;
      }
      case "publication-status": {
        if (!mutation.activityId || !PUBLICATION_STATUSES.includes(mutation.status)) {
          return Response.json({ error: "Invalid publication-status mutation." }, { status: 400 });
        }
        await setPublicationStatus(
          ownerId,
          mutation.activityId,
          date,
          mutation.status,
          now,
          mutation.artifactPath,
        );
        break;
      }
      case "activity-note": {
        if (!mutation.activityId || typeof mutation.note !== "string" || mutation.note.length > 20_000) {
          return Response.json({ error: "Invalid activity-note mutation." }, { status: 400 });
        }
        await setActivityNote(ownerId, mutation.activityId, date, mutation.note, now);
        break;
      }
      case "problem-star": {
        if (!mutation.questionId || !["leetcode", "system_design", "behavioral"].includes(mutation.specialty) || typeof mutation.starred !== "boolean") {
          return Response.json({ error: "Invalid problem-star mutation." }, { status: 400 });
        }
        await setProblemStar(ownerId, mutation.specialty, mutation.questionId, mutation.starred, now);
        break;
      }
      case "personal-question-upsert": {
        if (!mutation.question?.questionId || !mutation.question.title || !["leetcode", "system_design", "behavioral"].includes(mutation.specialty)) {
          return Response.json({ error: "Invalid personal question mutation." }, { status: 400 });
        }
        await upsertOwnerBankQuestion(ownerId, mutation.specialty, mutation.question, now);
        break;
      }
      case "extra-upsert": {
        if (!mutation.activity?.id || !mutation.activity?.date) {
          return Response.json({ error: "Invalid extra activity." }, { status: 400 });
        }
        await upsertExtraActivity(ownerId, mutation.activity, now);
        break;
      }
      case "extra-remove": {
        if (!mutation.id) return Response.json({ error: "Missing activity id." }, { status: 400 });
        await removeExtraActivity(ownerId, mutation.id);
        break;
      }
      case "session-upsert": {
        if (!mutation.session?.id || !mutation.session?.date) {
          return Response.json({ error: "Invalid session." }, { status: 400 });
        }
        await upsertLiveSession(ownerId, mutation.session, now);
        break;
      }
      case "session-remove": {
        if (!mutation.id) return Response.json({ error: "Missing session id." }, { status: 400 });
        await removeLiveSession(ownerId, mutation.id, mutation.activityIds ?? []);
        break;
      }
      case "workbench-start-fresh": {
        if (!mutation.workbenchId) {
          return Response.json({ error: "Missing new workbench id." }, { status: 400 });
        }
        await startFreshWorkbench(ownerId, date, now, mutation.workbenchId);
        break;
      }
      default:
        return Response.json({ error: "Unknown mutation type." }, { status: 400 });
    }

    const state = await readLiveState(ownerId, date);
    return Response.json(state);
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
