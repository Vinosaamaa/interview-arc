const PRACTICE_ASSET_NAMESPACE = "practice-asset";

export type PracticeAssetBucket = Pick<R2Bucket, "put" | "head" | "get">;

export class PracticeAssetStorageError extends Error {
  readonly code = "practice_asset_storage_unavailable";
  readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = "PracticeAssetStorageError";
  }
}

async function sha256Hex(value: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value instanceof Uint8Array
      ? Uint8Array.from(value)
      : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function practiceAssetObjectKey(
  ownerId: string,
  assetId: string,
  revision: number,
  contentHash: string,
) {
  const root = await sha256Hex(`${ownerId}\u0000${assetId}\u0000${revision}`);
  return `practice-assets/${root}/${contentHash}`;
}

export async function stagePrivatePracticeAsset(
  bucket: PracticeAssetBucket,
  key: string,
  bytesValue: ArrayBuffer | Uint8Array,
  metadata: {
    role: string;
    mimeType: string;
    sha256: string;
    byteSize: number;
  },
) {
  const bytes = bytesValue instanceof Uint8Array
    ? Uint8Array.from(bytesValue).buffer
    : bytesValue;
  const actualHash = await sha256Hex(bytes);
  if (bytes.byteLength !== metadata.byteSize || actualHash !== metadata.sha256) {
    throw new PracticeAssetStorageError("The supplied Practice asset bytes do not match their immutable integrity metadata.");
  }
  await bucket.put(key, bytes, {
    httpMetadata: { contentType: metadata.mimeType },
    customMetadata: {
      namespace: PRACTICE_ASSET_NAMESPACE,
      role: metadata.role,
      sha256: metadata.sha256,
    },
  });
  const stored = await bucket.head(key);
  if (!stored
      || stored.size !== metadata.byteSize
      || stored.customMetadata?.namespace !== PRACTICE_ASSET_NAMESPACE
      || stored.customMetadata?.role !== metadata.role
      || stored.customMetadata?.sha256 !== metadata.sha256) {
    throw new PracticeAssetStorageError("The private Practice asset was not durably verified. Retry the exact operation.");
  }
}

export async function verifyPrivatePracticeAsset(
  bucket: PracticeAssetBucket,
  key: string,
  metadata: { role: string; sha256: string; byteSize: number },
) {
  const stored = await bucket.head(key);
  if (!stored
      || stored.size !== metadata.byteSize
      || stored.customMetadata?.namespace !== PRACTICE_ASSET_NAMESPACE
      || stored.customMetadata?.role !== metadata.role
      || stored.customMetadata?.sha256 !== metadata.sha256) {
    throw new PracticeAssetStorageError("The private Practice asset failed durable verification. Retry the exact operation.");
  }
  const object = await bucket.get(key);
  if (!object) throw new PracticeAssetStorageError("The private Practice asset failed exact byte verification. Retry the exact operation.");
  const bytes = await object.arrayBuffer();
  if (bytes.byteLength !== metadata.byteSize || await sha256Hex(bytes) !== metadata.sha256) {
    throw new PracticeAssetStorageError("The private Practice asset failed exact byte verification. Retry the exact operation.");
  }
}

function privateFailure() {
  return Response.json({ error: "The private Practice asset is not durably available." }, {
    status: 503,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function servePrivatePracticeAsset(
  asset: {
    ownerId: string;
    assetId: string;
    revision: number;
    role: string;
    mimeType: string;
    sha256: string;
    byteSize: number;
    privateLocator: string;
  },
  bucket: PracticeAssetBucket,
) {
  try {
    const expectedKey = await practiceAssetObjectKey(
      asset.ownerId,
      asset.assetId,
      asset.revision,
      asset.sha256,
    );
    if (asset.privateLocator !== expectedKey) return privateFailure();
    const head = await bucket.head(expectedKey);
    if (!head
        || head.size !== asset.byteSize
        || head.customMetadata?.namespace !== PRACTICE_ASSET_NAMESPACE
        || head.customMetadata?.role !== asset.role
        || head.customMetadata?.sha256 !== asset.sha256) {
      return privateFailure();
    }
    const object = await bucket.get(expectedKey);
    if (!object) return privateFailure();
    const bytes = await object.arrayBuffer();
    if (bytes.byteLength !== asset.byteSize || await sha256Hex(bytes) !== asset.sha256) return privateFailure();
    return new Response(bytes, {
      headers: {
        "content-type": asset.mimeType,
        "content-length": String(asset.byteSize),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cross-origin-resource-policy": "same-origin",
      },
    });
  } catch {
    return privateFailure();
  }
}
