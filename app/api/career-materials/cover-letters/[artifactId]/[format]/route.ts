import { env } from "cloudflare:workers";
import { resolveOwnerId } from "../../../../../../db/owner";
import { servePrivateCoverLetterFile } from "../../../../../../mcp-worker/cover-letter-artifact-download";

export async function GET(
  request: Request,
  context: { params: Promise<{ artifactId: string; format: string }> },
) {
  const ownerId = await resolveOwnerId(request);
  const { artifactId, format } = await context.params;
  return servePrivateCoverLetterFile(ownerId, artifactId, format, env.AUDIO);
}
