import { getResumeLibrary } from "../../../db/resume-revisions";
import { resolveOwnerId } from "../../../db/owner";
import { resumeLibrarySchema } from "../../resume-library-contract";
import { toRouteErrorMessage } from "../route-helpers";

export async function GET(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const library = resumeLibrarySchema.parse(await getResumeLibrary(ownerId));
    return Response.json(library, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, {
      status: 500,
      headers: { "cache-control": "private, no-store" },
    });
  }
}
