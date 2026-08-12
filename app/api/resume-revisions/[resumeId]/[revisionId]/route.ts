import { getResumeRevision } from "../../../../../db/resume-revisions";
import { resolveOwnerId } from "../../../../../db/owner";
import { resumeRevisionResponseSchema, resumeStableIdSchema } from "../../../../resume-revision-contract";
import { toRouteErrorMessage } from "../../../route-helpers";
import { ZodError } from "zod";

export async function GET(
  request: Request,
  context: { params: Promise<{ resumeId: string; revisionId: string }> },
) {
  try {
    const ownerId = await resolveOwnerId(request);
    const params = await context.params;
    const resumeId = resumeStableIdSchema.parse(params.resumeId);
    const revisionId = resumeStableIdSchema.parse(params.revisionId);
    const result = await getResumeRevision(ownerId, resumeId, revisionId);
    if (!result.found) {
      return Response.json({ error: "Resume revision not found." }, {
        status: 404,
        headers: { "cache-control": "private, no-store" },
      });
    }
    return Response.json(resumeRevisionResponseSchema.parse(result), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "The resume revision request is invalid." }, {
        status: 400,
        headers: { "cache-control": "private, no-store" },
      });
    }
    return Response.json({ error: toRouteErrorMessage(error) }, {
      status: 500,
      headers: { "cache-control": "private, no-store" },
    });
  }
}
