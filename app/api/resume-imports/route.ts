import { getRecentResumeImports } from "../../../db/resume-revisions";
import { resolveOwnerId } from "../../../db/owner";
import { recentResumeImportsSchema } from "../../resume-import-status-contract";
import { toRouteErrorMessage } from "../route-helpers";

export async function GET(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const imports = recentResumeImportsSchema.parse(await getRecentResumeImports(ownerId));
    return Response.json(imports, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, {
      status: 500,
      headers: { "cache-control": "private, no-store" },
    });
  }
}
