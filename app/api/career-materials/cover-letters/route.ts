import { careerMaterialsCoverLetterResponseSchema } from "../../../cover-letter-contract";
import { CoverLetterArtifactError, readCoverLetterLibrary } from "../../../../db/cover-letter-artifacts";
import { resolveOwnerId } from "../../../../db/owner";
import { getResumeRevisionReferences } from "../../../../db/resume-revisions";
import { toRouteErrorMessage } from "../../route-helpers";

const NO_STORE = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some((key) => key !== "cursor")) {
      return Response.json({ error: "Only the cover-letter cursor is supported." }, { status: 400, headers: NO_STORE });
    }
    const library = await readCoverLetterLibrary(ownerId, 100, url.searchParams.get("cursor") ?? undefined);
    const references = await getResumeRevisionReferences(
      ownerId,
      library.artifacts.map((artifact) => ({ resumeId: artifact.resumeId, revisionId: artifact.resumeRevisionId })),
    );
    const response = careerMaterialsCoverLetterResponseSchema.parse({
      ...library,
      status: "available",
      stale: false,
      artifacts: library.artifacts.map((artifact) => {
        const resume = references.get(`${artifact.resumeId}\u0000${artifact.resumeRevisionId}`);
        return {
          ...artifact,
          resumeLabel: resume?.label ?? null,
          resumeRevisionKnown: resume?.revisionKnown ?? false,
        };
      }),
    });
    return Response.json(response, { headers: NO_STORE });
  } catch (error) {
    return Response.json(
      { error: toRouteErrorMessage(error) },
      { status: error instanceof CoverLetterArtifactError ? error.status : 500, headers: NO_STORE },
    );
  }
}
