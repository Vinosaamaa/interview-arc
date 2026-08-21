import { env } from "cloudflare:workers";

import { InterviewPackageError } from "../../../../../../db/interview-packages";
import { serveInterviewPackageSource } from "../../../../../../db/interview-package-storage";
import { resolveOwnerId } from "../../../../../../db/owner";
import { toRouteErrorMessage } from "../../../../route-helpers";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" };

export async function GET(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  try {
    const ownerId = await resolveOwnerId(request);
    const { sourceId } = await context.params;
    return await serveInterviewPackageSource(ownerId, sourceId, request.headers.get("range"), env.AUDIO);
  } catch (error) {
    const status = error instanceof InterviewPackageError ? error.retryable ? 503 : error.code.endsWith("not_found") ? 404 : 409 : 500;
    return Response.json({ error: toRouteErrorMessage(error) }, { status, headers: PRIVATE_HEADERS });
  }
}
