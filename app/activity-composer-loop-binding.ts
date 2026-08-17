import type { LoopActivityContextRequest } from "../db/loop-policy";

export type ComposerLoopStage = {
  stageId: string;
  label: string;
  status: "planned" | "scheduled" | "completed" | "cancelled" | "skipped";
  order: number;
  scheduledAt?: number;
  completedAt?: number;
};

export type ComposerLoopOption = {
  loopId: string;
  company: string;
  roleTitle: string;
  stages: ComposerLoopStage[];
};

export type ComposerLoopBindingState = {
  hiringLoopEnabled: boolean;
  hiringLoopId: string;
  hiringLoopStageId: string;
  hiringLoopUnboundKeys: string[];
};

export const EMPTY_COMPOSER_LOOP_BINDING: ComposerLoopBindingState = {
  hiringLoopEnabled: false,
  hiringLoopId: "",
  hiringLoopStageId: "",
  hiringLoopUnboundKeys: [],
};

const NO_ROUND = "";

export function defaultComposerLoopRoundId(
  stages: readonly ComposerLoopStage[],
  preferredStageId = "",
): string {
  if (preferredStageId && stages.some((stage) => stage.stageId === preferredStageId)) {
    return preferredStageId;
  }
  const scheduled = stages.filter((stage) => stage.status === "scheduled");
  if (scheduled.length) {
    return [...scheduled].sort((left, right) => (
      (left.scheduledAt ?? Number.POSITIVE_INFINITY) - (right.scheduledAt ?? Number.POSITIVE_INFINITY)
      || left.order - right.order
      || left.stageId.localeCompare(right.stageId)
    ))[0].stageId;
  }
  const completed = stages.filter((stage) => stage.status === "completed");
  if (completed.length) {
    return [...completed].sort((left, right) => (
      (right.completedAt ?? 0) - (left.completedAt ?? 0)
      || right.order - left.order
      || right.stageId.localeCompare(left.stageId)
    ))[0].stageId;
  }
  return NO_ROUND;
}

export type ComposerLoopPracticePrefill = {
  loopId: string;
  stages: readonly ComposerLoopStage[];
  preferredStageId?: string;
};

export function composerLoopPrefillFromLoop(
  loop: ComposerLoopPracticePrefill,
): Pick<ComposerLoopBindingState, "hiringLoopEnabled" | "hiringLoopId" | "hiringLoopStageId" | "hiringLoopUnboundKeys"> & {
  reviewOpen: true;
} {
  return {
    hiringLoopEnabled: true,
    hiringLoopId: loop.loopId,
    hiringLoopStageId: defaultComposerLoopRoundId(loop.stages, loop.preferredStageId),
    hiringLoopUnboundKeys: [],
    reviewOpen: true,
  };
}

export function composerLoopContextRequest(input: {
  enabled: boolean;
  loopId: string;
  stageId: string;
}): LoopActivityContextRequest | null {
  if (!input.enabled || !input.loopId) return null;
  return input.stageId ? { loopId: input.loopId, stageId: input.stageId } : { loopId: input.loopId };
}

export function activityKeysBoundToLoop(
  activityKeys: readonly string[],
  unboundKeys: readonly string[],
  enabled: boolean,
): string[] {
  if (!enabled) return [];
  const unbound = new Set(unboundKeys);
  return activityKeys.filter((key) => !unbound.has(key));
}

export function toggleComposerLoopUnboundKey(unboundKeys: readonly string[], key: string): string[] {
  return unboundKeys.includes(key)
    ? unboundKeys.filter((candidate) => candidate !== key)
    : [...unboundKeys, key];
}

export function canBindActivityToLoop(input: {
  status?: string;
  timer?: { startedAt?: number | null; runningSince?: number | null; elapsedSeconds?: number };
}): boolean {
  if (input.status && input.status !== "planned") return false;
  const timer = input.timer;
  if (!timer) return true;
  return !timer.startedAt && !timer.runningSince && !(timer.elapsedSeconds && timer.elapsedSeconds > 0);
}
