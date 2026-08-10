import { z } from "zod";

const stableId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

const resumeFileSchema = z.object({
  format: z.enum(["docx", "pdf"]),
  sha256,
  byteSize: z.number().int().positive(),
  mimeType: z.string().min(1).max(120),
  downloadPath: z.string().regex(/^\/api\/resume-library\/[a-z0-9][a-z0-9._-]{0,199}\/[a-z0-9][a-z0-9._-]{0,199}\/(?:docx|pdf)$/),
}).strict();

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
      files: z.array(resumeFileSchema).max(2),
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
