import { z } from "zod";

const boundedReviewText = z.string().min(1).max(2_000);

export const codeAttemptReviewInputSchema = z.discriminatedUnion("status", [
  z.object({
    schemaVersion: z.literal(1),
    status: z.literal("pending"),
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    status: z.literal("complete"),
    summary: z.string().min(1).max(4_000),
    whatWentWell: z.array(boundedReviewText).min(1).max(50),
    whatToImprove: z.array(boundedReviewText).min(1).max(50),
    testingEvidence: z.array(boundedReviewText).min(1).max(100),
    nextStep: boundedReviewText.optional(),
    provenance: z.literal("specialist_observed"),
    reviewedAt: z.number().int().positive(),
  }).strict(),
]);
