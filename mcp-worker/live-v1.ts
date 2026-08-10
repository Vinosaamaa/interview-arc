import {
  acquireLiveActivityLease,
  applyLiveActivityCommand,
  beginLiveClipUpload,
  commitLiveTurnPair,
  completeLiveClipUpload,
  failLiveClipUpload,
  LiveV1Error,
  liveRequestDigest,
  readLiveActivityProjection,
  readLiveClipStorage,
  readLiveCommandProjection,
  readLiveMutationReceipt,
  readLiveTodayProjection,
  releaseLiveActivityLease,
  renewLiveActivityLease,
  stageLiveClip,
} from "../db/live-v1";
import { publishOwnerLiveUpdate } from "../worker/live-update-hub";
import type { LiveUpdateNamespace } from "../worker/live-update-hub";

type JsonResponder = (body: unknown, init?: ResponseInit) => Response;

type LiveV1Env = {
  LIVE_UPDATES?: LiveUpdateNamespace;
  AUDIO: R2Bucket;
};

const stableIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodedPathId(value: string) {
  try {
    const decoded = decodeURIComponent(value);
    if (!stableIdPattern.test(decoded)) throw new Error("invalid");
    return decoded;
  } catch {
    throw new LiveV1Error(
      "invalid_request",
      "Live resource identifiers must be stable opaque strings no longer than 200 characters.",
      400,
      false,
    );
  }
}

async function requestObject(request: Request) {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value as Record<string, unknown>;
  } catch {
    throw new LiveV1Error(
      "invalid_request",
      "A JSON object is required.",
      400,
      false,
    );
  }
}

function leaseRequestIdentity(body: Record<string, unknown>, includeFence: boolean) {
  const operationId = typeof body.operationId === "string" ? body.operationId : "";
  const holderId = typeof body.holderId === "string" ? body.holderId : "";
  const holderSessionId = typeof body.holderSessionId === "string" ? body.holderSessionId : "";
  const fencingToken = body.fencingToken;
  if (!stableIdPattern.test(operationId)
      || !uuidV4Pattern.test(holderId)
      || !stableIdPattern.test(holderSessionId)
      || (includeFence && (!Number.isSafeInteger(fencingToken) || Number(fencingToken) < 1))) {
    throw new LiveV1Error(
      "invalid_request",
      "The lease request requires stable operation, 128-bit holder, room-session, and fencing identities.",
      400,
      false,
    );
  }
  return {
    operationId,
    holderId,
    holderSessionId,
    ...(includeFence ? { fencingToken: Number(fencingToken) } : {}),
  };
}

function fencedWriteIdentity(body: Record<string, unknown>) {
  const lease = leaseRequestIdentity(body, true);
  return {
    operationId: lease.operationId,
    identity: {
      holderId: lease.holderId,
      holderSessionId: lease.holderSessionId,
      fencingToken: lease.fencingToken!,
    },
  };
}

function pairRequest(body: Record<string, unknown>) {
  const fenced = fencedWriteIdentity(body);
  const pairId = typeof body.pairId === "string" ? body.pairId : "";
  const clipId = typeof body.clipId === "string" ? body.clipId : undefined;
  const candidate = body.candidate && typeof body.candidate === "object" && !Array.isArray(body.candidate)
    ? body.candidate as Record<string, unknown>
    : {};
  const interviewer = body.interviewer && typeof body.interviewer === "object" && !Array.isArray(body.interviewer)
    ? body.interviewer as Record<string, unknown>
    : {};
  const candidateTurnId = typeof candidate.turnId === "string" ? candidate.turnId : "";
  const candidateText = typeof candidate.text === "string" ? candidate.text : "";
  const evidenceStatus = typeof candidate.evidenceStatus === "string" ? candidate.evidenceStatus : "";
  const interviewerTurnId = typeof interviewer.turnId === "string" ? interviewer.turnId : "";
  const displayMarkdown = typeof interviewer.displayMarkdown === "string" ? interviewer.displayMarkdown : "";
  const spokenText = typeof interviewer.spokenText === "string" ? interviewer.spokenText : "";
  if (evidenceStatus === "no_candidate") {
    throw new LiveV1Error(
      "candidate_evidence_required",
      "A no-candidate recovery cannot create a durable candidate/interviewer pair.",
      422,
      false,
    );
  }
  if (!stableIdPattern.test(pairId)
      || !stableIdPattern.test(candidateTurnId)
      || !stableIdPattern.test(interviewerTurnId)
      || (clipId != null && !stableIdPattern.test(clipId))
      || !["verified", "best_available", "possible_contamination"].includes(evidenceStatus)
      || !candidateText.trim()
      || candidateText.length > 100_000
      || !displayMarkdown.trim()
      || displayMarkdown.length > 100_000
      || !spokenText.trim()
      || spokenText.length > 20_000
      || !Number.isSafeInteger(candidate.occurredAt)
      || Number(candidate.occurredAt) < 0
      || !Number.isSafeInteger(interviewer.occurredAt)
      || Number(interviewer.occurredAt) < 0) {
    throw new LiveV1Error(
      "invalid_request",
      "A pair requires stable identities, non-empty bounded text, supported evidence status, and occurrence times.",
      400,
      false,
    );
  }
  return {
    ...fenced,
    pairId,
    candidate: {
      turnId: candidateTurnId,
      text: candidateText,
      evidenceStatus: evidenceStatus as "verified" | "best_available" | "possible_contamination",
      occurredAt: Number(candidate.occurredAt),
    },
    interviewer: {
      turnId: interviewerTurnId,
      displayMarkdown,
      spokenText,
      occurredAt: Number(interviewer.occurredAt),
    },
    ...(clipId ? { clipId } : {}),
  };
}

function clipStageRequest(body: Record<string, unknown>) {
  const fenced = fencedWriteIdentity(body);
  const clipId = typeof body.clipId === "string" ? body.clipId : "";
  const candidateTurnId = typeof body.candidateTurnId === "string" ? body.candidateTurnId : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.toLowerCase() : "";
  const byteSize = body.byteSize;
  const sha256 = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
  if (!stableIdPattern.test(clipId)
      || !stableIdPattern.test(candidateTurnId)
      || !["audio/mp4", "audio/mpeg", "audio/wav", "audio/webm", "audio/x-m4a"].includes(mimeType)
      || !Number.isSafeInteger(byteSize)
      || Number(byteSize) < 1
      || Number(byteSize) > 100 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new LiveV1Error(
      "invalid_request",
      "Clip staging requires stable identities, supported private audio metadata, 1-100 MB, and SHA-256.",
      400,
      false,
    );
  }
  return {
    ...fenced,
    clipId,
    candidateTurnId,
    mimeType,
    byteSize: Number(byteSize),
    sha256,
  };
}

function commandRequest(body: Record<string, unknown>) {
  const fenced = fencedWriteIdentity(body);
  const command = typeof body.command === "string" ? body.command : "";
  const expectedWorkbenchRevision = body.expectedWorkbenchRevision;
  const expectedTimerRevision = body.expectedTimerRevision;
  const expectedResultRevision = body.expectedResultRevision;
  const expectedNextTimerRevision = body.expectedNextTimerRevision;
  const result = typeof body.result === "string" ? body.result : undefined;
  const pairId = typeof body.pairId === "string" ? body.pairId : undefined;
  const nextActivityId = typeof body.nextActivityId === "string" ? body.nextActivityId : undefined;
  const commands = [
    "start",
    "pause",
    "finish",
    "set_result",
    "clear_result",
    "confirm_candidate_evidence",
    "finish-next",
  ];
  const nonNegativeRevision = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
  if (!commands.includes(command)
      || !nonNegativeRevision(expectedWorkbenchRevision)
      || (pairId != null && !stableIdPattern.test(pairId))
      || (nextActivityId != null && !stableIdPattern.test(nextActivityId))
      || (expectedTimerRevision != null && !nonNegativeRevision(expectedTimerRevision))
      || (expectedResultRevision != null && !nonNegativeRevision(expectedResultRevision))
      || (expectedNextTimerRevision != null && !nonNegativeRevision(expectedNextTimerRevision))
      || (result != null && !["solved", "solved_after_reviewing_approach", "failed"].includes(result))) {
    throw new LiveV1Error(
      "invalid_request",
      "A Live command requires a supported command, lease identity, workbench revision, and command-specific fields.",
      400,
      false,
    );
  }
  if ((["start", "pause", "finish", "finish-next"].includes(command)
        && expectedTimerRevision == null)
      || (["finish", "finish-next", "set_result", "clear_result"].includes(command)
        && expectedResultRevision == null)
      || (command === "set_result" && result == null)
      || (command === "confirm_candidate_evidence" && pairId == null)
      || (command === "finish-next"
        && nextActivityId != null
        && expectedNextTimerRevision == null)) {
    throw new LiveV1Error(
      "invalid_request",
      "The command is missing its required optimistic revision, result, or evidence-pair field.",
      400,
      false,
    );
  }
  return {
    ...fenced,
    command: command as Parameters<typeof applyLiveActivityCommand>[0]["command"],
    expectedWorkbenchRevision: Number(expectedWorkbenchRevision),
    ...(expectedTimerRevision != null ? { expectedTimerRevision: Number(expectedTimerRevision) } : {}),
    ...(expectedResultRevision != null ? { expectedResultRevision: Number(expectedResultRevision) } : {}),
    ...(expectedNextTimerRevision != null
      ? { expectedNextTimerRevision: Number(expectedNextTimerRevision) }
      : {}),
    ...(result != null
      ? { result: result as "solved" | "solved_after_reviewing_approach" | "failed" }
      : {}),
    ...(pairId != null ? { pairId } : {}),
    ...(nextActivityId != null ? { nextActivityId } : {}),
  };
}

function clipUploadRequest(request: Request) {
  const body = {
    operationId: request.headers.get("x-live-operation-id") ?? "",
    holderId: request.headers.get("x-live-holder-id") ?? "",
    holderSessionId: request.headers.get("x-live-holder-session-id") ?? "",
    fencingToken: Number(request.headers.get("x-live-fencing-token") ?? ""),
  };
  const fenced = fencedWriteIdentity(body);
  const mimeType = (request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  const byteSize = Number(request.headers.get("content-length") ?? "");
  const sha256 = (request.headers.get("x-content-sha256") ?? "").trim().toLowerCase();
  if (!mimeType
      || !Number.isSafeInteger(byteSize)
      || byteSize < 1
      || byteSize > 100 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(sha256)
      || !request.body) {
    throw new LiveV1Error(
      "invalid_request",
      "Clip upload requires the staged content type, byte length, SHA-256, identities, fence, and a non-empty stream.",
      400,
      false,
    );
  }
  return { ...fenced, mimeType, byteSize, sha256 };
}

function requestedRange(
  header: string | null,
  size: number,
): { offset: number; length: number } | { suffix: number } | null | undefined {
  if (!header) return undefined;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : undefined;
  const end = match[2] ? Number(match[2]) : undefined;
  if (start !== undefined && (start >= size || (end !== undefined && start > end))) return null;
  if (start !== undefined && end !== undefined) {
    return { offset: start, length: Math.min(size - start, end - start + 1) };
  }
  if (start !== undefined) return { offset: start, length: size - start };
  if (end !== undefined && end > 0) return { suffix: Math.min(size, end) };
  return null;
}

function liveErrorResponse(error: unknown, respond: JsonResponder) {
  if (error instanceof LiveV1Error) {
    return respond({
      error: error.message,
      code: error.code,
      retryable: error.retryable,
      ...error.details,
    }, { status: error.status });
  }
  throw error;
}

async function leaseMutationResponse(
  ownerId: string,
  activityId: string,
  result: Awaited<ReturnType<typeof acquireLiveActivityLease>>,
  env: LiveV1Env,
  ctx: ExecutionContext,
  respond: JsonResponder,
) {
  const activity = await readLiveActivityProjection(ownerId, activityId);
  if (!activity) {
    throw new LiveV1Error(
      "activity_not_found",
      "The System Design activity is unavailable in the current workbench.",
      404,
      false,
    );
  }
  if (!result.duplicate) {
    await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "live", {
      executionContext: ctx,
      ownerRevision: result.ownerRevision,
    });
  }
  return respond({
    protocolVersion: 1,
    duplicate: result.duplicate,
    receipt: result.receipt,
    lease: result.receipt.result.lease,
    activity,
  });
}

export async function routeLiveV1(
  ownerId: string,
  request: Request,
  env: LiveV1Env,
  ctx: ExecutionContext,
  respond: JsonResponder,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/live/v1" && !url.pathname.startsWith("/live/v1/")) return null;

  try {
    if (url.pathname === "/live/v1/today" && request.method === "GET") {
      return respond(await readLiveTodayProjection(ownerId));
    }

    const activityMatch = url.pathname.match(/^\/live\/v1\/activities\/([^/]+)$/);
    if (activityMatch && request.method === "GET") {
      const activityId = decodedPathId(activityMatch[1]);
      const projection = await readLiveActivityProjection(ownerId, activityId);
      if (!projection) {
        return respond({
          error: "The System Design activity is unavailable in the current workbench.",
          code: "activity_not_found",
          retryable: false,
        }, { status: 404 });
      }
      return respond(projection);
    }

    const receiptMatch = url.pathname.match(
      /^\/live\/v1\/activities\/([^/]+)\/receipts\/([^/]+)$/,
    );
    if (receiptMatch && request.method === "GET") {
      const activityId = decodedPathId(receiptMatch[1]);
      const operationId = decodedPathId(receiptMatch[2]);
      const stored = await readLiveMutationReceipt(ownerId, activityId, operationId);
      if (!stored) {
        return respond({
          error: "The Live mutation receipt is unavailable.",
          code: "receipt_not_found",
          retryable: false,
        }, { status: 404 });
      }
      return respond({ protocolVersion: 1, receipt: stored.receipt });
    }

    const leaseMatch = url.pathname.match(
      /^\/live\/v1\/activities\/([^/]+)\/lease\/(acquire|renew|release)$/,
    );
    if (leaseMatch && request.method === "POST") {
      const activityId = decodedPathId(leaseMatch[1]);
      const action = leaseMatch[2] as "acquire" | "renew" | "release";
      const body = await requestObject(request);
      const identity = leaseRequestIdentity(body, action !== "acquire");
      const normalizedRequest = {
        protocolVersion: 1,
        operation: `lease.${action}`,
        activityId,
        ...identity,
      };
      const requestDigest = await liveRequestDigest(normalizedRequest);
      const now = Date.now();
      const result = action === "acquire"
        ? await acquireLiveActivityLease({
            ownerId,
            activityId,
            operationId: identity.operationId,
            holderId: identity.holderId,
            holderSessionId: identity.holderSessionId,
            requestDigest,
            now,
          })
        : action === "renew"
          ? await renewLiveActivityLease({
              ownerId,
              activityId,
              operationId: identity.operationId,
              identity: {
                holderId: identity.holderId,
                holderSessionId: identity.holderSessionId,
                fencingToken: identity.fencingToken!,
              },
              requestDigest,
              now,
            })
          : await releaseLiveActivityLease({
              ownerId,
              activityId,
              operationId: identity.operationId,
              identity: {
                holderId: identity.holderId,
                holderSessionId: identity.holderSessionId,
                fencingToken: identity.fencingToken!,
              },
              requestDigest,
              now,
            });
      return leaseMutationResponse(ownerId, activityId, result, env, ctx, respond);
    }

    const pairMatch = url.pathname.match(
      /^\/live\/v1\/activities\/([^/]+)\/turn-pairs$/,
    );
    if (pairMatch && request.method === "POST") {
      const activityId = decodedPathId(pairMatch[1]);
      const body = await requestObject(request);
      const input = pairRequest(body);
      const normalizedRequest = {
        protocolVersion: 1,
        operation: "turn_pair.commit",
        activityId,
        operationId: input.operationId,
        ...input.identity,
        pairId: input.pairId,
        candidate: input.candidate,
        interviewer: input.interviewer,
        ...(input.clipId ? { clipId: input.clipId } : {}),
      };
      const result = await commitLiveTurnPair({
        ownerId,
        activityId,
        ...input,
        requestDigest: await liveRequestDigest(normalizedRequest),
        now: Date.now(),
      });
      const activity = await readLiveActivityProjection(ownerId, activityId);
      if (!activity) {
        throw new LiveV1Error(
          "activity_not_found",
          "The System Design activity is unavailable in the current workbench.",
          404,
          false,
        );
      }
      if (!result.duplicate) {
        await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "live", {
          executionContext: ctx,
          ownerRevision: result.ownerRevision,
        });
      }
      const pairId = String(result.receipt.result.pairId);
      return respond({
        protocolVersion: 1,
        duplicate: result.duplicate,
        receipt: result.receipt,
        pair: activity.pairs.find((pair) => pair.pairId === pairId),
        activity,
      });
    }

    const commandMatch = url.pathname.match(
      /^\/live\/v1\/activities\/([^/]+)\/commands$/,
    );
    if (commandMatch && request.method === "POST") {
      const activityId = decodedPathId(commandMatch[1]);
      const body = await requestObject(request);
      const input = commandRequest(body);
      const normalizedRequest = {
        protocolVersion: 1,
        operation: `command.${input.command}`,
        activityId,
        operationId: input.operationId,
        ...input.identity,
        command: input.command,
        expectedWorkbenchRevision: input.expectedWorkbenchRevision,
        ...(input.expectedTimerRevision != null
          ? { expectedTimerRevision: input.expectedTimerRevision }
          : {}),
        ...(input.expectedResultRevision != null
          ? { expectedResultRevision: input.expectedResultRevision }
          : {}),
        ...(input.expectedNextTimerRevision != null
          ? { expectedNextTimerRevision: input.expectedNextTimerRevision }
          : {}),
        ...(input.result ? { result: input.result } : {}),
        ...(input.pairId ? { pairId: input.pairId } : {}),
        ...(input.nextActivityId ? { nextActivityId: input.nextActivityId } : {}),
      };
      const result = await applyLiveActivityCommand({
        ownerId,
        activityId,
        ...input,
        requestDigest: await liveRequestDigest(normalizedRequest),
        now: Date.now(),
      });
      const { activity, today } = await readLiveCommandProjection(ownerId, activityId);
      if (!activity) {
        throw new LiveV1Error("activity_not_found", "The activity is unavailable.", 404, false);
      }
      if (!result.duplicate) {
        await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "live", {
          executionContext: ctx,
          ownerRevision: result.ownerRevision,
        });
      }
      return respond({
        protocolVersion: 1,
        duplicate: result.duplicate,
        receipt: result.receipt,
        selectedNextActivityId: result.selectedNextActivityId,
        confirmation: result.receipt.result.confirmation ?? null,
        activity,
        today,
      });
    }

    const clipStageMatch = url.pathname.match(
      /^\/live\/v1\/activities\/([^/]+)\/clips\/stage$/,
    );
    if (clipStageMatch && request.method === "POST") {
      const activityId = decodedPathId(clipStageMatch[1]);
      const body = await requestObject(request);
      const input = clipStageRequest(body);
      const normalizedRequest = {
        protocolVersion: 1,
        operation: "clip.stage",
        activityId,
        operationId: input.operationId,
        ...input.identity,
        clipId: input.clipId,
        candidateTurnId: input.candidateTurnId,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        sha256: input.sha256,
      };
      const result = await stageLiveClip({
        ownerId,
        activityId,
        ...input,
        requestDigest: await liveRequestDigest(normalizedRequest),
        now: Date.now(),
      });
      const activity = await readLiveActivityProjection(ownerId, activityId);
      if (!activity) {
        throw new LiveV1Error("activity_not_found", "The activity is unavailable.", 404, false);
      }
      if (!result.duplicate) {
        await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "live", {
          executionContext: ctx,
          ownerRevision: result.ownerRevision,
        });
      }
      return respond({
        protocolVersion: 1,
        duplicate: result.duplicate,
        receipt: result.receipt,
        clip: activity.clips.find((clip) => clip.clipId === input.clipId),
        activity,
      });
    }

    const clipContentMatch = url.pathname.match(
      /^\/live\/v1\/activities\/([^/]+)\/clips\/([^/]+)\/content$/,
    );
    if (clipContentMatch && request.method === "GET") {
      const activityId = decodedPathId(clipContentMatch[1]);
      const clipId = decodedPathId(clipContentMatch[2]);
      const clip = await readLiveClipStorage(ownerId, activityId, clipId);
      if (!clip || clip.status !== "available") {
        return respond({
          error: "The private Live clip is unavailable.",
          code: "clip_not_found",
          retryable: false,
        }, { status: 404 });
      }
      const head = await env.AUDIO.head(clip.objectKey);
      if (!head) {
        return respond({
          error: "The private Live clip object is unavailable.",
          code: "clip_not_found",
          retryable: false,
        }, { status: 404 });
      }
      const range = requestedRange(request.headers.get("range"), head.size);
      if (range === null) {
        return new Response(null, {
          status: 416,
          headers: {
            "content-range": `bytes */${head.size}`,
            "cache-control": "private, no-store",
          },
        });
      }
      const object = await env.AUDIO.get(clip.objectKey, range ? { range } : undefined);
      if (!object?.body) {
        return respond({
          error: "The private Live clip object is unavailable.",
          code: "clip_not_found",
          retryable: false,
        }, { status: 404 });
      }
      const servedRange = range
        ? "suffix" in range
          ? { offset: head.size - range.suffix, length: range.suffix }
          : range
        : null;
      const headers = new Headers({
        "content-type": clip.expectedMimeType,
        "content-disposition": "inline",
        "accept-ranges": "bytes",
        "cache-control": "private, no-store",
        "content-length": String(servedRange?.length ?? object.size),
      });
      if (servedRange) {
        headers.set(
          "content-range",
          `bytes ${servedRange.offset}-${servedRange.offset + servedRange.length - 1}/${head.size}`,
        );
      }
      return new Response(object.body, { status: servedRange ? 206 : 200, headers });
    }

    if (clipContentMatch && request.method === "PUT") {
      const activityId = decodedPathId(clipContentMatch[1]);
      const clipId = decodedPathId(clipContentMatch[2]);
      const input = clipUploadRequest(request);
      const normalizedRequest = {
        protocolVersion: 1,
        operation: "clip.upload",
        activityId,
        clipId,
        operationId: input.operationId,
        ...input.identity,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        sha256: input.sha256,
      };
      const requestDigest = await liveRequestDigest(normalizedRequest);
      const uploadInput = {
        ownerId,
        activityId,
        clipId,
        ...input,
        requestDigest,
        now: Date.now(),
      };
      const claim = await beginLiveClipUpload(uploadInput);
      if (claim.receipt) {
        const activity = await readLiveActivityProjection(ownerId, activityId);
        if (!claim.duplicate) {
          await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "live", {
            executionContext: ctx,
            ownerRevision: claim.ownerRevision,
          });
        }
        return respond({
          protocolVersion: 1,
          duplicate: claim.duplicate,
          receipt: claim.receipt,
          clip: activity?.clips.find((clip) => clip.clipId === clipId),
          activity,
        });
      }
      let result: Awaited<ReturnType<typeof completeLiveClipUpload>>;
      try {
        const object = await env.AUDIO.put(claim.clip.objectKey, request.body, {
          httpMetadata: { contentType: claim.clip.expectedMimeType, contentDisposition: "inline" },
          customMetadata: { ownerId, activityId, clipId },
          sha256: claim.clip.expectedSha256,
        });
        if (object.size !== claim.clip.expectedByteSize) {
          throw new LiveV1Error(
            "clip_size_mismatch",
            "The streamed clip size did not match its immutable staged metadata.",
            422,
            true,
          );
        }
        result = await completeLiveClipUpload({ ...uploadInput, now: Date.now() });
      } catch (error) {
        const checksumMismatch = /checksum|sha-?256/i.test(String(error));
        const liveError = error instanceof LiveV1Error
          ? error
          : new LiveV1Error(
              checksumMismatch ? "clip_checksum_mismatch" : "clip_upload_failed",
              checksumMismatch
                ? "The streamed clip did not match its immutable staged SHA-256 checksum."
                : "The private Live clip upload failed and can be retried from local recovery state.",
              checksumMismatch ? 422 : 503,
              true,
            );
        if (claim.clip.status !== "available") {
          const revision = await failLiveClipUpload({
            ownerId,
            activityId,
            clipId,
            operationId: input.operationId,
            identity: input.identity,
            requestDigest,
            failureCode: liveError.code,
            now: Date.now(),
          });
          await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "live", {
            executionContext: ctx,
            ownerRevision: revision,
          });
        }
        throw liveError;
      }
      const activity = await readLiveActivityProjection(ownerId, activityId);
      if (!activity) {
        throw new LiveV1Error("activity_not_found", "The activity is unavailable.", 404, false);
      }
      if (!result.duplicate) {
        await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "live", {
          executionContext: ctx,
          ownerRevision: result.ownerRevision,
        });
      }
      return respond({
        protocolVersion: 1,
        duplicate: result.duplicate,
        receipt: result.receipt,
        clip: activity.clips.find((clip) => clip.clipId === clipId),
        activity,
      });
    }

    return respond({
      error: "Live v1 resource not found.",
      code: "not_found",
      retryable: false,
    }, { status: 404 });
  } catch (error) {
    return liveErrorResponse(error, respond);
  }
}
