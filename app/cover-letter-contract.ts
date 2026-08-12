import { z } from "zod";

const providerId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/);
const resumeId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const httpUrl = z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol));
const privateDownloadPath = z.string().regex(/^\/api\/assets\/cover-letters\/[A-Za-z0-9%_-]+$/);

export const coverLetterArtifactStateSchema = z.enum([
  "pending",
  "ready",
  "superseded",
  "deleting",
  "deleted",
]);

export const jobJourneyCoverLetterArtifactSchema = z.object({
  id: providerId,
  lineageId: providerId,
  parentRevisionId: providerId.nullable(),
  company: z.string().trim().min(1).max(180),
  role: z.string().trim().min(1).max(180),
  sourceUrl: httpUrl.nullable(),
  state: coverLetterArtifactStateSchema,
  jobDescriptionSha256: sha256,
  resumeId,
  resumeRevisionId: resumeId,
  pdfSha256: sha256,
  pdfSize: z.number().int().positive().max(2 * 1024 * 1024),
  pdfFilename: z.string().trim().min(1).max(180),
  jobId: providerId.nullable(),
  linkRevision: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  readyAt: z.string().datetime({ offset: true }).nullable(),
  supersededAt: z.string().datetime({ offset: true }).nullable(),
  deletedAt: z.string().datetime({ offset: true }).nullable(),
  updatedAt: z.string().datetime({ offset: true }),
  downloadPath: privateDownloadPath.nullable(),
}).strict();

export const jobJourneyCoverLetterPageSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime({ offset: true }),
  artifacts: z.array(jobJourneyCoverLetterArtifactSchema).max(100),
  page: z.object({
    hasMore: z.boolean(),
    nextCursor: z.string().min(1).max(2_048).nullable(),
  }).strict(),
}).strict();

export type JobJourneyCoverLetterPage = z.infer<typeof jobJourneyCoverLetterPageSchema>;

export const careerMaterialsCoverLetterArtifactSchema = jobJourneyCoverLetterArtifactSchema.extend({
  resumeLabel: z.string().trim().min(1).max(120).nullable(),
  resumeRevisionKnown: z.boolean(),
  downloadUrl: httpUrl.nullable(),
}).strict();

export type CareerMaterialsCoverLetterArtifact = z.infer<typeof careerMaterialsCoverLetterArtifactSchema>;

const availableResponse = z.object({
  schemaVersion: z.literal(1),
  status: z.literal("available"),
  stale: z.boolean(),
  generatedAt: z.string().datetime({ offset: true }),
  artifacts: z.array(careerMaterialsCoverLetterArtifactSchema).max(100),
  page: z.object({
    hasMore: z.boolean(),
    nextCursor: z.string().min(1).max(2_048).nullable(),
  }).strict(),
}).strict();

const unavailableResponse = z.object({
  schemaVersion: z.literal(1),
  status: z.literal("unavailable"),
  stale: z.literal(false),
  generatedAt: z.null(),
  artifacts: z.null(),
  page: z.null(),
  message: z.string().min(1).max(240),
}).strict();

export const careerMaterialsCoverLetterResponseSchema = z.discriminatedUnion("status", [
  availableResponse,
  unavailableResponse,
]);

export type CareerMaterialsCoverLetterResponse = z.infer<typeof careerMaterialsCoverLetterResponseSchema>;

export function normalizeJobJourneyCoverLetterPage(value: unknown): JobJourneyCoverLetterPage {
  return jobJourneyCoverLetterPageSchema.parse(value);
}
