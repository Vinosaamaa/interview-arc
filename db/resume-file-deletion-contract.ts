import { z } from "zod";

export const resumeFileDeletionStableIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/);

export const resumeFileDeletionRequestSchema = z.object({
  operationId: resumeFileDeletionStableIdSchema,
  authorization: z.literal("explicit_user_instruction"),
  reason: z.string().trim().min(1).max(2_000),
}).strict();

export const resumeFileDeletionReceiptSchema = z.object({
  operationId: resumeFileDeletionStableIdSchema,
  status: z.literal("deleted"),
  resumeId: resumeFileDeletionStableIdSchema,
  revisionId: resumeFileDeletionStableIdSchema,
  deletedFormats: z.tuple([z.literal("docx"), z.literal("pdf")]),
  preserved: z.tuple([
    z.literal("revision"),
    z.literal("integrity"),
    z.literal("wording"),
    z.literal("semantic_links"),
    z.literal("activity_context"),
  ]),
  deletedAt: z.number().int().positive(),
  duplicate: z.boolean(),
}).strict();

export type ResumeFileDeletionRequest = z.infer<typeof resumeFileDeletionRequestSchema>;
