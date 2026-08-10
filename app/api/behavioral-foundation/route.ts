import { getBehavioralFoundationStatus } from "../../../db/behavioral-evidence";
import { resolveOwnerId } from "../../../db/owner";
import { behavioralFoundationStatusSchema } from "../../behavioral-foundation-contract";
import { toRouteErrorMessage } from "../route-helpers";

export async function GET(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const status = behavioralFoundationStatusSchema.parse(await getBehavioralFoundationStatus(ownerId));
    return Response.json(status, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
