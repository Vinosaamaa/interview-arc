import {
  applyFocusTimerAction,
  applyTimerAction,
  ensureOpenWorkbench,
  readLiveState,
  removeFocusBlock,
  removeLiveSession,
  setActivityNote,
  setOutcome,
  setPublicationStatus,
  startFreshWorkbench,
  upsertExtraActivity,
  upsertFocusBlock,
  upsertLiveSession,
  type OutcomeValue,
  type PublicationStatusValue,
  type TimerAction,
  type TimerKind,
} from "./live-state";
import {
  clearActivityReviewSchedules,
  scheduleReview,
  setProblemStar,
  upsertOwnerBankQuestion,
} from "./durable-practice";
import { buildPracticeSnapshot } from "./practice-snapshot";
import { addReviewQueueItemsToToday, deferReviewToNextWeek } from "./review-queue";
import { removePlannedActivities } from "./today-planning";
import { readPracticeActivityIdentity } from "./practice-activity-identity";
import {
  interactionModeMutationFingerprint,
  InteractionModeError,
  resolveInteractionMode,
  type InteractionModePhase,
  type PracticeSpecialty,
} from "./interaction-mode-policy";
import { setPracticeInteractionModeAtomic } from "./interaction-mode-store";
import type {
  PracticeStateExtraActivity,
  PracticeStateSession,
} from "../app/content-types";

type Specialty = "leetcode" | "system_design" | "behavioral";

export type PracticeStateCommand =
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
  | { type: "problem-star"; specialty: Specialty; questionId: string; starred: boolean }
  | {
      type: "personal-question-upsert";
      specialty: Specialty;
      question: {
        questionId: string;
        title: string;
        prompt?: string;
        url?: string;
        tags?: string[];
        priority?: number;
        targetMinutes?: number;
      };
    }
  | { type: "extra-upsert"; activity: PracticeStateExtraActivity }
  | {
      type: "extra-remove";
      id: string;
      mutationId?: string;
      expectedWorkbenchRevision?: number;
    }
  | {
      type: "focus-block-upsert";
      block: {
        id: string;
        date: string;
        focusCategory: "job_applications";
        title: string;
        plannedSeconds: number;
        note?: string;
      };
    }
  | { type: "focus-block-remove"; id: string }
  | { type: "session-upsert"; session: PracticeStateSession }
  | ({
      type: "session-remove";
      activityIds?: string[];
    } & (
      | { id: string; sessionId?: string }
      /** Legacy browser-queue field retained for persisted offline mutations. */
      | { id?: never; sessionId: string }
    ))
  | { type: "review-defer"; reviewKey: string; expectedDueDate: string }
  | {
      type: "review-add-today";
      mutationId: string;
      expectedWorkbenchId: string;
      expectedWorkbenchRevision: number;
      reviewKeys: string[];
    }
  | {
      type: "interaction-mode-set";
      activityId: string;
      interactionModeId: string;
      expectedRevision: number;
      mutationId: string;
      source: "explicit_user_instruction";
      reason: string;
      occurredAt: number;
      authorization: "explicit_user_instruction";
    }
  | { type: "workbench-start-fresh"; workbenchId: string };

export type PracticeStateUpdateScope = "timer" | "publication" | "practice";

export type PracticeStateCommandResult = {
  updateScope: PracticeStateUpdateScope;
  mutationReceipt?: unknown;
};

export class PracticeStateCommandInputError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 503 = 400,
    readonly retryable?: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PracticeStateCommandInputError";
  }
}

function interactionModeCommandError(error: InteractionModeError) {
  const retryable = error.details.retryable === true;
  const conflictCodes = new Set([
    "interaction_mode_already_active",
    "interaction_mode_atomic_conflict",
    "interaction_mode_mutation_identity_conflict",
    "interaction_mode_stale_revision",
    "interaction_mode_trigger_turn_mismatch",
  ]);
  return new PracticeStateCommandInputError(
    error.message,
    retryable ? 503 : conflictCodes.has(error.code) ? 409 : 400,
    retryable,
    error.code,
  );
}

async function setInteractionModeFromWebsite(
  ownerId: string,
  command: Extract<PracticeStateCommand, { type: "interaction-mode-set" }>,
  now: number,
) {
  if (
    !command.activityId
    || !command.interactionModeId?.trim()
    || !Number.isInteger(command.expectedRevision)
    || command.expectedRevision < 0
    || !command.mutationId
    || command.mutationId.length > 160
    || command.source !== "explicit_user_instruction"
    || !command.reason?.trim()
    || command.reason.length > 2_000
    || !Number.isInteger(command.occurredAt)
    || command.occurredAt <= 0
    || command.authorization !== "explicit_user_instruction"
  ) {
    throw new PracticeStateCommandInputError("Invalid interaction-mode mutation.");
  }
  const activity = await readPracticeActivityIdentity(ownerId, command.activityId);
  if (!activity) {
    throw new PracticeStateCommandInputError(
      "That owner-scoped practice activity does not exist.",
      404,
      false,
      "interaction_mode_activity_not_found",
    );
  }
  try {
    const resolved = resolveInteractionMode(
      command.interactionModeId,
      activity.specialty as PracticeSpecialty,
      activity.phase as InteractionModePhase,
    );
    const canonical = {
      activityId: command.activityId,
      interactionModeId: resolved.mode.id,
      expectedRevision: command.expectedRevision,
      source: command.source,
      reason: command.reason.trim(),
      occurredAt: command.occurredAt,
      authorization: command.authorization,
    } as const;
    const requestFingerprint = await interactionModeMutationFingerprint(canonical);
    return await setPracticeInteractionModeAtomic({
      ownerId,
      ...canonical,
      registryVersion: resolved.registryVersion,
      mutationId: command.mutationId,
      requestFingerprint,
      now,
    });
  } catch (error) {
    if (error instanceof InteractionModeError) throw interactionModeCommandError(error);
    throw error;
  }
}

const TIMER_ACTIONS: TimerAction[] = ["start", "pause", "finish"];
const TIMER_KINDS: TimerKind[] = ["activity", "session"];
const OUTCOMES: OutcomeValue[] = ["solved", "solved_after_reviewing_approach", "failed"];
const PUBLICATION_STATUSES: PublicationStatusValue[] = ["draft", "ready", "published"];
const SPECIALTIES: Specialty[] = ["leetcode", "system_design", "behavioral"];

async function syncCompletedReview(
  ownerId: string,
  date: string,
  activityId: string,
  now: number,
) {
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
      questionId: activity.questionId,
      specialty: activity.type ?? "leetcode",
      completedDate: date,
      reason: outcome === "failed" ? "failed" : "approach_review",
    }, now);
  } else if (outcome === "solved" && activity.reviewOfActivityId) {
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

/**
 * Executes one owner-scoped practice-state command.
 *
 * Callers own authentication, authoritative read-back, and live-update
 * transport. This Module owns command validation, D1 transition ordering, and
 * command side effects so browser and Companion adapters do not reimplement
 * those invariants.
 */
export async function executePracticeStateCommand(
  ownerId: string,
  date: string,
  command: PracticeStateCommand,
  now: number,
): Promise<PracticeStateCommandResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new PracticeStateCommandInputError("A valid `date` (YYYY-MM-DD) is required.");
  }

  let mutationReceipt: unknown;
  switch (command.type) {
    case "timer": {
      if (!command.subjectId || !TIMER_KINDS.includes(command.kind) || !TIMER_ACTIONS.includes(command.action)) {
        throw new PracticeStateCommandInputError("Invalid timer mutation.");
      }
      const before = await readLiveState(ownerId, date);
      const isFocusBlock = before.focusBlocks.some((candidate) => (
        typeof candidate === "object" && candidate !== null && "id" in candidate && candidate.id === command.subjectId
      ));
      if (command.action === "finish") {
        const timer = command.kind === "activity"
          ? before.timers[command.subjectId]
          : before.sessionTimers[command.subjectId];
        if (!timer?.startedAt) {
          throw new PracticeStateCommandInputError(
            `Start the ${command.kind === "activity" ? "activity stopwatch" : "session countdown"} before finishing it.`,
            409,
          );
        }
        if (command.kind === "activity" && !isFocusBlock && !before.outcomes[command.subjectId]) {
          throw new PracticeStateCommandInputError(
            "Choose Solved, Solved with help, or Failed before finishing this activity.",
            409,
            false,
          );
        }
        if (command.kind === "session") {
          const session = before.sessions.find((candidate) => (
            typeof candidate === "object" && candidate !== null && "id" in candidate && candidate.id === command.subjectId
          )) as { activityIds?: string[] } | undefined;
          command.activityIds = session?.activityIds ?? [];
        }
      }
      if (isFocusBlock) {
        if (command.kind !== "activity") {
          throw new PracticeStateCommandInputError("Career focus blocks use activity stopwatches.");
        }
        await applyFocusTimerAction(ownerId, command.subjectId, command.action, now, command.sessionId);
      } else {
        await applyTimerAction(ownerId, command.subjectId, command.kind, command.action, now, {
          sessionId: command.sessionId,
          activityIds: command.activityIds,
        });
      }
      if (!isFocusBlock && command.kind === "activity" && command.action === "finish") {
        await syncCompletedReview(ownerId, date, command.subjectId, now);
      }
      return { updateScope: "timer" };
    }
    case "outcome": {
      if (
        !command.activityId
        || command.outcome === undefined
        || (command.outcome !== null && !OUTCOMES.includes(command.outcome))
      ) {
        throw new PracticeStateCommandInputError("Invalid outcome mutation.");
      }
      await setOutcome(ownerId, command.activityId, command.outcome, now);
      await syncCompletedReview(ownerId, date, command.activityId, now);
      break;
    }
    case "publication-status": {
      if (!command.activityId || !PUBLICATION_STATUSES.includes(command.status)) {
        throw new PracticeStateCommandInputError("Invalid publication-status mutation.");
      }
      await setPublicationStatus(
        ownerId,
        command.activityId,
        date,
        command.status,
        now,
        command.artifactPath,
      );
      return { updateScope: "publication" };
    }
    case "activity-note": {
      if (!command.activityId || typeof command.note !== "string" || command.note.length > 20_000) {
        throw new PracticeStateCommandInputError("Invalid activity-note mutation.");
      }
      await setActivityNote(ownerId, command.activityId, date, command.note, now);
      break;
    }
    case "problem-star": {
      if (!command.questionId || !SPECIALTIES.includes(command.specialty) || typeof command.starred !== "boolean") {
        throw new PracticeStateCommandInputError("Invalid problem-star mutation.");
      }
      await setProblemStar(ownerId, command.specialty, command.questionId, command.starred, now);
      break;
    }
    case "personal-question-upsert": {
      if (!command.question?.questionId || !command.question.title || !SPECIALTIES.includes(command.specialty)) {
        throw new PracticeStateCommandInputError("Invalid personal question mutation.");
      }
      await upsertOwnerBankQuestion(ownerId, command.specialty, command.question, now);
      break;
    }
    case "extra-upsert": {
      if (!command.activity?.id || !command.activity.date) {
        throw new PracticeStateCommandInputError("Invalid extra activity.");
      }
      await upsertExtraActivity(ownerId, command.activity, now);
      break;
    }
    case "extra-remove": {
      if (!command.id) throw new PracticeStateCommandInputError("Missing activity id.");
      const workbench = await ensureOpenWorkbench(ownerId, date, now);
      const legacyRouteRevisionless = !command.mutationId;
      mutationReceipt = await removePlannedActivities(ownerId, {
        date,
        expectedWorkbenchId: workbench.id,
        expectedWorkbenchRevision: command.expectedWorkbenchRevision ?? workbench.revision,
        mutationId: command.mutationId ?? `legacy-remove-${command.id}`,
        activityIds: [command.id],
        legacyRouteRevisionless,
      }, now);
      break;
    }
    case "focus-block-upsert": {
      const block = command.block;
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
        throw new PracticeStateCommandInputError("Invalid career focus block.");
      }
      await upsertFocusBlock(ownerId, { ...block, title: block.title.trim() }, now);
      break;
    }
    case "focus-block-remove": {
      if (!command.id) throw new PracticeStateCommandInputError("Missing focus block id.");
      await removeFocusBlock(ownerId, command.id);
      break;
    }
    case "session-upsert": {
      if (!command.session?.id || !command.session.date) {
        throw new PracticeStateCommandInputError("Invalid session.");
      }
      await upsertLiveSession(ownerId, command.session, now);
      break;
    }
    case "session-remove": {
      if (command.id && command.sessionId && command.id !== command.sessionId) {
        throw new PracticeStateCommandInputError("Conflicting session ids.");
      }
      const sessionId = command.id ?? command.sessionId;
      if (!sessionId) throw new PracticeStateCommandInputError("Missing session id.");
      await removeLiveSession(ownerId, sessionId);
      break;
    }
    case "review-defer": {
      if (!command.reviewKey || !/^\d{4}-\d{2}-\d{2}$/.test(command.expectedDueDate)) {
        throw new PracticeStateCommandInputError("Invalid review deferral.");
      }
      await deferReviewToNextWeek(ownerId, {
        reviewKey: command.reviewKey,
        expectedDueDate: command.expectedDueDate,
        today: date,
      }, now);
      break;
    }
    case "review-add-today": {
      if (
        !command.expectedWorkbenchId
        || !Number.isInteger(command.expectedWorkbenchRevision)
        || command.expectedWorkbenchRevision < 0
        || !command.mutationId
        || command.mutationId.length > 120
        || !Array.isArray(command.reviewKeys)
        || command.reviewKeys.length < 1
        || command.reviewKeys.length > 30
        || command.reviewKeys.some((reviewKey) => typeof reviewKey !== "string" || !reviewKey)
      ) {
        throw new PracticeStateCommandInputError("Invalid Review Queue selection.");
      }
      await addReviewQueueItemsToToday(ownerId, {
        date,
        expectedWorkbenchId: command.expectedWorkbenchId,
        expectedWorkbenchRevision: command.expectedWorkbenchRevision,
        mutationId: command.mutationId,
        reviewKeys: command.reviewKeys,
      }, now);
      break;
    }
    case "interaction-mode-set": {
      mutationReceipt = await setInteractionModeFromWebsite(ownerId, command, now);
      break;
    }
    case "workbench-start-fresh": {
      if (!command.workbenchId) {
        throw new PracticeStateCommandInputError("Missing new workbench id.");
      }
      await startFreshWorkbench(ownerId, date, now, command.workbenchId);
      break;
    }
    default:
      throw new PracticeStateCommandInputError("Unknown mutation type.");
  }

  return {
    updateScope: "practice",
    ...(mutationReceipt ? { mutationReceipt } : {}),
  };
}
