import {
  applyTimerAction,
  applyFocusTimerAction,
  ensureOpenWorkbench,
  readLiveState,
  removeFocusBlock,
  removeLiveSession,
  setActivityNote,
  setOutcome,
  setPublicationStatus,
  startFreshWorkbench,
  TimerStateConflictError,
  upsertExtraActivity,
  upsertFocusBlock,
  upsertLiveSession,
  type OutcomeValue,
  type PublicationStatusValue,
  type TimerAction,
  type TimerKind,
} from "../../../db/live-state";
import {
  removePlannedActivities,
  TodayPlanningConflictError,
} from "../../../db/today-planning";
import { resolveOwnerId } from "../../../db/owner";
import { buildPracticeSnapshot } from "../../../db/practice-snapshot";
import { toRouteErrorMessage } from "../route-helpers";
import { clearActivityReviewSchedules, scheduleReview, setProblemStar, upsertOwnerBankQuestion } from "../../../db/durable-practice";
import { env } from "cloudflare:workers";
import { publishOwnerLiveUpdate } from "../../../worker/live-update-hub";

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
  | {
      type: "extra-remove";
      id: string;
      mutationId?: string;
      expectedWorkbenchRevision?: number;
    }
  | { type: "focus-block-upsert"; block: { id: string; date: string; focusCategory: "job_applications"; title: string; plannedSeconds: number; note?: string } }
  | { type: "focus-block-remove"; id: string }
  | { type: "session-upsert"; session: { id: string; date: string } & Record<string, unknown> }
  | { type: "session-remove"; id: string; activityIds?: string[] }
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
    let mutationReceipt: unknown;

    switch (mutation.type) {
      case "timer": {
        if (!mutation.subjectId || !TIMER_KINDS.includes(mutation.kind) || !TIMER_ACTIONS.includes(mutation.action)) {
          return Response.json({ error: "Invalid timer mutation." }, { status: 400 });
        }
        const before = await readLiveState(ownerId, date);
        const isFocusBlock = before.focusBlocks.some((candidate) => (
          typeof candidate === "object" && candidate !== null && "id" in candidate && candidate.id === mutation.subjectId
        ));
        if (mutation.action === "finish") {
          const timer = mutation.kind === "activity"
            ? before.timers[mutation.subjectId]
            : before.sessionTimers[mutation.subjectId];
          if (!timer?.startedAt) {
            return Response.json({ error: `Start the ${mutation.kind === "activity" ? "activity stopwatch" : "session countdown"} before finishing it.` }, { status: 409 });
          }
          if (mutation.kind === "activity" && !isFocusBlock && !before.outcomes[mutation.subjectId]) {
            return Response.json({ error: "Choose Solved, Solved with help, or Failed before finishing this activity.", retryable: false }, { status: 409 });
          }
          if (mutation.kind === "session") {
            const session = before.sessions.find((candidate) => (
              typeof candidate === "object" && candidate !== null && "id" in candidate && candidate.id === mutation.subjectId
            )) as { activityIds?: string[] } | undefined;
            mutation.activityIds = session?.activityIds ?? [];
          }
        }
        if (isFocusBlock) {
          if (mutation.kind !== "activity") {
            return Response.json({ error: "Career focus blocks use activity stopwatches." }, { status: 400 });
          }
          await applyFocusTimerAction(ownerId, mutation.subjectId, mutation.action, now, mutation.sessionId);
        } else {
          await applyTimerAction(ownerId, mutation.subjectId, mutation.kind, mutation.action, now, {
            sessionId: mutation.sessionId,
            activityIds: mutation.activityIds,
          });
        }
        if (!isFocusBlock && mutation.kind === "activity" && mutation.action === "finish") {
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
        const workbench = await ensureOpenWorkbench(ownerId, date, now);
        const legacyRouteRevisionless = !mutation.mutationId;
        const removal = await removePlannedActivities(ownerId, {
          date,
          expectedWorkbenchId: workbench.id,
          expectedWorkbenchRevision: mutation.expectedWorkbenchRevision
            ?? workbench.revision,
          mutationId: mutation.mutationId ?? `legacy-remove-${mutation.id}`,
          activityIds: [mutation.id],
          legacyRouteRevisionless,
        }, now);
        mutationReceipt = removal;
        break;
      }
      case "focus-block-upsert": {
        const block = mutation.block;
        if (
          !block?.id
          || !block.date
          || block.focusCategory !== "job_applications"
          || !block.title?.trim()
          || !Number.isInteger(block.plannedSeconds)
          || block.plannedSeconds < 60
          || block.plannedSeconds > 12 * 60 * 60
          || (block.note?.length ?? 0) > 20_000
        ) {
          return Response.json({ error: "Invalid career focus block." }, { status: 400 });
        }
        await upsertFocusBlock(ownerId, { ...block, title: block.title.trim() }, now);
        break;
      }
      case "focus-block-remove": {
        if (!mutation.id) return Response.json({ error: "Missing focus block id." }, { status: 400 });
        await removeFocusBlock(ownerId, mutation.id);
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
        await removeLiveSession(ownerId, mutation.id);
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
    await publishOwnerLiveUpdate(
      env.LIVE_UPDATES,
      ownerId,
      mutation.type === "timer" ? "timer" : mutation.type === "publication-status" ? "publication" : "practice",
    );
    return Response.json({
      ...state,
      ...(mutationReceipt ? { mutationReceipt } : {}),
    });
  } catch (error) {
    if (error instanceof TimerStateConflictError) {
      return Response.json({ error: error.message, retryable: false }, { status: 409 });
    }
    if (error instanceof TodayPlanningConflictError) {
      return Response.json({
        error: error.message,
        code: error.code,
        retryable: false,
      }, { status: 409 });
    }
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
