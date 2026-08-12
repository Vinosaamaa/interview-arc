import { z } from "zod";
import { resumeRevisionFileSchema, resumeStableIdSchema } from "./resume-revision-contract.ts";

const stableId = resumeStableIdSchema;

export const resumeLibrarySchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(z.object({
    resumeId: stableId,
    sourceLabel: z.string().min(1).max(120),
    currentRevisionId: stableId.nullable(),
    updatedAt: z.number().int().positive(),
    revisions: z.array(z.object({
      revisionId: stableId,
      parentRevisionId: stableId.nullable(),
      importedAt: z.number().int().positive(),
      current: z.boolean(),
      files: z.array(resumeRevisionFileSchema).max(2),
    }).strict()).max(20),
  }).strict()).max(20),
  limits: z.object({
    sources: z.literal(20),
    revisionsPerSource: z.literal(20),
  }).strict(),
  truncated: z.object({
    sources: z.boolean(),
    revisions: z.boolean(),
  }).strict(),
}).strict();

export type ResumeLibrary = z.infer<typeof resumeLibrarySchema>;
