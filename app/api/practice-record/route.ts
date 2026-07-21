import { readActivityPracticeRecord } from "../../../db/durable-practice";
import { resolveOwnerId } from "../../../db/owner";
import { toRouteErrorMessage } from "../route-helpers";

export async function GET(request: Request) {
  try {
    const activityId = new URL(request.url).searchParams.get("activityId")?.trim();
    if (!activityId) return Response.json({ error: "An activityId is required." }, { status: 400 });
    const ownerId = await resolveOwnerId(request);
    const record = await readActivityPracticeRecord(ownerId, activityId);
    return Response.json({
      turns: record.turns.map((turn) => ({
        activityId: turn.activityId,
        turnId: turn.turnId,
        specialty: turn.specialty,
        speaker: turn.speaker,
        body: turn.body,
        source: turn.source,
        sequence: turn.sequence,
        occurredAt: turn.occurredAt,
        updatedAt: turn.updatedAt,
      })),
      notes: record.notes.map((note) => ({
        id: note.id,
        activityId: note.activityId,
        date: note.date,
        body: note.body,
        kind: note.kind,
        pinned: note.pinned,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      })),
      audioClips: record.audioClips.map((clip) => ({
        id: clip.id,
        activityId: clip.activityId,
        transcriptTurnId: clip.transcriptTurnId,
        filename: clip.filename,
        mimeType: clip.mimeType,
        label: clip.label,
        durationSeconds: clip.durationSeconds,
        status: clip.status,
      })),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
