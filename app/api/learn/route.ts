import {
  LearningError,
  controlLearningSession,
  finishLearningSession,
  queryLearningEvidence,
  queryLearningAnalytics,
  queryLearningJourney,
  queryLearningSessions,
  queryLearningWorkspace,
  setLearningHomeworkState,
} from "../../../db/learn";
import { resolveOwnerId } from "../../../db/owner";
import { RouteBodyTooLargeError, readBoundedJson, toRouteErrorMessage } from "../route-helpers";
import { ZodError } from "zod";

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
    const [workspace, sessions, evidence, journey, analytics] = await Promise.all([
      queryLearningWorkspace(ownerId, { courseId, lessonId, includeArchived }),
      queryLearningSessions(ownerId, { lessonId, sessionId, includeCompleted: true }),
      queryLearningEvidence(ownerId, { lessonId, sessionId }),
      queryLearningJourney(ownerId, { courseId }),
      queryLearningAnalytics(ownerId, { courseId }),
    ]);
    return Response.json(
      { workspace, sessions: sessions.sessions, evidence, journey, analytics },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: toRouteErrorMessage(error) },
      { status: 500, headers: { "cache-control": "private, no-store" } },
    );
  }
}

function mutationFailure(error: unknown) {
  const status = error instanceof RouteBodyTooLargeError
    ? 413
    : error instanceof ZodError
      ? 400
      : error instanceof LearningError
        ? 409
        : 500;
  return Response.json({
    error: toRouteErrorMessage(error),
    ...(error instanceof LearningError ? { code: error.code, retryable: error.retryable } : {}),
  }, { status, headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const body = await readBoundedJson(request, 128_000);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json(
        { error: "A Learn mutation object is required." },
        { status: 400, headers: { "cache-control": "private, no-store" } },
      );
    }
    const { action, ...input } = body as Record<string, unknown>;
    const authorizedInput = { ...input, authorization: "explicit_user_instruction" };
    const result = action === "control_session"
      ? await controlLearningSession(ownerId, authorizedInput)
      : action === "finish_session"
        ? await finishLearningSession(ownerId, authorizedInput)
        : action === "set_homework_state"
          ? await setLearningHomeworkState(ownerId, authorizedInput)
          : null;
    if (!result) {
      return Response.json(
        { error: "Unknown Learn mutation action." },
        { status: 400, headers: { "cache-control": "private, no-store" } },
      );
    }
    return Response.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return mutationFailure(error);
  }
}
