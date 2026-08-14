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
    : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function metadataMatches(
  stored: R2Object | R2ObjectBody | null,
  metadata: { role: string; sha256: string; byteSize: number },
) {
  return Boolean(stored
    && stored.size === metadata.byteSize
    && stored.customMetadata?.namespace === PRACTICE_ASSET_NAMESPACE
    && stored.customMetadata?.role === metadata.role
    && stored.customMetadata?.sha256 === metadata.sha256);
}

async function storageOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PracticeAssetStorageError) throw error;
    throw new PracticeAssetStorageError("Private Practice asset storage is temporarily unavailable. Retry the exact operation.");
  }
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

export async function practiceActivityAssetId(activityId: string, role: string) {
  return `asset-${await sha256Hex(`${activityId}\u0000${role}`)}`;
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
  const actualHash = await sha256Hex(bytesValue);
  if (bytesValue.byteLength !== metadata.byteSize || actualHash !== metadata.sha256) {
    throw new PracticeAssetStorageError("The supplied Practice asset bytes do not match their immutable integrity metadata.");
  }
  await storageOperation(() => bucket.put(key, bytesValue, {
    httpMetadata: { contentType: metadata.mimeType },
    customMetadata: {
      namespace: PRACTICE_ASSET_NAMESPACE,
      role: metadata.role,
      sha256: metadata.sha256,
    },
  }));
  const stored = await storageOperation(() => bucket.head(key));
  if (!metadataMatches(stored, metadata)) {
    throw new PracticeAssetStorageError("The private Practice asset was not durably verified. Retry the exact operation.");
  }
}

export async function readVerifiedPrivatePracticeAsset(
  bucket: PracticeAssetBucket,
  key: string,
  metadata: { role: string; sha256: string; byteSize: number },
) {
  const stored = await storageOperation(() => bucket.head(key));
  if (!metadataMatches(stored, metadata)) {
    throw new PracticeAssetStorageError("The private Practice asset failed durable verification. Retry the exact operation.");
  }
  const object = await storageOperation(() => bucket.get(key));
  if (!object) throw new PracticeAssetStorageError("The private Practice asset failed exact byte verification. Retry the exact operation.");
  const bytes = await storageOperation(() => object.arrayBuffer());
  if (bytes.byteLength !== metadata.byteSize || await sha256Hex(bytes) !== metadata.sha256) {
    throw new PracticeAssetStorageError("The private Practice asset failed exact byte verification. Retry the exact operation.");
  }
  return bytes;
}

export async function verifyPrivatePracticeAsset(
  bucket: PracticeAssetBucket,
  key: string,
  metadata: { role: string; sha256: string; byteSize: number },
) {
  await readVerifiedPrivatePracticeAsset(bucket, key, metadata);
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
    const bytes = await readVerifiedPrivatePracticeAsset(bucket, expectedKey, asset);
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
