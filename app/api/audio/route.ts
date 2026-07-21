import { env } from "cloudflare:workers";
import { resolveOwnerId } from "../../../db/owner";
import {
  registerActivityAudioClip,
  updateActivityAudioClipStatus,
} from "../../../db/durable-practice";
import { toRouteErrorMessage } from "../route-helpers";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

function safeFilename(value: string) {
  return value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "practice-audio";
}

export async function POST(request: Request) {
  let ownerId = "";
  let clipId = "";
  try {
    ownerId = await resolveOwnerId(request);
    const form = await request.formData();
    const activityId = String(form.get("activityId") ?? "").trim();
    const transcriptTurnId = String(form.get("transcriptTurnId") ?? "").trim() || undefined;
    const label = String(form.get("label") ?? "Practice answer").trim().slice(0, 120) || "Practice answer";
    const file = form.get("file");
    if (!activityId || !(file instanceof File)) {
      return Response.json({ error: "An activityId and audio file are required." }, { status: 400 });
    }
    if (!file.type.startsWith("audio/") || file.size === 0 || file.size > MAX_AUDIO_BYTES) {
      return Response.json({ error: "Choose a non-empty audio file no larger than 100 MB." }, { status: 400 });
    }
    clipId = crypto.randomUUID();
    const filename = safeFilename(file.name);
    const objectKey = `${ownerId}/${activityId}/${clipId}-${filename}`;
    const now = Date.now();
    await registerActivityAudioClip(ownerId, {
      id: clipId,
      activityId,
      transcriptTurnId,
      filename,
      mimeType: file.type,
      label,
      objectKey,
      status: "uploading",
    }, now);
    await env.AUDIO.put(objectKey, file.stream(), {
      httpMetadata: { contentType: file.type, contentDisposition: `inline; filename="${filename}"` },
      customMetadata: { ownerId, activityId, clipId, ...(transcriptTurnId ? { transcriptTurnId } : {}) },
    });
    await updateActivityAudioClipStatus(ownerId, clipId, "available", Date.now());
    return Response.json({
      id: clipId,
      activityId,
      transcriptTurnId: transcriptTurnId ?? null,
      filename,
      mimeType: file.type,
      label,
      durationSeconds: null,
      status: "available",
    }, { status: 201 });
  } catch (error) {
    if (ownerId && clipId) await updateActivityAudioClipStatus(ownerId, clipId, "failed", Date.now()).catch(() => undefined);
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
