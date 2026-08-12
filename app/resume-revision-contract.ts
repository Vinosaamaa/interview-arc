import { z } from "zod";

export const resumeStableIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const resumeRevisionFileSchema = z.object({
  format: z.enum(["docx", "pdf"]),
  sha256,
  byteSize: z.number().int().positive(),
  mimeType: z.string().min(1).max(120),
  downloadPath: z.string().regex(/^\/api\/resume-library\/[a-z0-9][a-z0-9._-]{0,199}\/[a-z0-9][a-z0-9._-]{0,199}\/(?:docx|pdf)$/),
}).strict();

export const resumeBulletSchema = z.object({
  occurrenceId: resumeStableIdSchema,
  sectionLabel: z.string().min(1).max(160),
  ordinal: z.number().int().nonnegative().max(999),
  text: z.string().min(1).max(2_000),
  contentFingerprint: sha256,
  claimIds: z.array(resumeStableIdSchema).max(20),
  evidenceIds: z.array(resumeStableIdSchema).max(20),
}).strict();

const reviewImpactSchema = z.object({
  questionId: resumeStableIdSchema,
  solutionProfileRevision: z.number().int().positive(),
  changedClaimIds: z.array(resumeStableIdSchema).max(40),
  status: z.enum(["needs_review", "acknowledged"]),
  createdAt: z.number().int().positive(),
  acknowledgedAt: z.number().int().positive().nullable(),
}).strict();

export const resumeRevisionResponseSchema = z.object({
  found: z.literal(true),
  schemaVersion: z.literal(1),
  source: z.object({
    resumeId: resumeStableIdSchema,
    sourceLabel: z.string().min(1).max(120),
    currentRevisionId: resumeStableIdSchema.nullable(),
    updatedAt: z.number().int().positive(),
  }).strict(),
  revision: z.object({
    revisionId: resumeStableIdSchema,
    parentRevisionId: resumeStableIdSchema.nullable(),
    current: z.boolean(),
    sourceFingerprint: sha256,
    sourceProvider: z.enum(["google_drive", "local_file"]).nullable(),
    sourceRevisionFingerprint: sha256.nullable(),
    manifestFingerprint: sha256.nullable(),
    extractionVersion: z.string().min(1).max(80).nullable(),
    importedAt: z.number().int().positive(),
    files: z.array(resumeRevisionFileSchema).max(2),
    bullets: z.array(resumeBulletSchema).max(240),
    reviewImpacts: z.array(reviewImpactSchema).max(100),
    truncated: z.object({
      bullets: z.boolean(),
      links: z.boolean(),
      reviewImpacts: z.boolean(),
    }).strict(),
  }).strict(),
}).strict();

const stringDeltaSchema = z.object({
  added: z.array(resumeStableIdSchema).max(400),
  removed: z.array(resumeStableIdSchema).max(400),
}).strict();

export const resumeRevisionComparisonSchema = z.object({
  found: z.literal(true),
  schemaVersion: z.literal(1),
  resumeId: resumeStableIdSchema,
  fromRevisionId: resumeStableIdSchema,
  toRevisionId: resumeStableIdSchema,
  summary: z.object({
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
  }).strict(),
  added: z.array(resumeBulletSchema).max(240),
  removed: z.array(resumeBulletSchema).max(240),
  changed: z.array(z.object({
    occurrenceId: resumeStableIdSchema,
    before: resumeBulletSchema,
    after: resumeBulletSchema,
    changes: z.object({
      contentChanged: z.boolean(),
      positionChanged: z.boolean(),
      claimDelta: stringDeltaSchema,
      evidenceDelta: stringDeltaSchema,
    }).strict(),
  }).strict()).max(240),
  unchangedOccurrenceIds: z.array(resumeStableIdSchema).max(240),
  references: z.object({ claims: stringDeltaSchema, evidence: stringDeltaSchema }).strict(),
}).strict();

export type ResumeRevisionResponse = z.infer<typeof resumeRevisionResponseSchema>;
export type ResumeRevisionComparison = z.infer<typeof resumeRevisionComparisonSchema>;
