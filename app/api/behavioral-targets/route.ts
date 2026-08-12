import {
  BehavioralTargetProfileError,
  queryBehavioralTargetProfiles,
  rejectLegacyTargetProfileWrite,
} from "../../../db/behavioral-target-profile";
import { resolveOwnerId } from "../../../db/owner";
import { toRouteErrorMessage } from "../route-helpers";

function targetError(error: unknown) {
  if (error instanceof BehavioralTargetProfileError) {
    const conflict = error.code.includes("conflict")
      || error.code.includes("not_found")
      || error.code === "behavioral_target_migration_only";
    return Response.json(
      { error: error.message, code: error.code, retryable: error.retryable },
      { status: conflict ? 409 : 400 },
    );
  }
  return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
}

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
    return targetError(error);
  }
}

export async function POST(request: Request) {
  try {
    await resolveOwnerId(request);
    rejectLegacyTargetProfileWrite();
  } catch (error) {
    return targetError(error);
  }
}
