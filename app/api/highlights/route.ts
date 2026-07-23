import { addContentHighlight, deleteContentHighlight, readContentHighlights, updateContentHighlightNote, type HighlightScope } from "../../../db/content-highlights";
import { resolveOwnerId } from "../../../db/owner";
import { toRouteErrorMessage } from "../route-helpers";

function validScope(value: string): value is HighlightScope { return value === "activity" || value === "solution"; }
function validColor(value: string | undefined): value is "yellow" | "green" | "pink" { return value === "yellow" || value === "green" || value === "pink"; }

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scopeType = url.searchParams.get("scopeType") ?? "";
    const scopeId = url.searchParams.get("scopeId")?.trim() ?? "";
    if (!validScope(scopeType) || !scopeId) return Response.json({ error: "A valid highlight scope is required." }, { status: 400 });
    const rows = await readContentHighlights(await resolveOwnerId(request), scopeType, scopeId);
    return Response.json(rows, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { scopeType?: string; scopeId?: string; quote?: string; prefix?: string; suffix?: string; color?: string; note?: string };
    if (!body.scopeType || !validScope(body.scopeType) || !body.scopeId?.trim() || !body.quote?.trim() || body.quote.length > 100_000) {
      return Response.json({ error: "Scope and selected text are required." }, { status: 400 });
    }
    const now = Date.now();
    const row = { id: crypto.randomUUID(), scopeType: body.scopeType, scopeId: body.scopeId.trim(), quote: body.quote, prefix: (body.prefix ?? "").slice(-120), suffix: (body.suffix ?? "").slice(0, 120), color: validColor(body.color) ? body.color : "yellow" as const, note: (body.note ?? "").trim().slice(0, 4_000), createdAt: now, updatedAt: now };
    await addContentHighlight(await resolveOwnerId(request), row);
    return Response.json(row, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) { return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: string; note?: string };
    const id = body.id?.trim() ?? "";
    if (!id || typeof body.note !== "string" || body.note.length > 4_000) {
      return Response.json({ error: "A highlight ID and note are required." }, { status: 400 });
    }
    const row = await updateContentHighlightNote(await resolveOwnerId(request), id, body.note.trim(), Date.now());
    if (!row) return Response.json({ error: "Highlight not found." }, { status: 404 });
    return Response.json(row, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return Response.json({ error: "A highlight ID is required." }, { status: 400 });
    await deleteContentHighlight(await resolveOwnerId(request), id);
    return new Response(null, { status: 204 });
  } catch (error) { return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 }); }
}
