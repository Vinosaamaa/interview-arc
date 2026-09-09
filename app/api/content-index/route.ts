import { loadContentIndex } from "../../../db/content";

// worker/index.ts authenticates this route with the same Access gate as `/`.
// Never put private legacy content into a shared or public cache.
export async function GET() {
  try {
    return Response.json(await loadContentIndex(), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Workspace content is temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
