import { z } from "zod";

const stableId = z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/);
export const hintRungs = ["none", "nudge", "hint", "scaffold", "walkthrough", "answer"] as const;

export const interactionModeClassificationInputSchema = z.object({
  schemaVersion: z.literal(1),
  provenance: z.enum(["recorded", "reconstructed"]),
  materialSpecialistTurnIds: z.array(stableId).max(500),
  assistanceEvents: z.array(z.object({
    turnId: stableId,
    rung: z.enum(hintRungs),
  })).max(100),
}).superRefine((value, context) => {
  const material = new Set(value.materialSpecialistTurnIds);
  if (material.size !== value.materialSpecialistTurnIds.length) {
    context.addIssue({ code: "custom", path: ["materialSpecialistTurnIds"], message: "Material turn IDs must be unique." });
  }
  const assistance = new Set<string>();
  for (const [index, event] of value.assistanceEvents.entries()) {
    if (!material.has(event.turnId)) {
      context.addIssue({ code: "custom", path: ["assistanceEvents", index, "turnId"], message: "Assistance must reference a material specialist turn." });
    }
    if (assistance.has(event.turnId)) {
      context.addIssue({ code: "custom", path: ["assistanceEvents", index, "turnId"], message: "Assistance turn IDs must be unique." });
    }
    assistance.add(event.turnId);
  }
});

export const interactionModeClassificationCorrectionSchema = z.object({
  replacesSnapshotRevision: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2_000),
});

export type InteractionModeClassificationInput = z.infer<typeof interactionModeClassificationInputSchema>;
export type InteractionModeClassificationMethod = "active_timer_seconds" | "material_specialist_turn_share" | "unrecorded";
export type InteractionModeClassification = {
  schemaVersion: 1;
  primaryPracticeModeId: string | "mixed" | "unrecorded";
  modeShares: Array<{ interactionModeId: string; basisPoints: number }>;
  method: InteractionModeClassificationMethod;
  hadMentorAssistance: boolean;
  highestHintRung: typeof hintRungs[number];
  provenance: "recorded" | "reconstructed" | "unrecorded";
  initialModeId: string | null;
  transitionCount: number;
  materialSpecialistTurnIds: string[];
};

export const interactionModeClassificationSchema = z.object({
  schemaVersion: z.literal(1),
  primaryPracticeModeId: z.string().min(1),
  modeShares: z.array(z.object({
    interactionModeId: z.string().min(1),
    basisPoints: z.number().int().min(0).max(10_000),
  })),
  method: z.enum(["active_timer_seconds", "material_specialist_turn_share", "unrecorded"]),
  hadMentorAssistance: z.boolean(),
  highestHintRung: z.enum(hintRungs),
  provenance: z.enum(["recorded", "reconstructed", "unrecorded"]),
  initialModeId: z.string().nullable(),
  transitionCount: z.number().int().nonnegative(),
  materialSpecialistTurnIds: z.array(z.string()),
});

type Transition = { toInteractionModeId: string; occurredAt: number; toRevision: number };
type TimerInterval = { startedAt: number; endedAt: number | null };
type TranscriptTurn = {
  turnId: string;
  speaker: "user" | "specialist";
  occurredAt: number;
  overrideInteractionModeId?: string | null;
};

function activeModeAt(transitions: readonly Transition[], occurredAt: number) {
  let active: Transition | null = null;
  for (const transition of transitions) {
    if (transition.occurredAt > occurredAt) break;
    active = transition;
  }
  return active?.toInteractionModeId ?? null;
}

function addWeight(weights: Map<string, number>, modeId: string, value: number) {
  weights.set(modeId, (weights.get(modeId) ?? 0) + value);
}

function timerWeights(transitions: readonly Transition[], intervals: readonly TimerInterval[]) {
  if (!intervals.length || intervals.some((interval) => interval.endedAt === null || interval.endedAt <= interval.startedAt)) return null;
  const weights = new Map<string, number>();
  for (const interval of intervals) {
    const end = interval.endedAt as number;
    let cursor = interval.startedAt;
    let modeId = activeModeAt(transitions, cursor);
    if (!modeId) return null;
    for (const transition of transitions) {
      if (transition.occurredAt <= cursor || transition.occurredAt >= end) continue;
      addWeight(weights, modeId, transition.occurredAt - cursor);
      cursor = transition.occurredAt;
      modeId = transition.toInteractionModeId;
    }
    addWeight(weights, modeId, end - cursor);
  }
  return weights;
}

function turnWeights(
  transitions: readonly Transition[],
  turns: readonly TranscriptTurn[],
  materialTurnIds: readonly string[],
) {
  if (!materialTurnIds.length) return null;
  const turnsById = new Map(turns.map((turn) => [turn.turnId, turn]));
  const weights = new Map<string, number>();
  for (const turnId of materialTurnIds) {
    const turn = turnsById.get(turnId);
    if (!turn || turn.speaker !== "specialist") throw new Error(`Material turn ${turnId} is not an authoritative specialist turn.`);
    const modeId = turn.overrideInteractionModeId ?? activeModeAt(transitions, turn.occurredAt);
    if (!modeId) return null;
    addWeight(weights, modeId, 1);
  }
  return weights;
}

function shares(weights: Map<string, number>, registryModeIds: readonly string[]) {
  const allowed = new Set(registryModeIds);
  if ([...weights.keys()].some((modeId) => !allowed.has(modeId))) return [];
  const total = [...weights.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  const ordered = registryModeIds.flatMap((interactionModeId) => {
    const weight = weights.get(interactionModeId) ?? 0;
    return weight > 0 ? [{ interactionModeId, weight }] : [];
  });
  let assigned = 0;
  return ordered.map((item, index) => {
    const basisPoints = index === ordered.length - 1
      ? 10_000 - assigned
      : Math.round((item.weight / total) * 10_000);
    assigned += basisPoints;
    return { interactionModeId: item.interactionModeId, basisPoints, weight: item.weight, total };
  });
}

export function classifyInteractionModePractice(input: {
  registryModeIds: readonly string[];
  transitions: readonly Transition[];
  timerIntervals: readonly TimerInterval[];
  turns: readonly TranscriptTurn[];
  evidence: InteractionModeClassificationInput;
}): InteractionModeClassification {
  const evidence = interactionModeClassificationInputSchema.parse(input.evidence);
  const transitions = [...input.transitions].sort((left, right) => left.occurredAt - right.occurredAt || left.toRevision - right.toRevision);
  const turnsById = new Map(input.turns.map((turn) => [turn.turnId, turn]));
  for (const turnId of evidence.materialSpecialistTurnIds) {
    const turn = turnsById.get(turnId);
    if (!turn || turn.speaker !== "specialist") throw new Error(`Material turn ${turnId} is not an authoritative specialist turn.`);
  }
  const materialTurns = new Set(evidence.materialSpecialistTurnIds);
  const hasMaterialOverride = input.turns.some((turn) => (
    materialTurns.has(turn.turnId) && Boolean(turn.overrideInteractionModeId)
  ));
  const timed = hasMaterialOverride ? null : timerWeights(transitions, input.timerIntervals);
  const method: InteractionModeClassificationMethod = timed ? "active_timer_seconds" : "material_specialist_turn_share";
  const weighted = timed ?? turnWeights(transitions, input.turns, evidence.materialSpecialistTurnIds);
  const computedShares = weighted ? shares(weighted, input.registryModeIds) : [];
  const highestHintRung = evidence.assistanceEvents.reduce<typeof hintRungs[number]>((highest, event) => (
    hintRungs.indexOf(event.rung) > hintRungs.indexOf(highest) ? event.rung : highest
  ), "none");
  if (!weighted || !computedShares.length) {
    return {
      schemaVersion: 1,
      primaryPracticeModeId: "unrecorded",
      modeShares: [],
      method: "unrecorded",
      hadMentorAssistance: highestHintRung !== "none",
      highestHintRung,
      provenance: "unrecorded",
      initialModeId: transitions[0]?.toInteractionModeId ?? null,
      transitionCount: transitions.length,
      materialSpecialistTurnIds: [...evidence.materialSpecialistTurnIds],
    };
  }
  const primary = computedShares.find((share) => share.weight * 5 >= share.total * 3);
  return {
    schemaVersion: 1,
    primaryPracticeModeId: primary?.interactionModeId ?? "mixed",
    modeShares: computedShares.map(({ interactionModeId, basisPoints }) => ({ interactionModeId, basisPoints })),
    method,
    hadMentorAssistance: computedShares.some((share) => share.interactionModeId === "mentor") || highestHintRung !== "none",
    highestHintRung,
    provenance: evidence.provenance,
    initialModeId: transitions[0]?.toInteractionModeId ?? null,
    transitionCount: transitions.length,
    materialSpecialistTurnIds: [...evidence.materialSpecialistTurnIds],
  };
}

export async function interactionModeClassificationFingerprint(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
