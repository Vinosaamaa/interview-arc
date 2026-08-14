import {
  practiceAssetRoles,
  readCurrentPracticeDesignCheckpoint,
  readPracticeAssetRevision,
  savePracticeDesignCheckpoint,
  stagePracticeAssetSet,
  type PracticeAssetRole,
} from "../db/practice-assets";
import { servePrivatePracticeAsset, type PracticeAssetBucket } from "./practice-asset-storage";

const MAX_SCENE_BYTES = 5 * 1_024 * 1_024;
const MAX_SVG_BYTES = 2 * 1_024 * 1_024;
const MAX_PNG_BYTES = 10 * 1_024 * 1_024;
const stableId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
}

function failure(error: unknown) {
  const retryable = Boolean(error && typeof error === "object" && (error as { retryable?: unknown }).retryable);
  return response({
    error: error instanceof Error ? error.message : "The private Practice asset request failed.",
    code: retryable ? "practice_asset_storage_unavailable" : "practice_asset_request_rejected",
    retryable,
  }, retryable ? 503 : 400);
}

async function formFile(form: FormData, name: string, expectedMimeType: string, maxBytes: number) {
  const entry = form.get(name);
  if (!(entry instanceof File)) throw new Error(`The ${name} asset file is required.`);
  if (entry.type !== expectedMimeType) throw new Error(`The ${name} asset has an unsupported media type.`);
  if (entry.size <= 0 || entry.size > maxBytes) throw new Error(`The ${name} asset exceeds its bounded byte limit.`);
  return new Uint8Array(await entry.arrayBuffer());
}

function formMetadata(form: FormData) {
  const entry = form.get("metadata");
  if (typeof entry !== "string" || new TextEncoder().encode(entry).byteLength > 64 * 1_024) {
    throw new Error("Bounded Practice asset metadata is required.");
  }
  return JSON.parse(entry) as Record<string, unknown>;
}

function exactString(value: unknown, label: string) {
  if (typeof value !== "string" || !stableId.test(value)) throw new Error(`${label} must be a stable opaque identifier.`);
  return value;
}

function altText(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 1_000) throw new Error("Each Practice drawing needs bounded alt text.");
  return value.trim();
}

export async function routePracticeAssets(
  ownerId: string,
  request: Request,
  bucket: PracticeAssetBucket,
): Promise<Response | null> {
  const url = new URL(request.url);
  const checkpointMatch = url.pathname.match(/^\/practice-assets\/checkpoints\/([^/]+)$/);
  const setMatch = url.pathname.match(/^\/practice-assets\/sets\/([^/]+)$/);
  const fileMatch = url.pathname.match(/^\/practice-assets\/files\/([^/]+)\/(\d+)$/);
  try {
    if (checkpointMatch && request.method === "PUT") {
      const activityId = exactString(decodeURIComponent(checkpointMatch[1]), "activityId");
      const form = await request.formData();
      const metadata = formMetadata(form);
      const expectedRevision = Number(metadata.expectedRevision);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("expectedRevision must be a non-negative integer.");
      const saved = await savePracticeDesignCheckpoint({
        ownerId,
        activityId,
        operationId: exactString(metadata.operationId, "operationId"),
        expectedRevision,
        altText: altText(metadata.altText),
        bytes: await formFile(form, "scene", "application/vnd.excalidraw+json", MAX_SCENE_BYTES),
        bucket,
        nowMs: Date.now(),
      });
      return response(saved);
    }
    if (checkpointMatch && request.method === "GET") {
      const activityId = exactString(decodeURIComponent(checkpointMatch[1]), "activityId");
      const checkpoint = await readCurrentPracticeDesignCheckpoint(ownerId, activityId, bucket);
      return checkpoint ? response(checkpoint) : response({ error: "System Design checkpoint not found." }, 404);
    }
    if (setMatch && request.method === "POST") {
      const activityId = exactString(decodeURIComponent(setMatch[1]), "activityId");
      const form = await request.formData();
      const metadata = formMetadata(form);
      if (!Array.isArray(metadata.assets) || metadata.assets.length < 2 || metadata.assets.length > 3) {
        throw new Error("A final System Design asset set needs two or three declared assets.");
      }
      const declared = metadata.assets.map((entry) => {
        if (!entry || typeof entry !== "object") throw new Error("Each Practice asset declaration must be an object.");
        const role = (entry as { role?: unknown }).role;
        if (typeof role !== "string" || !practiceAssetRoles.includes(role as PracticeAssetRole)) {
          throw new Error("The Practice asset role is unsupported.");
        }
        return { role: role as PracticeAssetRole, altText: altText((entry as { altText?: unknown }).altText) };
      });
      const specs = {
        attempt_original_excalidraw: ["application/vnd.excalidraw+json", MAX_SCENE_BYTES],
        attempt_original_svg: ["image/svg+xml", MAX_SVG_BYTES],
        attempt_original_png: ["image/png", MAX_PNG_BYTES],
      } as const;
      const assets = [];
      for (const declaration of declared) {
        const [mimeType, maxBytes] = specs[declaration.role];
        assets.push({
          ...declaration,
          mimeType,
          bytes: await formFile(form, declaration.role, mimeType, maxBytes),
        });
      }
      const checkpointRevision = Number(metadata.checkpointRevision);
      if (!Number.isSafeInteger(checkpointRevision) || checkpointRevision < 1) {
        throw new Error("checkpointRevision must be a positive integer.");
      }
      const staged = await stagePracticeAssetSet({
        ownerId,
        activityId,
        questionId: exactString(metadata.questionId, "questionId"),
        operationId: exactString(metadata.operationId, "operationId"),
        checkpointRevision,
        assets,
        bucket,
        nowMs: Date.now(),
      });
      return response(staged);
    }
    if (fileMatch && request.method === "GET") {
      const assetId = exactString(decodeURIComponent(fileMatch[1]), "assetId");
      const revision = Number(fileMatch[2]);
      const asset = await readPracticeAssetRevision(ownerId, assetId, revision);
      return asset ? servePrivatePracticeAsset(asset, bucket) : response({ error: "Practice asset not found." }, 404);
    }
    return null;
  } catch (error) {
    return failure(error);
  }
}
