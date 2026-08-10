import { env } from "cloudflare:workers";
import { z } from "zod";

import {
  BehavioralTargetProfileError,
  VERIFIED_PUBLIC_TARGET_SOURCE,
  changeBehavioralTargetProfileState,
  queryBehavioralTargetProfiles,
  upsertBehavioralTargetProfile,
} from "../../../db/behavioral-target-profile";
import {
  behavioralTargetProfileStateWriteSchema,
  behavioralTargetWebsiteProfileWriteSchema,
} from "../../../db/behavioral-target-profile-policy";
import {
  BehavioralTargetPublicSourceError,
  fetchPublicBehavioralTargetSource,
} from "../../../db/behavioral-target-public-source";
import { resolveOwnerId } from "../../../db/owner";
import { publishOwnerLiveUpdate } from "../../../worker/live-update-hub";
import { readBoundedJson, RouteBodyTooLargeError, toRouteErrorMessage } from "../route-helpers";

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("upsert"), input: behavioralTargetWebsiteProfileWriteSchema }).strict(),
  z.object({ action: z.literal("set_state"), input: behavioralTargetProfileStateWriteSchema }).strict(),
]);

function targetError(error: unknown) {
  if (error instanceof BehavioralTargetProfileError) {
    const conflict = error.code.includes("conflict") || error.code.includes("not_found");
    return Response.json({ error: error.message, code: error.code, retryable: error.retryable }, { status: conflict ? 409 : 400 });
  }
  if (error instanceof BehavioralTargetPublicSourceError) {
    return Response.json({ error: error.message, code: error.code, retryable: false }, { status: 409 });
  }
  if (error instanceof RouteBodyTooLargeError) return Response.json({ error: error.message, retryable: false }, { status: 413 });
  if (error instanceof SyntaxError) return Response.json({ error: "The Target Profile request is not valid JSON.", retryable: false }, { status: 400 });
  if (error instanceof z.ZodError) return Response.json({ error: "The Target Profile request is invalid.", retryable: false }, { status: 400 });
  return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const targetId = url.searchParams.get("targetId") || undefined;
    const revisionValue = url.searchParams.get("revision");
    const revision = revisionValue ? Number(revisionValue) : undefined;
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const ownerId = await resolveOwnerId(request);
    const result = await queryBehavioralTargetProfiles(ownerId, { targetId, revision, includeArchived });
    return Response.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return targetError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = postSchema.parse(await readBoundedJson(request, 140_000));
    const ownerId = await resolveOwnerId(request);
    let result;
    if (body.action === "set_state") {
      result = await changeBehavioralTargetProfileState(ownerId, body.input);
    } else if (body.input.target.source.kind === "public_posting") {
      const verified = await fetchPublicBehavioralTargetSource({
        url: body.input.target.source.displayLocator,
        expectedFingerprint: body.input.target.source.expectedFingerprint,
      });
      if (verified.change !== "unchanged") {
        throw new BehavioralTargetPublicSourceError(
          "behavioral_target_public_source_changed",
          "The public posting changed after preview. Review the latest content before saving.",
        );
      }
      result = await upsertBehavioralTargetProfile(ownerId, {
        ...body.input,
        target: {
          ...body.input.target,
          source: {
            kind: "public_posting",
            displayLocator: verified.source.displayLocator,
            capturedAt: verified.source.capturedAt,
            jdText: verified.source.jdText,
          },
        },
      }, Date.now(), VERIFIED_PUBLIC_TARGET_SOURCE);
    } else {
      result = await upsertBehavioralTargetProfile(ownerId, body.input);
    }
    if (!("duplicate" in result) || result.duplicate !== true) {
      await publishOwnerLiveUpdate(env.LIVE_UPDATES, ownerId, "behavioral_target");
    }
    return Response.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return targetError(error);
  }
}
