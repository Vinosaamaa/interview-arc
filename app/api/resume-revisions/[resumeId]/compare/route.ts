import { compareResumeRevisions } from "../../../../../db/resume-revisions";
import { resolveOwnerId } from "../../../../../db/owner";
import { resumeRevisionComparisonSchema, resumeStableIdSchema } from "../../../../resume-revision-contract";
import { toRouteErrorMessage } from "../../../route-helpers";
import { ZodError } from "zod";

export async function GET(
  request: Request,
  context: { params: Promise<{ resumeId: string }> },
) {
  try {
    const ownerId = await resolveOwnerId(request);
    const resumeId = resumeStableIdSchema.parse((await context.params).resumeId);
    const url = new URL(request.url);
    const fromRevisionId = resumeStableIdSchema.parse(url.searchParams.get("from"));
    const toRevisionId = resumeStableIdSchema.parse(url.searchParams.get("to"));
    const result = await compareResumeRevisions(ownerId, resumeId, fromRevisionId, toRevisionId);
    if (!result.found) {
      return Response.json({ error: "Resume comparison not found." }, {
        status: 404,
        headers: { "cache-control": "private, no-store" },
      });
    }
    return Response.json(resumeRevisionComparisonSchema.parse(result), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "The resume comparison request is invalid." }, {
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
