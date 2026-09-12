import { env } from "cloudflare:workers";
import { resolveOwnerId } from "../../../../../db/owner";
import { lectureId } from "../../../../../db/lecture-policy";
import { streamLecture } from "../../../../../db/lecture-stream";
import { lectureRouteError } from "../../route";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return await streamLecture(env.DB, env.AUDIO, await resolveOwnerId(request), lectureId.parse((await context.params).id), request); }
  catch (error) { return lectureRouteError(error); }
}
export const HEAD = GET;
