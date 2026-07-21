import {
  applyTimerAction,
  readLiveState,
  removeExtraActivity,
  removeLiveSession,
  setActivityNote,
  setOutcome,
  setPublicationStatus,
  upsertExtraActivity,
  upsertLiveSession,
  type OutcomeValue,
  type PublicationStatusValue,
  type TimerAction,
  type TimerKind,
} from "../../../db/live-state";
import { resolveOwnerId } from "../../../db/owner";
import { toRouteErrorMessage } from "../route-helpers";

type Mutation =
  | {
      type: "timer";
      subjectId: string;
      kind: TimerKind;
      action: TimerAction;
      sessionId?: string;
      activityIds?: string[];
    }
  | { type: "outcome"; activityId: string; outcome: OutcomeValue | null; sessionId?: string }
  | { type: "publication-status"; activityId: string; status: PublicationStatusValue; artifactPath?: string }
  | { type: "activity-note"; activityId: string; note: string }
  | { type: "extra-upsert"; activity: { id: string; date: string } & Record<string, unknown> }
  | { type: "extra-remove"; id: string }
  | { type: "session-upsert"; session: { id: string; date: string } & Record<string, unknown> }
  | { type: "session-remove"; id: string; activityIds: string[] };

const TIMER_ACTIONS: TimerAction[] = ["start", "pause", "finish"];
const TIMER_KINDS: TimerKind[] = ["activity", "session"];
const PUBLICATION_STATUSES: PublicationStatusValue[] = ["draft", "ready", "published"];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { date?: string; mutation?: Mutation };
    const date = body.date;
    const mutation = body.mutation;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: "A valid `date` (YYYY-MM-DD) is required." }, { status: 400 });
    }
    if (!mutation || typeof mutation !== "object") {
      return Response.json({ error: "A `mutation` object is required." }, { status: 400 });
    }

    const ownerId = await resolveOwnerId(request);
    const now = Date.now();

    switch (mutation.type) {
      case "timer": {
        if (!mutation.subjectId || !TIMER_KINDS.includes(mutation.kind) || !TIMER_ACTIONS.includes(mutation.action)) {
          return Response.json({ error: "Invalid timer mutation." }, { status: 400 });
        }
        await applyTimerAction(ownerId, mutation.subjectId, mutation.kind, mutation.action, now, {
          sessionId: mutation.sessionId,
          activityIds: mutation.activityIds,
        });
        break;
      }
      case "outcome": {
        if (!mutation.activityId) {
          return Response.json({ error: "Invalid outcome mutation." }, { status: 400 });
        }
        await setOutcome(ownerId, mutation.activityId, mutation.outcome ?? null, now, mutation.sessionId);
        break;
      }
      case "publication-status": {
        if (!mutation.activityId || !PUBLICATION_STATUSES.includes(mutation.status)) {
          return Response.json({ error: "Invalid publication-status mutation." }, { status: 400 });
        }
        await setPublicationStatus(
          ownerId,
          mutation.activityId,
          date,
          mutation.status,
          now,
          mutation.artifactPath,
        );
        break;
      }
      case "activity-note": {
        if (!mutation.activityId || typeof mutation.note !== "string" || mutation.note.length > 20_000) {
          return Response.json({ error: "Invalid activity-note mutation." }, { status: 400 });
        }
        await setActivityNote(ownerId, mutation.activityId, date, mutation.note, now);
        break;
      }
      case "extra-upsert": {
        if (!mutation.activity?.id || !mutation.activity?.date) {
          return Response.json({ error: "Invalid extra activity." }, { status: 400 });
        }
        await upsertExtraActivity(ownerId, mutation.activity, now);
        break;
      }
      case "extra-remove": {
        if (!mutation.id) return Response.json({ error: "Missing activity id." }, { status: 400 });
        await removeExtraActivity(ownerId, mutation.id);
        break;
      }
      case "session-upsert": {
        if (!mutation.session?.id || !mutation.session?.date) {
          return Response.json({ error: "Invalid session." }, { status: 400 });
        }
        await upsertLiveSession(ownerId, mutation.session, now);
        break;
      }
      case "session-remove": {
        if (!mutation.id) return Response.json({ error: "Missing session id." }, { status: 400 });
        await removeLiveSession(ownerId, mutation.id, mutation.activityIds ?? []);
        break;
      }
      default:
        return Response.json({ error: "Unknown mutation type." }, { status: 400 });
    }

    const state = await readLiveState(ownerId, date);
    return Response.json(state);
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
