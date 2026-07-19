import { readLiveState } from "../../../db/live-state";
import { resolveOwnerId } from "../../../db/owner";
import { toRouteErrorMessage } from "../route-helpers";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: "A valid ?date=YYYY-MM-DD is required." }, { status: 400 });
    }
    const ownerId = await resolveOwnerId(request);
    const state = await readLiveState(ownerId, date);
    return Response.json(state);
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
