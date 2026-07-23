import {
  addContentHighlightNote,
  deleteContentHighlightNote,
  updateContentHighlightNote,
} from "../../../db/content-highlights";
import { resolveOwnerId } from "../../../db/owner";
import { toRouteErrorMessage } from "../route-helpers";

const MAX_NOTE_LENGTH = 4_000;

export async function POST(request: Request) {
  try {
    const body = await request.json() as { highlightId?: string; body?: string };
    const highlightId = body.highlightId?.trim() ?? "";
    const noteBody = body.body?.trim() ?? "";
    if (!highlightId || !noteBody || noteBody.length > MAX_NOTE_LENGTH) {
      return Response.json({ error: "A highlight ID and note text are required." }, { status: 400 });
    }
    const now = Date.now();
    const row = await addContentHighlightNote(await resolveOwnerId(request), {
      id: crypto.randomUUID(),
      highlightId,
      body: noteBody,
      createdAt: now,
      updatedAt: now,
    });
    if (!row) return Response.json({ error: "Highlight not found." }, { status: 404 });
    return Response.json(row, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: string; body?: string };
    const id = body.id?.trim() ?? "";
    const noteBody = body.body?.trim() ?? "";
    if (!id || !noteBody || noteBody.length > MAX_NOTE_LENGTH) {
      return Response.json({ error: "A note ID and note text are required." }, { status: 400 });
    }
    const row = await updateContentHighlightNote(await resolveOwnerId(request), id, noteBody, Date.now());
    if (!row) return Response.json({ error: "Highlight note not found." }, { status: 404 });
    return Response.json(row, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return Response.json({ error: "A note ID is required." }, { status: 400 });
    await deleteContentHighlightNote(await resolveOwnerId(request), id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
