import { z } from "zod";

import { assertBehavioralEvidenceRemoteSafe } from "./behavioral-evidence-policy.ts";

const stableId = z.string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use a lowercase stable ID.");
const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const behavioralEvidenceSourceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  sourceId: stableId,
  state: z.enum(["active", "archived"]),
  projectKey: stableId,
  kind: z.enum(["resume", "repository", "document", "chat_export", "architecture", "git_history", "user_statement", "other"]),
  label: boundedText(240),
  safeHint: boundedText(240),
  authorization: z.enum(["user_authorized", "user_owned", "authorization_required", "unknown"]),
  sensitivity: z.enum(["public", "private", "employer_confidential", "secret_adjacent", "unknown"]),
  availability: z.enum(["available", "missing", "not_checked", "blocked"]),
  refreshStatus: z.enum(["current", "changed", "unavailable", "not_checked", "blocked"]),
  contentRevision: boundedText(200).optional(),
  contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  lastInspectedAt: z.number().int().positive().optional(),
  visibility: z.literal("owner_private"),
}).strict().superRefine((source, context) => {
  if (source.availability === "available" && !source.contentRevision && !source.contentFingerprint) {
    context.addIssue({
      code: "custom",
      path: ["contentRevision"],
      message: "An available source requires a sanitized content revision or fingerprint.",
    });
  }
  if (source.availability === "available" && !source.lastInspectedAt) {
    context.addIssue({
      code: "custom",
      path: ["lastInspectedAt"],
      message: "An available source requires its last inspected time.",
    });
  }
  if (source.authorization === "authorization_required" && source.availability === "available") {
    context.addIssue({
      code: "custom",
      path: ["authorization"],
      message: "A source cannot be available for inspection before authorization.",
    });
  }
});

export const behavioralEvidenceSourceWriteSchema = z.object({
  operationId: stableId,
  expectedRevision: z.number().int().nonnegative(),
  authorization: z.literal("behavioral_evidence_specialist"),
  source: behavioralEvidenceSourceSnapshotSchema,
}).strict();

export const behavioralEvidenceSourceQuerySchema = z.object({
  sourceId: stableId.optional(),
  revision: z.number().int().positive().optional(),
  includeArchived: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict().refine((input) => !input.revision || Boolean(input.sourceId), {
  message: "A historical source revision requires sourceId.",
});

export const behavioralEvidenceCandidateQuerySchema = z.object({
  state: z.enum(["pending", "accepted", "rejected", "superseded"]).optional(),
  projectKey: stableId.optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict();

export const behavioralEvidenceCandidateDecisionSchema = z.object({
  evidenceId: stableId,
  expectedRevision: z.number().int().positive(),
  decision: z.enum(["accept", "reject", "supersede"]),
  reason: boundedText(1_000),
  replacementEvidenceId: stableId.optional(),
}).strict().superRefine((decision, context) => {
  if (decision.decision === "supersede" && !decision.replacementEvidenceId) {
    context.addIssue({ code: "custom", path: ["replacementEvidenceId"], message: "Supersession requires a replacement evidence ID." });
  }
  if (decision.decision !== "supersede" && decision.replacementEvidenceId) {
    context.addIssue({ code: "custom", path: ["replacementEvidenceId"], message: "Only supersession may name replacement evidence." });
  }
  if (decision.replacementEvidenceId === decision.evidenceId) {
    context.addIssue({ code: "custom", path: ["replacementEvidenceId"], message: "Evidence cannot supersede itself." });
  }
});

export const behavioralEvidenceCandidateReviewSchema = z.object({
  operationId: stableId,
  authorization: z.literal("explicit_owner_review"),
  decisions: z.array(behavioralEvidenceCandidateDecisionSchema).min(1).max(25)
    .refine((items) => new Set(items.map((item) => item.evidenceId)).size === items.length, "Each evidence ID may appear only once.")
    .superRefine((items, context) => {
      const reviewedIds = new Set(items.map((item) => item.evidenceId));
      for (const [index, item] of items.entries()) {
        if (item.replacementEvidenceId && reviewedIds.has(item.replacementEvidenceId)) {
          context.addIssue({
            code: "custom",
            path: [index, "replacementEvidenceId"],
            message: "A supersession replacement cannot also change state in the same review batch.",
          });
        }
      }
    }),
}).strict();

export type BehavioralEvidenceSourceSnapshot = z.infer<typeof behavioralEvidenceSourceSnapshotSchema>;
export type BehavioralEvidenceSourceWrite = z.infer<typeof behavioralEvidenceSourceWriteSchema>;
export type BehavioralEvidenceSourceQuery = z.infer<typeof behavioralEvidenceSourceQuerySchema>;
export type BehavioralEvidenceCandidateQuery = z.infer<typeof behavioralEvidenceCandidateQuerySchema>;
export type BehavioralEvidenceCandidateReview = z.infer<typeof behavioralEvidenceCandidateReviewSchema>;

export class BehavioralEvidenceReviewError extends Error {
  readonly code: string;
  readonly retryable = false;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BehavioralEvidenceReviewError";
    this.code = code;
  }
}

function remoteSafe(value: unknown, code: string, message: string) {
  try {
    assertBehavioralEvidenceRemoteSafe(value);
  } catch {
    throw new BehavioralEvidenceReviewError(code, message);
  }
}

export function validateBehavioralEvidenceSourceWrite(value: unknown) {
  const input = behavioralEvidenceSourceWriteSchema.parse(value);
  remoteSafe(
    input,
    "behavioral_evidence_source_unsafe_payload",
    "Evidence source metadata contains a private locator, remote, credential, identity, or source content.",
  );
  return input;
}

export function validateBehavioralEvidenceCandidateReview(value: unknown) {
  const input = behavioralEvidenceCandidateReviewSchema.parse(value);
  remoteSafe(
    input,
    "behavioral_evidence_review_unsafe_payload",
    "Evidence review metadata contains a private locator, remote, credential, identity, or source content.",
  );
  return input;
}

export function candidateReviewTargetState(decision: "accept" | "reject" | "supersede") {
  return decision === "accept" ? "accepted" as const : decision === "reject" ? "rejected" as const : "superseded" as const;
}

export function assertCandidateReviewTransition(
  fromState: "pending" | "accepted" | "rejected" | "superseded",
  decision: "accept" | "reject" | "supersede",
) {
  const target = candidateReviewTargetState(decision);
  const allowed = fromState === "pending"
    ? ["accepted", "rejected", "superseded"]
    : fromState === "accepted"
      ? ["superseded"]
      : [];
  if (!allowed.includes(target)) {
    throw new BehavioralEvidenceReviewError(
      "behavioral_evidence_review_transition_conflict",
      `Evidence in ${fromState} state cannot transition to ${target}.`,
    );
  }
  return target;
}
