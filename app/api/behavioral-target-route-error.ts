import { z } from "zod";

import { BehavioralTargetProfileError } from "../../db/behavioral-target-profile";
import { toRouteErrorMessage } from "./route-helpers";

export function behavioralTargetRouteError(error: unknown, invalidRequestMessage: string) {
  if (error instanceof BehavioralTargetProfileError) {
    const status = error.code.includes("not_found")
      ? 404
      : error.code.includes("conflict") || error.code === "behavioral_target_migration_only"
        ? 409
        : 400;
    return Response.json(
      { error: error.message, code: error.code, retryable: error.retryable },
      { status },
    );
  }
  if (error instanceof z.ZodError) {
    return Response.json({ error: invalidRequestMessage, retryable: false }, { status: 400 });
  }
  return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
}
