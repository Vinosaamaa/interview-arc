import { env } from "cloudflare:workers";
import { resolveOwnerId } from "../../../db/owner";
import { listLectures, readLecture, saveLecture, saveLectureCursor } from "../../../db/lectures";
import { LectureError, lectureId, lectureCursorSchema, saveLectureSchema } from "../../../db/lecture-policy";
import { ZodError } from "zod";

export function lectureRouteError(error: unknown) {
  return Response.json({ error: error instanceof LectureError ? error.message : error instanceof ZodError ? "Invalid lecture request. Check the script, section IDs and position." : "Lecture request failed. Retry without changing its identity." },
    { status: error instanceof LectureError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500, headers: { "cache-control": "private, no-store" } });
}
export async function GET(request: Request) {
  try {
    const owner = await resolveOwnerId(request), url = new URL(request.url), id = url.searchParams.get("id");
    const value = id ? await readLecture(env.DB, owner, lectureId.parse(id), url.searchParams.has("chunk") ? Number(url.searchParams.get("chunk")) : undefined) : { lectures: await listLectures(env.DB, owner) };
    return Response.json({ ...value, speechConfigured: Boolean(env.OPENAI_API_KEY) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return lectureRouteError(error); }
}
export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 512000) throw new LectureError("Lecture request is too large.", 413);
    const body = JSON.parse(text), owner = await resolveOwnerId(request);
    const value = body.action === "cursor" ? await saveLectureCursor(env.DB, owner, lectureCursorSchema.parse(body.input))
      : body.action === "save" ? await saveLecture(env.DB, owner, saveLectureSchema.parse(body.input))
        : (() => { throw new LectureError("Unknown lecture action.", 400); })();
    return Response.json(value, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return lectureRouteError(error); }
}
