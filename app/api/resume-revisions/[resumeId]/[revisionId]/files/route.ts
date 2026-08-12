import { env } from "cloudflare:workers";
import { resolveOwnerId } from "../../../../../../db/owner";
import { ResumeImportError } from "../../../../../../db/resume-revisions";
import { deletePrivateResumeRevisionFiles } from "../../../../../../mcp-worker/resume-file-deletion";

const privateHeaders = { "cache-control": "private, no-store" };

export async function DELETE(
  request: Request,
  context: { params: Promise<{ resumeId: string; revisionId: string }> },
) {
  try {
    const ownerId = await resolveOwnerId(request);
    const { resumeId, revisionId } = await context.params;
    const receipt = await deletePrivateResumeRevisionFiles(
      ownerId,
      resumeId,
      revisionId,
      request,
      env.AUDIO,
    );
    return Response.json(receipt, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof ResumeImportError) {
      return Response.json({
        error: error.message,
        code: error.code,
        retryable: error.retryable,
      }, { status: error.status, headers: privateHeaders });
    }
    return Response.json({
      error: "The private resume file deletion could not be completed. Retry the exact operation receipt.",
      code: "resume_file_deletion_unavailable",
      retryable: true,
    }, { status: 503, headers: privateHeaders });
  }
}
