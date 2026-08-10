import { env } from "cloudflare:workers";
import { resolveOwnerId } from "../../../../../../db/owner";
import { servePrivateResumeFile } from "../../../../../../mcp-worker/resume-library-download";

export async function GET(
  request: Request,
  context: { params: Promise<{ resumeId: string; revisionId: string; format: string }> },
) {
  const ownerId = await resolveOwnerId(request);
  const { resumeId, revisionId, format } = await context.params;
  return servePrivateResumeFile(ownerId, resumeId, revisionId, format, env.AUDIO);
}
