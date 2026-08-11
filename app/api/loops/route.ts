import { queryLoops, queryRoleBriefMigrationInbox } from "../../../db/loops";
import { resolveOwnerId } from "../../../db/owner";
import { toRouteErrorMessage } from "../route-helpers";

export async function GET(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const [loops, migrationInbox] = await Promise.all([
      queryLoops(ownerId, { includeArchived }),
      queryRoleBriefMigrationInbox(ownerId, {}),
    ]);
    return Response.json(
      { ...loops, migrationInbox: migrationInbox.items },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
