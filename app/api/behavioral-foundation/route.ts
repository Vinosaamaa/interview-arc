import { getBehavioralFoundationStatus } from "../../../db/behavioral-evidence";
import { resolveOwnerId } from "../../../db/owner";
import { toRouteErrorMessage } from "../route-helpers";

export async function GET(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    return Response.json(await getBehavioralFoundationStatus(ownerId));
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
