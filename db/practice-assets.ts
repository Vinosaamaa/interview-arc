import { and, asc, eq, ne, sql } from "drizzle-orm";
import { d1TransactionalInvariantGuard, isD1TransactionalInvariantFailure } from "./d1-transactional-guard";
import { getDb } from "./index";
import { sha256Hex } from "./integrations";
import {
  extraActivities,
  practiceAssets,
  practiceAssetRevisions,
  practiceAssetSetOperations,
  practiceAssetStagingRows,
  practiceDesignCheckpointRevisions,
  practiceDesignCheckpoints,
} from "./schema";
import {
  practiceAssetObjectKey,
  stagePrivatePracticeAsset,
  verifyPrivatePracticeAsset,
  type PracticeAssetBucket,
} from "../mcp-worker/practice-asset-storage";

export const practiceAssetRoles = [
  "attempt_original_excalidraw",
  "attempt_original_svg",
  "attempt_original_png",
] as const;
export type PracticeAssetRole = typeof practiceAssetRoles[number];

export type PreparedPracticeAsset = {
  assetId: string;
  revision: number;
  role: PracticeAssetRole;
  mimeType: string;
  sha256: string;
  byteSize: number;
  privateLocator: string;
  altText: string;
  authorship: "owner";
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

async function sha256Bytes(value: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeAsset(row: PreparedPracticeAsset) {
  return {
    assetId: row.assetId,
    revision: row.revision,
    role: row.role,
    mimeType: row.mimeType,
    sha256: row.sha256,
    byteSize: row.byteSize,
    altText: row.altText,
    authorship: row.authorship,
  };
}

function activityAssetId(activityId: string, role: PracticeAssetRole) {
  return `${activityId}--${role.replaceAll("_", "-")}`;
}

function assertStableIdentity(value: string, label: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(value)) {
    throw new Error(`${label} must be a stable opaque identifier.`);
  }
}

async function assertSystemDesignActivity(ownerId: string, activityId: string) {
  const rows = await getDb().select({ payload: extraActivities.payload }).from(extraActivities).where(and(
    eq(extraActivities.ownerId, ownerId),
    eq(extraActivities.id, activityId),
  )).limit(1);
  const payload = rows[0]?.payload as { type?: unknown } | undefined;
  if (payload?.type !== "systemDesign") {
    throw new Error("Practice drawing assets require an exact owner-scoped System Design activity.");
  }
}

export async function savePracticeDesignCheckpoint(input: {
  ownerId: string;
  activityId: string;
  operationId: string;
  expectedRevision: number;
  altText: string;
  bytes: Uint8Array;
  bucket: PracticeAssetBucket;
  nowMs: number;
}) {
  assertStableIdentity(input.activityId, "activityId");
  assertStableIdentity(input.operationId, "operationId");
  await assertSystemDesignActivity(input.ownerId, input.activityId);
  const db = getDb();
  const sha256 = await sha256Bytes(input.bytes);
  const requestFingerprint = await sha256Hex(canonicalJson({
    activityId: input.activityId,
    expectedRevision: input.expectedRevision,
    altText: input.altText,
    sha256,
    byteSize: input.bytes.byteLength,
  }));
  const prior = await db.select().from(practiceDesignCheckpointRevisions).where(and(
    eq(practiceDesignCheckpointRevisions.ownerId, input.ownerId),
    eq(practiceDesignCheckpointRevisions.operationId, input.operationId),
  )).limit(1);
  if (prior[0]) {
    if (prior[0].activityId !== input.activityId || prior[0].requestFingerprint !== requestFingerprint) {
      throw new Error("That checkpoint operation is already bound to different immutable bytes.");
    }
    await verifyPrivatePracticeAsset(input.bucket, prior[0].privateLocator, {
      role: "checkpoint_excalidraw",
      sha256: prior[0].sha256,
      byteSize: prior[0].byteSize,
    });
    return {
      duplicate: true,
      checkpoint: {
        activityId: prior[0].activityId,
        revision: prior[0].revision,
        sha256: prior[0].sha256,
        byteSize: prior[0].byteSize,
        altText: prior[0].altText,
        createdAt: new Date(prior[0].createdAt).toISOString(),
      },
    };
  }
  const pointers = await db.select().from(practiceDesignCheckpoints).where(and(
    eq(practiceDesignCheckpoints.ownerId, input.ownerId),
    eq(practiceDesignCheckpoints.activityId, input.activityId),
  )).limit(1);
  const current = pointers[0];
  if ((current?.currentRevision ?? 0) !== input.expectedRevision) {
    throw new Error("The System Design checkpoint changed; restore the current revision before retrying.");
  }
  const revision = input.expectedRevision + 1;
  const locator = await practiceAssetObjectKey(input.ownerId, `${input.activityId}--checkpoint`, revision, sha256);
  await stagePrivatePracticeAsset(input.bucket, locator, input.bytes, {
    role: "checkpoint_excalidraw",
    mimeType: "application/vnd.excalidraw+json",
    sha256,
    byteSize: input.bytes.byteLength,
  });
  const pointerCondition = current
    ? sql`EXISTS (SELECT 1 FROM ${practiceDesignCheckpoints}
        WHERE ${practiceDesignCheckpoints.ownerId} = ${input.ownerId}
          AND ${practiceDesignCheckpoints.activityId} = ${input.activityId}
          AND ${practiceDesignCheckpoints.currentRevision} = ${current.currentRevision}
          AND ${practiceDesignCheckpoints.sha256} = ${current.sha256})`
    : sql`NOT EXISTS (SELECT 1 FROM ${practiceDesignCheckpoints}
        WHERE ${practiceDesignCheckpoints.ownerId} = ${input.ownerId}
          AND ${practiceDesignCheckpoints.activityId} = ${input.activityId})`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, pointerCondition),
      db.insert(practiceDesignCheckpointRevisions).values({
        ownerId: input.ownerId,
        activityId: input.activityId,
        revision,
        operationId: input.operationId,
        requestFingerprint,
        sha256,
        byteSize: input.bytes.byteLength,
        privateLocator: locator,
        altText: input.altText,
        createdAt: input.nowMs,
      }),
      db.insert(practiceDesignCheckpoints).values({
        ownerId: input.ownerId,
        activityId: input.activityId,
        currentRevision: revision,
        sha256,
        updatedAt: input.nowMs,
      }).onConflictDoUpdate({
        target: [practiceDesignCheckpoints.ownerId, practiceDesignCheckpoints.activityId],
        set: { currentRevision: revision, sha256, updatedAt: input.nowMs },
      }),
    ] as unknown as Parameters<typeof db.batch>[0]);
  } catch (error) {
    if (isD1TransactionalInvariantFailure(error)) {
      throw new Error("The System Design checkpoint changed during insertion; restore before retrying.");
    }
    throw error;
  }
  return {
    duplicate: false,
    checkpoint: {
      activityId: input.activityId,
      revision,
      sha256,
      byteSize: input.bytes.byteLength,
      altText: input.altText,
      createdAt: new Date(input.nowMs).toISOString(),
    },
  };
}

export async function readCurrentPracticeDesignCheckpoint(ownerId: string, activityId: string, bucket: PracticeAssetBucket) {
  const db = getDb();
  const pointers = await db.select().from(practiceDesignCheckpoints).where(and(
    eq(practiceDesignCheckpoints.ownerId, ownerId),
    eq(practiceDesignCheckpoints.activityId, activityId),
  )).limit(1);
  if (!pointers[0]) return null;
  const revisions = await db.select().from(practiceDesignCheckpointRevisions).where(and(
    eq(practiceDesignCheckpointRevisions.ownerId, ownerId),
    eq(practiceDesignCheckpointRevisions.activityId, activityId),
    eq(practiceDesignCheckpointRevisions.revision, pointers[0].currentRevision),
  )).limit(1);
  const revision = revisions[0];
  if (!revision || revision.sha256 !== pointers[0].sha256) {
    throw new Error("The current System Design checkpoint pointer failed exact readback.");
  }
  await verifyPrivatePracticeAsset(bucket, revision.privateLocator, {
    role: "checkpoint_excalidraw",
    sha256: revision.sha256,
    byteSize: revision.byteSize,
  });
  const object = await bucket.get(revision.privateLocator);
  if (!object?.body) throw new Error("The current System Design checkpoint bytes are unavailable.");
  const scene = await new Response(object.body).text();
  if (await sha256Hex(scene) !== revision.sha256) {
    throw new Error("The current System Design checkpoint bytes failed exact readback.");
  }
  return {
    checkpoint: {
      activityId,
      revision: revision.revision,
      sha256: revision.sha256,
      byteSize: revision.byteSize,
      altText: revision.altText,
      createdAt: new Date(revision.createdAt).toISOString(),
    },
    scene,
  };
}

export async function stagePracticeAssetSet(input: {
  ownerId: string;
  activityId: string;
  questionId: string;
  operationId: string;
  checkpointRevision: number;
  assets: Array<{ role: PracticeAssetRole; altText: string; mimeType: string; bytes: Uint8Array }>;
  bucket: PracticeAssetBucket;
  nowMs: number;
}) {
  assertStableIdentity(input.activityId, "activityId");
  assertStableIdentity(input.questionId, "questionId");
  assertStableIdentity(input.operationId, "operationId");
  await assertSystemDesignActivity(input.ownerId, input.activityId);
  const roles = input.assets.map((asset) => asset.role);
  if (new Set(roles).size !== roles.length
      || !roles.includes("attempt_original_excalidraw")
      || !roles.includes("attempt_original_svg")) {
    throw new Error("A System Design asset set needs one editable Excalidraw original and one SVG preview.");
  }
  const db = getDb();
  const prior = await db.select().from(practiceAssetSetOperations).where(and(
    eq(practiceAssetSetOperations.ownerId, input.ownerId),
    eq(practiceAssetSetOperations.operationId, input.operationId),
  )).limit(1);
  if (prior[0]) {
    const priorRows = await db.select().from(practiceAssetStagingRows).where(and(
      eq(practiceAssetStagingRows.ownerId, input.ownerId),
      eq(practiceAssetStagingRows.operationId, input.operationId),
    )).orderBy(asc(practiceAssetStagingRows.role));
    const replayRows = await Promise.all(input.assets.map(async (asset) => ({
      role: asset.role,
      mimeType: asset.mimeType,
      sha256: await sha256Bytes(asset.bytes),
      byteSize: asset.bytes.byteLength,
      altText: asset.altText,
    })));
    replayRows.sort((left, right) => left.role.localeCompare(right.role));
    const priorSafeRows = priorRows.map((row) => ({
      role: row.role,
      mimeType: row.mimeType,
      sha256: row.sha256,
      byteSize: row.byteSize,
      altText: row.altText,
    }));
    if (prior[0].activityId !== input.activityId
        || prior[0].questionId !== input.questionId
        || prior[0].checkpointRevision !== input.checkpointRevision
        || canonicalJson(priorSafeRows) !== canonicalJson(replayRows)) {
      throw new Error("That Practice asset-set operation is already bound to different immutable bytes.");
    }
    const prepared = await readPreparedPracticeAssetSet({
      ownerId: input.ownerId,
      activityId: input.activityId,
      operationId: input.operationId,
      manifestSha256: prior[0].manifestSha256,
      bucket: input.bucket,
    });
    return { status: prior[0].status, manifestSha256: prior[0].manifestSha256, assets: prepared.assets.map(safeAsset), duplicate: true };
  }
  const checkpoints = await db.select().from(practiceDesignCheckpointRevisions).where(and(
    eq(practiceDesignCheckpointRevisions.ownerId, input.ownerId),
    eq(practiceDesignCheckpointRevisions.activityId, input.activityId),
    eq(practiceDesignCheckpointRevisions.revision, input.checkpointRevision),
  )).limit(1);
  const checkpoint = checkpoints[0];
  if (!checkpoint) throw new Error("The exact owner-scoped System Design checkpoint does not exist.");
  const active = await db.select({ operationId: practiceAssetSetOperations.operationId }).from(practiceAssetSetOperations).where(and(
    eq(practiceAssetSetOperations.ownerId, input.ownerId),
    eq(practiceAssetSetOperations.activityId, input.activityId),
    ne(practiceAssetSetOperations.status, "bound"),
  )).limit(1);
  if (active[0]) throw new Error("This activity already has a different unbound Practice asset-set operation.");
  const currentAssets = await db.select().from(practiceAssets).where(and(
    eq(practiceAssets.ownerId, input.ownerId),
    eq(practiceAssets.activityId, input.activityId),
  ));
  const currentById = new Map(currentAssets.map((asset) => [asset.assetId, asset]));
  const prepared: PreparedPracticeAsset[] = [];
  for (const asset of input.assets) {
    const sha256 = await sha256Bytes(asset.bytes);
    if (asset.role === "attempt_original_excalidraw" && sha256 !== checkpoint.sha256) {
      throw new Error("The final editable original must match the exact selected checkpoint bytes.");
    }
    const assetId = activityAssetId(input.activityId, asset.role);
    const revision = (currentById.get(assetId)?.currentRevision ?? 0) + 1;
    const privateLocator = await practiceAssetObjectKey(input.ownerId, assetId, revision, sha256);
    prepared.push({
      assetId,
      revision,
      role: asset.role,
      mimeType: asset.mimeType,
      sha256,
      byteSize: asset.bytes.byteLength,
      privateLocator,
      altText: asset.altText,
      authorship: "owner",
    });
  }
  prepared.sort((left, right) => left.role.localeCompare(right.role));
  const manifest = {
    schemaVersion: 1,
    activityId: input.activityId,
    questionId: input.questionId,
    checkpointRevision: input.checkpointRevision,
    assets: prepared.map(safeAsset),
  };
  const manifestSha256 = await sha256Hex(canonicalJson(manifest));
  const requestFingerprint = await sha256Hex(canonicalJson({ operationId: input.operationId, ...manifest }));
  for (const row of prepared) {
    const bytes = input.assets.find((asset) => asset.role === row.role)!.bytes;
    await stagePrivatePracticeAsset(input.bucket, row.privateLocator, bytes, row);
  }
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, sql`EXISTS (SELECT 1 FROM ${practiceDesignCheckpoints}
        WHERE ${practiceDesignCheckpoints.ownerId} = ${input.ownerId}
          AND ${practiceDesignCheckpoints.activityId} = ${input.activityId}
          AND ${practiceDesignCheckpoints.currentRevision} = ${input.checkpointRevision}
          AND ${practiceDesignCheckpoints.sha256} = ${checkpoint.sha256})`),
      db.insert(practiceAssetSetOperations).values({
        ownerId: input.ownerId,
        operationId: input.operationId,
        activityId: input.activityId,
        questionId: input.questionId,
        checkpointRevision: input.checkpointRevision,
        requestFingerprint,
        manifestSha256,
        status: "staged",
        createdAt: input.nowMs,
        updatedAt: input.nowMs,
      }),
      ...prepared.map((row) => db.insert(practiceAssetStagingRows).values({
        ownerId: input.ownerId,
        operationId: input.operationId,
        activityId: input.activityId,
        ...row,
        createdAt: input.nowMs,
      })),
    ] as unknown as Parameters<typeof db.batch>[0]);
  } catch (error) {
    if (isD1TransactionalInvariantFailure(error)) {
      throw new Error("The System Design checkpoint changed while staging final assets; restore before retrying.");
    }
    throw error;
  }
  return { status: "staged" as const, manifestSha256, assets: prepared.map(safeAsset), duplicate: false };
}

export async function readPreparedPracticeAssetSet(input: {
  ownerId: string;
  activityId: string;
  operationId: string;
  manifestSha256: string;
  bucket: PracticeAssetBucket;
}) {
  const db = getDb();
  const operations = await db.select().from(practiceAssetSetOperations).where(and(
    eq(practiceAssetSetOperations.ownerId, input.ownerId),
    eq(practiceAssetSetOperations.operationId, input.operationId),
  )).limit(1);
  const operation = operations[0];
  if (!operation
      || operation.activityId !== input.activityId
      || operation.manifestSha256 !== input.manifestSha256
      || operation.status === "preparing") {
    throw new Error("The exact staged Practice asset manifest is unavailable.");
  }
  const rows = await db.select().from(practiceAssetStagingRows).where(and(
    eq(practiceAssetStagingRows.ownerId, input.ownerId),
    eq(practiceAssetStagingRows.operationId, input.operationId),
  )).orderBy(asc(practiceAssetStagingRows.role));
  if (!rows.length) throw new Error("The staged Practice asset manifest has no immutable assets.");
  const assets = rows.map((row) => ({
    assetId: row.assetId,
    revision: row.revision,
    role: row.role,
    mimeType: row.mimeType,
    sha256: row.sha256,
    byteSize: row.byteSize,
    privateLocator: row.privateLocator,
    altText: row.altText,
    authorship: row.authorship,
  } satisfies PreparedPracticeAsset));
  const computed = await sha256Hex(canonicalJson({
    schemaVersion: 1,
    activityId: operation.activityId,
    questionId: operation.questionId,
    checkpointRevision: operation.checkpointRevision,
    assets: assets.map(safeAsset),
  }));
  if (computed !== operation.manifestSha256) throw new Error("The staged Practice asset manifest failed exact D1 readback.");
  await Promise.all(assets.map((asset) => verifyPrivatePracticeAsset(input.bucket, asset.privateLocator, asset)));
  return { operation, assets };
}

export async function readPracticeAssetRevision(ownerId: string, assetId: string, revision: number) {
  const rows = await getDb().select().from(practiceAssetRevisions).where(and(
    eq(practiceAssetRevisions.ownerId, ownerId),
    eq(practiceAssetRevisions.assetId, assetId),
    eq(practiceAssetRevisions.revision, revision),
  )).limit(1);
  return rows[0] ?? null;
}
