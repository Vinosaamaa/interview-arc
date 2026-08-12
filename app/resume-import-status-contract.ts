import { z } from "zod";
import { resumeStableIdSchema } from "./resume-revision-contract.ts";

export const recentResumeImportsSchema = z.object({
  schemaVersion: z.literal(1),
  imports: z.array(z.object({
    operationId: resumeStableIdSchema,
    resumeId: resumeStableIdSchema,
    revisionId: resumeStableIdSchema,
    status: z.enum(["staging", "retryable_failure", "failed", "saved"]),
    errorCode: z.string().regex(/^resume_import_[a-z0-9_]{1,100}$/).nullable(),
    retryable: z.boolean(),
    createdAt: z.number().int().positive(),
    updatedAt: z.number().int().positive(),
    completedAt: z.number().int().positive().nullable(),
  }).strict()).max(10),
  limit: z.literal(10),
  truncated: z.boolean(),
}).strict();

export type RecentResumeImport = z.infer<typeof recentResumeImportsSchema>["imports"][number];
export type RecentResumeImports = z.infer<typeof recentResumeImportsSchema>;
