import registryData from "../data/interaction-modes.json" with { type: "json" };
import type { D1TransactionalFailureKind } from "./d1-transactional-guard";

export type PracticeSpecialty = "leetcode" | "system_design" | "behavioral";
export type InteractionModePhase = "fresh_attempt" | "active_attempt" | "review";

export type InteractionModeDefinition = {
  id: string;
  label: string;
  description: string;
  helpPolicy: string;
  supportedSpecialties: readonly PracticeSpecialty[];
  selectableWhen: readonly InteractionModePhase[];
  aliases: readonly string[];
  defaultFor: readonly string[];
  deprecated: boolean;
};

export type InteractionModeRegistry = {
  schemaVersion: 1;
  registryVersion: string;
  compatibility: {
    unknownHistoricalMode: "preserve_as_unknown";
    deprecatedNewSelection: "reject";
    aliases: "normalize_without_persisting_alias";
  };
  modes: readonly InteractionModeDefinition[];
};

export class InteractionModeError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "InteractionModeError";
    this.code = code;
    this.details = details;
  }
}

export function classifyInteractionModeAtomicFailure(kind: D1TransactionalFailureKind) {
  return kind !== "unknown"
    ? {
        code: "interaction_mode_atomic_conflict",
        message: "The interaction-mode preconditions conflicted, so no state was changed.",
        retryable: false,
      }
    : {
        code: "interaction_mode_atomic_write_failed",
        message: "The interaction-mode state and transition were not committed.",
        retryable: true,
      };
}

export const interactionModeRegistry = registryData as InteractionModeRegistry;
export const interactionModeReadBatchSize = 200;

export function interactionModeActivityIdBatches(activityIds: readonly string[]) {
  const ids = [...new Set(activityIds.filter(Boolean))];
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += interactionModeReadBatchSize) {
    batches.push(ids.slice(index, index + interactionModeReadBatchSize));
  }
  return batches;
}

function normalizedModeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function resolveInteractionMode(
  requestedIdOrAlias: string,
  specialty: PracticeSpecialty,
  phase: InteractionModePhase,
  registry: InteractionModeRegistry = interactionModeRegistry,
) {
  const requested = normalizedModeName(requestedIdOrAlias);
  const mode = registry.modes.find((candidate) => (
    candidate.id === requested
    || candidate.aliases.some((alias) => normalizedModeName(alias) === requested)
  ));
  if (!mode) {
    throw new InteractionModeError(
      "interaction_mode_unknown",
      `Interaction mode “${requestedIdOrAlias}” is not present in registry ${registry.registryVersion}.`,
      { requestedInteractionModeId: requestedIdOrAlias, registryVersion: registry.registryVersion },
    );
  }
  if (mode.deprecated) {
    throw new InteractionModeError(
      "interaction_mode_deprecated",
      `Interaction mode “${mode.id}” is retained for history but cannot be newly selected.`,
      { interactionModeId: mode.id, registryVersion: registry.registryVersion },
    );
  }
  if (!mode.supportedSpecialties.includes(specialty)) {
    throw new InteractionModeError(
      "interaction_mode_unsupported_specialty",
      `Interaction mode “${mode.id}” does not support ${specialty}.`,
      { interactionModeId: mode.id, specialty, registryVersion: registry.registryVersion },
    );
  }
  if (!mode.selectableWhen.includes(phase)) {
    throw new InteractionModeError(
      "interaction_mode_unavailable_for_phase",
      `Interaction mode “${mode.id}” cannot be selected during ${phase}.`,
      { interactionModeId: mode.id, phase, registryVersion: registry.registryVersion },
    );
  }
  return {
    mode,
    requested,
    normalizedFrom: requested === mode.id ? null : requestedIdOrAlias,
    registryVersion: registry.registryVersion,
  };
}

export async function interactionModeMutationFingerprint(input: {
  activityId: string;
  interactionModeId: string;
  expectedRevision: number;
  triggerTurnId?: string;
  source: "explicit_user_instruction" | "workflow_transition";
  reason: string;
  occurredAt: number;
  authorization: "explicit_user_instruction";
}) {
  const canonical = JSON.stringify({
    activityId: input.activityId,
    interactionModeId: input.interactionModeId,
    expectedRevision: input.expectedRevision,
    triggerTurnId: input.triggerTurnId ?? null,
    source: input.source,
    reason: input.reason,
    occurredAt: input.occurredAt,
    authorization: input.authorization,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
