import { LoopError, readLoopRoleBriefSource } from "../../../../db/loops";
import { resolveOwnerId } from "../../../../db/owner";
import { toRouteErrorMessage } from "../../route-helpers";

const privateHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

export async function GET(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const url = new URL(request.url);
    const loopId = url.searchParams.get("loopId")?.trim();
    const revisionText = url.searchParams.get("roleBriefRevision")?.trim();
    if (!loopId) {
      return Response.json({ error: "Choose a Loop before opening its job description." }, {
        status: 400,
        headers: privateHeaders,
      });
    }
    const roleBriefRevision = revisionText ? Number(revisionText) : undefined;
    if (revisionText && (!Number.isInteger(roleBriefRevision) || Number(roleBriefRevision) <= 0)) {
      return Response.json({ error: "The Role Brief revision must be a positive integer." }, {
        status: 400,
        headers: privateHeaders,
      });
    }
    const source = await readLoopRoleBriefSource(ownerId, { loopId, roleBriefRevision });
    return Response.json(source, { headers: privateHeaders });
  } catch (error) {
    const status = error instanceof LoopError && ["loop_not_found", "loop_role_brief_not_found"].includes(error.code)
      ? 404
      : 500;
    return Response.json({ error: toRouteErrorMessage(error) }, { status, headers: privateHeaders });
  }
}
