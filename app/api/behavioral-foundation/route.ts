import { getBehavioralFoundationStatus } from "../../../db/behavioral-evidence";
import {
  BehavioralEvidenceReviewError,
  reviewBehavioralEvidenceCandidates,
} from "../../../db/behavioral-evidence-review";
import { resolveOwnerId } from "../../../db/owner";
import {
  behavioralFoundationReviewRequestSchema,
  behavioralFoundationStatusSchema,
} from "../../behavioral-foundation-contract";
import {
  readBoundedJson,
  RouteBodyTooLargeError,
  toRouteErrorMessage,
} from "../route-helpers";
import { ZodError } from "zod";

export async function GET(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const status = behavioralFoundationStatusSchema.parse(await getBehavioralFoundationStatus(ownerId));
    return Response.json(status, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const input = behavioralFoundationReviewRequestSchema.parse(await readBoundedJson(request, 32_768));
    const result = await reviewBehavioralEvidenceCandidates(ownerId, {
      operationId: input.operationId,
      authorization: "explicit_owner_review",
      decisions: input.decisions.map((decision) => ({
        ...decision,
        reason: decision.decision === "accept"
          ? "Accepted through the owner-private Behavioral Foundation review desk."
          : "Rejected through the owner-private Behavioral Foundation review desk.",
      })),
    });
    return Response.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RouteBodyTooLargeError) {
      return Response.json({ error: error.message, code: "request_too_large" }, { status: 413 });
    }
    if (error instanceof ZodError) {
      return Response.json({ error: "The evidence review request is invalid.", code: "invalid_request" }, { status: 400 });
    }
    if (error instanceof BehavioralEvidenceReviewError) {
      return Response.json({ error: error.message, code: error.code, retryable: false }, { status: 409 });
    }
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
