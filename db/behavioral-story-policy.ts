import { z } from "zod";
import { assertBehavioralEvidenceRemoteSafe } from "./behavioral-evidence-policy.ts";

const stableId = z.string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use a lowercase stable ID.");
const boundedText = (max: number) => z.string().trim().min(1).max(max);
const uniqueStableIds = (max: number) => z.array(stableId).max(max)
  .refine((items) => new Set(items).size === items.length, "References must be unique.");
const uniqueLabels = (maxItems: number, maxLength: number) => z.array(boundedText(maxLength)).max(maxItems)
  .refine((items) => new Set(items).size === items.length, "Labels must be unique.");

export const behavioralStoryInputSchema = z.object({
  schemaVersion: z.literal(1),
  storyId: stableId,
  state: z.enum(["active", "archived"]),
  title: boundedText(240),
  projectKey: stableId,
  situation: boundedText(2_000),
  task: boundedText(2_000),
  actions: z.array(boundedText(1_500)).min(1).max(20),
  result: boundedText(2_000),
  learning: boundedText(2_000),
  claimIds: uniqueStableIds(50),
  evidenceIds: uniqueStableIds(100),
  gaps: uniqueLabels(30, 1_000),
  competencies: uniqueLabels(30, 120),
  questionIds: uniqueStableIds(100),
  visibility: z.literal("owner_private"),
}).strict();

export const behavioralStoryWriteSchema = z.object({
  operationId: stableId,
  expectedRevision: z.number().int().nonnegative(),
  story: behavioralStoryInputSchema,
}).strict();

export const behavioralStoryQuerySchema = z.object({
  storyId: stableId.optional(),
  revision: z.number().int().positive().optional(),
  questionId: stableId.optional(),
  includeArchived: z.boolean().optional(),
  limit: z.number().int().min(1).max(20).optional(),
}).strict().refine((input) => !input.revision || Boolean(input.storyId), {
  message: "A historical revision requires storyId.",
});

export type BehavioralStoryInput = z.infer<typeof behavioralStoryInputSchema>;
export type BehavioralStoryWrite = z.infer<typeof behavioralStoryWriteSchema>;
export type BehavioralStoryQuery = z.infer<typeof behavioralStoryQuerySchema>;

export class BehavioralStoryError extends Error {
  readonly code: string;
  readonly retryable = false;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BehavioralStoryError";
    this.code = code;
  }
}

export function validateBehavioralStoryWrite(value: unknown) {
  const input = behavioralStoryWriteSchema.parse(value);
  try {
    assertBehavioralEvidenceRemoteSafe(input);
  } catch {
    throw new BehavioralStoryError(
      "behavioral_story_unsafe_payload",
      "Behavioral story content contains private locator, identity, remote, credential, or key material.",
    );
  }
  if (input.story.claimIds.length === 0 || input.story.evidenceIds.length === 0) {
    throw new BehavioralStoryError(
      "behavioral_story_truth_links_required",
      "A durable story requires at least one owner-private claim and accepted evidence reference.",
    );
  }
  if (input.story.questionIds.length === 0) {
    throw new BehavioralStoryError(
      "behavioral_story_question_link_required",
      "A durable story requires at least one behavioral question link.",
    );
  }
  return input;
}
