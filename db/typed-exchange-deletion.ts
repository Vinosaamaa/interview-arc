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

export function resolveTypedExchangePair(
  turns: TypedExchangeTurn[],
  userTurnId: string,
  responseTurnId?: string,
) {
  const userTurn = turns.find((turn) => turn.turnId === userTurnId);
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

  const adjacent = turns.filter((turn) => turn.sequence === userTurn.sequence + 1);
  const responseTurn = responseTurnId
    ? adjacent.find((turn) => turn.turnId === responseTurnId)
    : adjacent.length === 1
      ? adjacent[0]
      : undefined;
  if (
    !responseTurn
    || adjacent.length !== 1
    || responseTurn.speaker !== "specialist"
    || responseTurn.source !== "codex"
    || responseTurn.specialty !== userTurn.specialty
  ) {
    throw new TypedExchangeDeletionError(
      "typed_exchange_reply_mismatch",
      "The exact adjacent typed specialist reply could not be identified safely.",
    );
  }
  return {
    userTurn,
    responseTurn,
    revision: Math.max(userTurn.updatedAt, responseTurn.updatedAt),
  };
}

export function listTypedExchangePairs(turns: TypedExchangeTurn[]) {
  return turns
    .filter((turn) => turn.speaker === "user" && turn.source === "codex")
    .flatMap((turn) => {
      try {
        const pair = resolveTypedExchangePair(turns, turn.turnId);
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
  reason: string;
}) {
  const canonical = JSON.stringify({
    activityId: input.activityId,
    userTurnId: input.userTurnId,
    responseTurnId: input.responseTurnId ?? null,
    expectedRevision: input.expectedRevision,
    reason: input.reason,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
