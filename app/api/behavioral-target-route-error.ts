import { z } from "zod";

import { BehavioralTargetProfileError } from "../../db/behavioral-target-profile";
import { toRouteErrorMessage } from "./route-helpers";

export function behavioralTargetRouteError(error: unknown, invalidRequestMessage: string) {
  if (error instanceof BehavioralTargetProfileError) {
    const conflict = error.code.includes("conflict")
      || error.code.includes("not_found")
      || error.code === "behavioral_target_migration_only";
    return Response.json(
      { error: error.message, code: error.code, retryable: error.retryable },
      { status: conflict ? 409 : 400 },
    );
  }
  if (error instanceof z.ZodError) {
    return Response.json({ error: invalidRequestMessage, retryable: false }, { status: 400 });
  }
  return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
}
