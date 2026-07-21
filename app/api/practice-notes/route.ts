import { addPracticeNote, deletePracticeNote, updatePracticeNote, type NoteKind } from "../../../db/durable-practice";
import { resolveOwnerId } from "../../../db/owner";
import { toRouteErrorMessage } from "../route-helpers";

const NOTE_KINDS: NoteKind[] = ["remember", "insight", "mistake", "pattern", "question"];

function validBody(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 20_000;
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { activityId?: string; date?: string; body?: string; kind?: NoteKind };
    if (!payload.activityId || !payload.date || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) || !validBody(payload.body)) {
      return Response.json({ error: "Activity, date, and note text are required." }, { status: 400 });
    }
    const kind = payload.kind && NOTE_KINDS.includes(payload.kind) ? payload.kind : "remember";
    const ownerId = await resolveOwnerId(request);
    const now = Date.now();
    const note = {
      id: crypto.randomUUID(),
      activityId: payload.activityId,
      date: payload.date,
      body: payload.body.trim(),
      kind,
      pinned: true,
      createdAt: now,
      updatedAt: now,
    };
    await addPracticeNote(ownerId, note, now);
    return Response.json(note, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as { noteId?: string; body?: string };
    if (!payload.noteId || !validBody(payload.body)) {
      return Response.json({ error: "Note ID and note text are required." }, { status: 400 });
    }
    const ownerId = await resolveOwnerId(request);
    const now = Date.now();
    await updatePracticeNote(ownerId, payload.noteId, payload.body.trim(), now);
    return Response.json({ noteId: payload.noteId, body: payload.body.trim(), updatedAt: now }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const noteId = new URL(request.url).searchParams.get("noteId")?.trim();
    if (!noteId) return Response.json({ error: "A noteId is required." }, { status: 400 });
    const ownerId = await resolveOwnerId(request);
    await deletePracticeNote(ownerId, noteId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
