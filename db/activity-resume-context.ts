import { z } from "zod";

const stableIdSchema = z.string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use a lowercase stable ID.");
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256 fingerprint.");

export const resumeContextSelectionSchema = z.object({
  resumeId: stableIdSchema,
  revisionId: stableIdSchema,
}).strict();

export const backfillActivityResumeContextSchema = z.object({
  operationId: stableIdSchema,
  activityId: stableIdSchema,
  snapshotRevision: z.number().int().positive(),
  resumeId: stableIdSchema,
  resumeRevisionId: stableIdSchema,
  provenance: z.object({
    sourceFingerprint: sha256Schema,
    docxSha256: sha256Schema,
    pdfSha256: sha256Schema,
    resumeImportedAt: z.number().int().positive(),
    snapshotLoadedAt: z.number().int().positive(),
  }).strict(),
  authorization: z.literal("explicit_user_instruction"),
  ownerConfirmedAt: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1_000),
}).strict().superRefine((input, context) => {
  if (input.ownerConfirmedAt < input.provenance.snapshotLoadedAt) {
    context.addIssue({
      code: "custom",
      path: ["ownerConfirmedAt"],
      message: "Owner confirmation cannot predate loading the exact resume snapshot.",
    });
  }
});

export const storedActivityResumeContextSchema = z.object({
  schemaVersion: z.literal(1),
  state: z.enum(["contemporaneous", "backfilled"]),
  snapshotRevision: z.number().int().positive(),
  resumeId: stableIdSchema,
  resumeRevisionId: stableIdSchema,
  sourceLabel: z.string().trim().min(1).max(240),
  resumeImportedAt: z.number().int().positive(),
  claimIds: z.array(stableIdSchema).max(100),
  evidenceIds: z.array(stableIdSchema).max(100),
  capturedAt: z.number().int().positive(),
}).strict().superRefine((context, refinement) => {
  for (const key of ["claimIds", "evidenceIds"] as const) {
    if (new Set(context[key]).size !== context[key].length) {
      refinement.addIssue({
        code: "custom",
        path: [key],
        message: `${key} must contain unique stable IDs.`,
      });
    }
  }
});

export type ResumeContextSelection = z.infer<typeof resumeContextSelectionSchema>;
export type BackfillActivityResumeContextInput = z.infer<typeof backfillActivityResumeContextSchema>;
export type ActivityResumeContext = z.infer<typeof storedActivityResumeContextSchema>;

export function renderActivityResumeContextMarkdown(context: ActivityResumeContext | null) {
  if (!context) return "";
  const claims = context.claimIds.length ? context.claimIds.join(", ") : "None linked.";
  const evidence = context.evidenceIds.length ? context.evidenceIds.join(", ") : "None linked.";
  return [
    "## Resume context",
    "",
    `${context.sourceLabel} · revision ${context.resumeRevisionId}`,
    "",
    `Captured with final-answer snapshot revision ${context.snapshotRevision} · ${context.state}`,
    "",
    `Claim references: ${claims}`,
    "",
    `Evidence references: ${evidence}`,
  ].join("\n");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderActivityResumeContextHtml(context: ActivityResumeContext | null) {
  if (!context) return "";
  const claims = context.claimIds.length ? context.claimIds.map(escapeHtml).join(", ") : "None linked.";
  const evidence = context.evidenceIds.length ? context.evidenceIds.map(escapeHtml).join(", ") : "None linked.";
  return [
    '<section data-activity-resume-context="true">',
    "<h2>Resume context</h2>",
    `<p>${escapeHtml(context.sourceLabel)} · revision ${escapeHtml(context.resumeRevisionId)}</p>`,
    `<p>Captured with final-answer snapshot revision ${context.snapshotRevision} · ${context.state}</p>`,
    `<p>Claim references: ${claims}</p>`,
    `<p>Evidence references: ${evidence}</p>`,
    "</section>",
  ].join("");
}
