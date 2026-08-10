import { z } from "zod";

import {
  BehavioralTargetPublicSourceError,
  fetchPublicBehavioralTargetSource,
} from "../../../db/behavioral-target-public-source";
import { resolveOwnerId } from "../../../db/owner";
import { toRouteErrorMessage } from "../route-helpers";

const requestSchema = z.object({
  url: z.string().trim().min(1).max(2_000),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

export async function POST(request: Request) {
  try {
    await resolveOwnerId(request);
    const result = await fetchPublicBehavioralTargetSource(requestSchema.parse(await request.json()));
    return Response.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof BehavioralTargetPublicSourceError) {
      const status = error.code.endsWith("_invalid") ? 400 : 422;
      return Response.json({ status: "unavailable", error: error.message, code: error.code, retryable: false }, {
        status,
        headers: { "cache-control": "private, no-store" },
      });
    }
    if (error instanceof z.ZodError) return Response.json({ status: "unavailable", error: "Enter a valid public posting URL.", retryable: false }, { status: 400 });
    return Response.json({ status: "unavailable", error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
