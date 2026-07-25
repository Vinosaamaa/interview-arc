import { readTimerSyncState } from "../../../db/live-state";
import { resolveOwnerId } from "../../../db/owner";
import { toRouteErrorMessage } from "../route-helpers";

export async function GET(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    return Response.json(await readTimerSyncState(ownerId), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
