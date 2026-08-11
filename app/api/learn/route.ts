import {
  queryLearningEvidence,
  queryLearningJourney,
  queryLearningSessions,
  queryLearningWorkspace,
} from "../../../db/learn";
import { resolveOwnerId } from "../../../db/owner";
import { toRouteErrorMessage } from "../route-helpers";

function optionalSearchParam(url: URL, name: string) {
  return url.searchParams.get(name)?.trim() || undefined;
}

export async function GET(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const url = new URL(request.url);
    const courseId = optionalSearchParam(url, "courseId");
    const lessonId = optionalSearchParam(url, "lessonId");
    const sessionId = optionalSearchParam(url, "sessionId");
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const [workspace, sessions, evidence, journey] = await Promise.all([
      queryLearningWorkspace(ownerId, { courseId, lessonId, includeArchived }),
      queryLearningSessions(ownerId, { lessonId, sessionId, includeCompleted: true }),
      queryLearningEvidence(ownerId, { lessonId, sessionId }),
      queryLearningJourney(ownerId, { courseId }),
    ]);
    return Response.json(
      { workspace, sessions: sessions.sessions, evidence, journey },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
