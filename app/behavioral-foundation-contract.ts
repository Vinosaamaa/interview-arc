import { z } from "zod";

const count = z.number().int().nonnegative();

export const behavioralFoundationStatusSchema = z.object({
  schemaVersion: z.literal(1),
  evidence: z.object({
    total: count,
    accepted: count,
    pending: count,
    rejected: count,
    superseded: count,
    projects: count,
    sourceRevisions: count,
  }),
  claims: z.object({
    total: count,
    unverified: count,
    partial: count,
    verified: count,
    contradicted: count,
    questions: count,
  }),
  questionCoverage: z.array(z.object({
    questionId: z.string().min(1),
    claims: count,
    verified: count,
    contradicted: count,
    gaps: count,
  })),
  gaps: z.array(z.object({
    claimId: z.string().min(1),
    questionId: z.string().min(1),
    text: z.string().min(1),
  })),
  stories: z.object({
    total: count,
    active: count,
    archived: count,
    projects: count,
    recent: z.array(z.object({
      storyId: z.string().min(1),
      revision: z.number().int().positive(),
      title: z.string().min(1),
      projectKey: z.string().min(1),
      competencies: z.array(z.string().min(1)),
      questionCount: count,
      gapCount: count,
      updatedAt: z.number().int().positive(),
    })),
    lastUpdatedAt: z.number().int().positive().nullable(),
    limit: count,
    truncated: z.boolean(),
  }),
  capabilities: z.object({
    evidenceRead: z.literal("available"),
    sourceRegistry: z.literal("not_available"),
    storyBank: z.literal("available"),
    resumeLibrary: z.literal("available"),
  }),
  lastUpdatedAt: z.number().int().positive().nullable(),
  limits: z.object({ claimDetails: count, gaps: count, stories: count }),
  truncated: z.object({ claimDetails: z.boolean(), gaps: z.boolean(), stories: z.boolean() }),
});

export type BehavioralFoundationStatus = z.infer<typeof behavioralFoundationStatusSchema>;
