import { env } from "cloudflare:workers";
import { resolveOwnerId } from "../../../../../../db/owner";
import { generateLectureAudio } from "../../../../../../db/lecture-audio";
import { lectureId } from "../../../../../../db/lecture-policy";
import { lectureRouteError } from "../../../route";

type Context = { params: Promise<{ id: string; chunk: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const { id, chunk } = await context.params;
    return Response.json(await generateLectureAudio(env.DB, env.AUDIO, await resolveOwnerId(request), lectureId.parse(id), Number(chunk), env.OPENAI_API_KEY),
      { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return lectureRouteError(error); }
}
