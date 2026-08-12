import {
  queryBehavioralTargetProfiles,
  rejectLegacyTargetProfileWrite,
} from "../../../db/behavioral-target-profile";
import { resolveOwnerId } from "../../../db/owner";
import { behavioralTargetRouteError } from "../behavioral-target-route-error";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const targetId = url.searchParams.get("targetId") || undefined;
    const revisionValue = url.searchParams.get("revision");
    const revision = revisionValue ? Number(revisionValue) : undefined;
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const ownerId = await resolveOwnerId(request);
    const result = await queryBehavioralTargetProfiles(ownerId, { targetId, revision, includeArchived });
    return Response.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return behavioralTargetRouteError(error, "The Target Profile request is invalid.");
  }
}

export async function POST(request: Request) {
  try {
    await resolveOwnerId(request);
    rejectLegacyTargetProfileWrite();
  } catch (error) {
    return behavioralTargetRouteError(error, "The Target Profile request is invalid.");
  }
}
