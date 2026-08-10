export type TypedExchangeTurn = {
  turnId: string;
  specialty: string;
  speaker: string;
  body: string;
  source: string;
  sequence: number;
  occurredAt: number;
  updatedAt: number;
};

export class TypedExchangeDeletionError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "TypedExchangeDeletionError";
    this.code = code;
    this.details = details;
  }
}

type TypedExchangeIndex = {
  byId: Map<string, TypedExchangeTurn>;
  bySequence: Map<number, TypedExchangeTurn[]>;
};

function indexTypedExchangeTurns(turns: TypedExchangeTurn[]): TypedExchangeIndex {
  const byId = new Map<string, TypedExchangeTurn>();
  const bySequence = new Map<number, TypedExchangeTurn[]>();
  for (const turn of turns) {
    byId.set(turn.turnId, turn);
    const atSequence = bySequence.get(turn.sequence) ?? [];
    atSequence.push(turn);
    bySequence.set(turn.sequence, atSequence);
  }
  return { byId, bySequence };
}

function isCompatibleTypedReply(userTurn: TypedExchangeTurn, candidate: TypedExchangeTurn | undefined) {
  return Boolean(
    candidate
    && candidate.sequence === userTurn.sequence + 1
    && candidate.speaker === "specialist"
    && candidate.source === "codex"
    && candidate.specialty === userTurn.specialty,
  );
}

function resolveTypedExchangePairFromIndex(
  index: TypedExchangeIndex,
  userTurnId: string,
  responseTurnId?: string,
) {
  const userTurn = index.byId.get(userTurnId);
  if (!userTurn) {
    throw new TypedExchangeDeletionError(
      "typed_exchange_not_found",
      "That owner-scoped typed user turn does not exist in this activity.",
    );
  }
  if (userTurn.speaker !== "user" || userTurn.source !== "codex") {
    throw new TypedExchangeDeletionError(
      "typed_exchange_source_mismatch",
      "Only a typed Codex user exchange can be removed with this operation.",
    );
  }

  const adjacent = index.bySequence.get(userTurn.sequence + 1) ?? [];
  const responseTurn = responseTurnId
    ? index.byId.get(responseTurnId)
    : (() => {
      const compatible = adjacent.filter((candidate) => isCompatibleTypedReply(userTurn, candidate));
      return compatible.length === 1 ? compatible[0] : undefined;
    })();
  if (!isCompatibleTypedReply(userTurn, responseTurn)) {
    throw new TypedExchangeDeletionError(
      "typed_exchange_reply_mismatch",
      "The exact adjacent typed specialist reply could not be identified safely.",
    );
  }
  return {
    userTurn,
    responseTurn: responseTurn!,
    revision: Math.max(userTurn.updatedAt, responseTurn!.updatedAt),
  };
}

export function resolveTypedExchangePair(
  turns: TypedExchangeTurn[],
  userTurnId: string,
  responseTurnId?: string,
) {
  return resolveTypedExchangePairFromIndex(indexTypedExchangeTurns(turns), userTurnId, responseTurnId);
}

export function listTypedExchangePairs(turns: TypedExchangeTurn[]) {
  const index = indexTypedExchangeTurns(turns);
  return turns
    .filter((turn) => turn.speaker === "user" && turn.source === "codex")
    .flatMap((turn) => {
      try {
        const pair = resolveTypedExchangePairFromIndex(index, turn.turnId);
        return [{
          userTurnId: pair.userTurn.turnId,
          responseTurnId: pair.responseTurn.turnId,
          specialty: pair.userTurn.specialty,
          revision: pair.revision,
        }];
      } catch {
        return [];
      }
    });
}

export async function typedExchangeDeletionFingerprint(input: {
  activityId: string;
  userTurnId: string;
  responseTurnId?: string;
  expectedRevision: number;
  authorization: "explicit_user_instruction";
  reason: string;
}) {
  const canonical = JSON.stringify({
    activityId: input.activityId,
    userTurnId: input.userTurnId,
    responseTurnId: input.responseTurnId ?? null,
    expectedRevision: input.expectedRevision,
    authorization: input.authorization,
    reason: input.reason,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
