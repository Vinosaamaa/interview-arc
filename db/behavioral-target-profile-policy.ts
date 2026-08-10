import { z } from "zod";

export const behavioralTargetStableIdSchema = z.string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use a lowercase stable ID.");
const boundedText = (max: number) => z.string().trim().min(1).max(max);
const boundedList = (items: number, length: number) => z.array(boundedText(length)).max(items);

const verifiedCompanySignalSchema = z.object({
  signal: boundedText(500),
  sourceLabel: boundedText(240),
  verifiedAt: z.number().int().positive(),
}).strict();

export const behavioralTargetPastedSourceSchema = z.object({
  kind: z.literal("pasted_jd"),
  displayLocator: boundedText(240),
  capturedAt: z.number().int().positive(),
  jdText: boundedText(100_000),
}).strict();

export const behavioralTargetPublicSourceSchema = behavioralTargetPastedSourceSchema.extend({
  kind: z.literal("public_posting"),
  displayLocator: z.string().trim().url().max(240),
});

export const behavioralTargetSourceSchema = z.discriminatedUnion("kind", [
  behavioralTargetPastedSourceSchema,
  behavioralTargetPublicSourceSchema,
]);

export const behavioralTargetDisplaySourceSchema = z.discriminatedUnion("kind", [
  behavioralTargetPastedSourceSchema.omit({ jdText: true }),
  behavioralTargetPublicSourceSchema.omit({ jdText: true }),
]);

const behavioralTargetProfileCoreSchema = z.object({
  targetId: behavioralTargetStableIdSchema,
  label: boundedText(240),
  state: z.enum(["active", "archived"]),
  company: boundedText(240),
  roleTitle: boundedText(240),
  targetLevel: boundedText(120).optional(),
  location: boundedText(240).optional(),
  team: boundedText(240).optional(),
  responsibilities: boundedList(100, 1_000),
  requiredQualifications: boundedList(100, 1_000),
  preferredQualifications: boundedList(100, 1_000),
  competencySignals: boundedList(100, 500),
  seniorityIndicators: boundedList(100, 500),
  domainVocabulary: boundedList(100, 200),
  verifiedCompanySignals: z.array(verifiedCompanySignalSchema).max(50),
  unresolvedAmbiguities: boundedList(100, 1_000),
  ownerNotes: boundedList(100, 1_000),
}).strict();

export const behavioralTargetProfileInputSchema = behavioralTargetProfileCoreSchema.extend({
  source: behavioralTargetSourceSchema,
});

export const behavioralTargetProfileWriteSchema = z.object({
  operationId: behavioralTargetStableIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  target: behavioralTargetProfileInputSchema,
}).strict();

export const behavioralTargetProfileMcpWriteSchema = behavioralTargetProfileWriteSchema.extend({
  target: behavioralTargetProfileCoreSchema.extend({ source: behavioralTargetPastedSourceSchema }),
});

export const behavioralTargetPublicWebsiteSourceSchema = z.object({
  kind: z.literal("public_posting"),
  displayLocator: boundedText(240),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const behavioralTargetWebsiteProfileInputSchema = behavioralTargetProfileCoreSchema.extend({
  source: z.discriminatedUnion("kind", [
    behavioralTargetPastedSourceSchema,
    behavioralTargetPublicWebsiteSourceSchema,
  ]),
});

export const behavioralTargetWebsiteProfileWriteSchema = z.object({
  operationId: behavioralTargetStableIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  target: behavioralTargetWebsiteProfileInputSchema,
}).strict();

export const behavioralTargetProfileStateWriteSchema = z.object({
  operationId: behavioralTargetStableIdSchema,
  targetId: behavioralTargetStableIdSchema,
  expectedRevision: z.number().int().positive(),
  state: z.enum(["active", "archived"]),
}).strict();

export const behavioralTargetBindingWriteSchema = z.object({
  mutationId: behavioralTargetStableIdSchema,
  scope: z.object({
    type: z.enum(["session", "activity"]),
    id: behavioralTargetStableIdSchema,
  }).strict(),
  action: z.enum(["set", "clear"]),
  targetId: behavioralTargetStableIdSchema.optional(),
  targetRevision: z.number().int().positive().optional(),
  expectedRevision: z.number().int().nonnegative(),
  authorization: z.literal("explicit_user_instruction"),
}).strict().superRefine((input, context) => {
  if (input.action === "set" && (!input.targetId || !input.targetRevision)) {
    context.addIssue({ code: "custom", path: ["targetId"], message: "Set requires an exact target revision." });
  }
  if (input.action === "clear" && (input.targetId || input.targetRevision)) {
    context.addIssue({ code: "custom", path: ["targetId"], message: "Clear must not include target identity." });
  }
});

export const behavioralTargetProfileDisplaySnapshotSchema = behavioralTargetProfileInputSchema
  .omit({ source: true })
  .extend({ source: behavioralTargetDisplaySourceSchema });

const behavioralTargetDisplayRevisionSourceSchema = z.discriminatedUnion("kind", [
  behavioralTargetPastedSourceSchema.omit({ jdText: true }).extend({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  behavioralTargetPublicSourceSchema.omit({ jdText: true }).extend({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);

export const displaySafeBehavioralTargetRevisionSchema = behavioralTargetProfileDisplaySnapshotSchema.extend({
  revision: z.number().int().positive(),
  source: behavioralTargetDisplayRevisionSourceSchema,
  createdAt: z.number().int().positive(),
});

export const behavioralTargetProfileListSchema = z.object({
  targets: z.array(displaySafeBehavioralTargetRevisionSchema),
  truncated: z.boolean(),
});

export type BehavioralTargetProfileInput = z.infer<typeof behavioralTargetProfileInputSchema>;
export type BehavioralTargetProfileWrite = z.infer<typeof behavioralTargetProfileWriteSchema>;
export type BehavioralTargetWebsiteProfileWrite = z.infer<typeof behavioralTargetWebsiteProfileWriteSchema>;
export type BehavioralTargetProfileStateWrite = z.infer<typeof behavioralTargetProfileStateWriteSchema>;
export type BehavioralTargetBindingWrite = z.infer<typeof behavioralTargetBindingWriteSchema>;
export type BehavioralTargetProfileDisplaySnapshot = z.infer<typeof behavioralTargetProfileDisplaySnapshotSchema>;
export type DisplaySafeBehavioralTargetRevision = z.infer<typeof displaySafeBehavioralTargetRevisionSchema>;
