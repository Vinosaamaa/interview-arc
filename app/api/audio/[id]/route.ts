import { env } from "cloudflare:workers";
import { resolveOwnerId } from "../../../../db/owner";
import { deleteActivityAudioClip, readActivityAudioClip } from "../../../../db/durable-practice";
import { toRouteErrorMessage } from "../../route-helpers";

function requestedRange(header: string | null, size: number): { offset: number; length: number } | { suffix: number } | null | undefined {
  if (!header) return undefined;
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : undefined;
  const end = match[2] ? Number(match[2]) : undefined;
  if (start !== undefined && (start >= size || (end !== undefined && start > end))) return null;
  if (start !== undefined && end !== undefined) return { offset: start, length: Math.min(size - start, end - start + 1) };
  if (start !== undefined) return { offset: start, length: size - start };
  if (end !== undefined && end > 0) return { suffix: Math.min(size, end) };
  return null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await resolveOwnerId(request);
    const { id } = await context.params;
    const clip = await readActivityAudioClip(ownerId, id);
    if (!clip || clip.status !== "available") return Response.json({ error: "Audio not found." }, { status: 404 });
    const head = await env.AUDIO.head(clip.objectKey);
    if (!head) return Response.json({ error: "Audio object not found." }, { status: 404 });
    const range = requestedRange(request.headers.get("range"), head.size);
    if (range === null) return new Response(null, { status: 416, headers: { "content-range": `bytes */${head.size}` } });
    const object = await env.AUDIO.get(clip.objectKey, range ? { range } : undefined);
    if (!object?.body) return Response.json({ error: "Audio object not found." }, { status: 404 });
    const servedRange = range
      ? "suffix" in range
        ? { offset: head.size - range.suffix, length: range.suffix }
        : range
      : null;
    const headers = new Headers({
      "content-type": clip.mimeType,
      "content-disposition": `inline; filename="${clip.filename.replaceAll('"', '')}"`,
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      "content-length": String(servedRange?.length ?? object.size),
    });
    if (servedRange) headers.set("content-range", `bytes ${servedRange.offset}-${servedRange.offset + servedRange.length - 1}/${object.size}`);
    return new Response(object.body, { status: servedRange ? 206 : 200, headers });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await resolveOwnerId(request);
    const { id } = await context.params;
    const clip = await readActivityAudioClip(ownerId, id);
    if (!clip) return Response.json({ error: "Audio not found." }, { status: 404 });
    await env.AUDIO.delete(clip.objectKey);
    await deleteActivityAudioClip(ownerId, id);
    return Response.json({ deleted: id });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
