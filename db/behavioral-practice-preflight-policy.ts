import { z } from "zod";

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const boundedList = (items: number, length = 1_000) => z.array(boundedText(length)).max(items);

export const behavioralTargetReviewSchema = z.object({
  schemaVersion: z.literal(1),
  universalQuality: z.object({
    strengths: boundedList(50),
    improvements: boundedList(50),
  }).strict(),
  targetAlignment: z.object({
    strengths: boundedList(50),
    gaps: boundedList(50),
    competencySignals: boundedList(24, 120),
  }).strict(),
  assistance: z.object({
    level: z.enum(["none", "probing", "coached_discovery", "model_answer"]),
    details: boundedList(50),
  }).strict(),
  evidenceGaps: boundedList(100),
}).strict();

export type BehavioralTargetReview = z.infer<typeof behavioralTargetReviewSchema>;

export type TargetVariantStaleReason =
  | "target_not_resolved"
  | "target_binding_changed"
  | "target_revision_changed"
  | "solution_profile_revision_changed";

export function targetVariantStaleReasons(
  variant: {
    targetId: string;
    targetRevision: number;
    solutionProfileRevision: number;
  },
  current: {
    resolvedTargetId: string | null;
    resolvedTargetRevision: number | null;
    currentTargetRevision: number | null;
    currentSolutionProfileRevision: number | null;
  },
): TargetVariantStaleReason[] {
  const reasons: TargetVariantStaleReason[] = [];
  if (!current.resolvedTargetId || !current.resolvedTargetRevision) {
    reasons.push("target_not_resolved");
  } else if (
    current.resolvedTargetId !== variant.targetId
    || current.resolvedTargetRevision !== variant.targetRevision
  ) {
    reasons.push("target_binding_changed");
  }
  if (
    current.currentTargetRevision !== null
    && current.currentTargetRevision !== variant.targetRevision
  ) reasons.push("target_revision_changed");
  if (
    current.currentSolutionProfileRevision !== null
    && current.currentSolutionProfileRevision !== variant.solutionProfileRevision
  ) reasons.push("solution_profile_revision_changed");
  return reasons;
}
