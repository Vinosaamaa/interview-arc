import { z } from "zod";

import {
  behavioralTargetPastedSourceSchema,
  behavioralTargetProfileInputSchema,
  behavioralTargetPublicSourceSchema,
} from "./behavioral-target-profile-policy.ts";

export const loopStableIdSchema = z.string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use a lowercase stable ID.");

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => boundedText(max).optional();

export const loopMemoryConfidenceSchema = z.enum(["exact", "reconstructed"]);
export const loopSpecialtySchema = z.enum(["leetcode", "system_design", "behavioral"]);
export const loopOwnerAssessmentSchema = z.enum(["strong", "mixed", "needs_work"]);

export const loopActivityContextRequestSchema = z.object({
  loopId: loopStableIdSchema,
  stageId: loopStableIdSchema.optional(),
}).strict();

export const loopActivityContextProjectionSchema = loopActivityContextRequestSchema.extend({
  loopRevision: z.number().int().positive(),
  roleBriefRevision: z.number().int().positive(),
  company: boundedText(240),
  roleTitle: boundedText(240),
}).strict();

export const bindPlannedActivitySchema = z.object({
  loopId: loopStableIdSchema,
  stageId: loopStableIdSchema.optional(),
  operationId: loopStableIdSchema,
  activityId: loopStableIdSchema,
  expectedActivityRevision: z.number().int().positive(),
  authorization: z.literal("explicit_user_instruction"),
}).strict();

export const linkCompletedActivitySchema = z.object({
  loopId: loopStableIdSchema,
  stageId: loopStableIdSchema.optional(),
  operationId: loopStableIdSchema,
  activityId: loopStableIdSchema,
  expectedLoopRevision: z.number().int().positive(),
  expectedRoleBriefRevision: z.number().int().positive(),
  authorization: z.literal("explicit_user_instruction"),
}).strict();

export const loopQuestionMemorySchema = z.object({
  memoryId: loopStableIdSchema,
  specialty: loopSpecialtySchema,
  canonicalQuestionId: loopStableIdSchema.optional(),
  promptMemory: optionalText(5_000),
  promptConfidence: loopMemoryConfidenceSchema,
  answerMemory: optionalText(5_000),
  answerConfidence: loopMemoryConfidenceSchema.optional(),
  ownerReview: z.object({
    assessment: loopOwnerAssessmentSchema.optional(),
    approach: optionalText(5_000),
    summary: optionalText(5_000),
  }).strict().refine((review) => Boolean(review.assessment || review.approach || review.summary), {
    message: "An owner review requires an explicit assessment, approach, or summary.",
  }).optional(),
}).strict().superRefine((memory, context) => {
  if (!memory.canonicalQuestionId && !memory.promptMemory) {
    context.addIssue({
      code: "custom",
      path: ["promptMemory"],
      message: "A remembered question requires canonical identity or bounded prompt memory.",
    });
  }
  if (memory.answerMemory && !memory.answerConfidence) {
    context.addIssue({
      code: "custom",
      path: ["answerConfidence"],
      message: "A remembered answer must be labelled exact or reconstructed.",
    });
  }
  if (!memory.answerMemory && memory.answerConfidence) {
    context.addIssue({
      code: "custom",
      path: ["answerConfidence"],
      message: "Answer confidence is only valid with remembered answer text.",
    });
  }
});

export const loopRoundDebriefSchema = z.object({
  capturedAt: z.number().int().positive(),
  questions: z.array(loopQuestionMemorySchema).max(50),
  // Legacy round-level notes remain readable, but the current contract records
  // assessment at question level and the stage result on the stage itself.
  selfAssessment: optionalText(5_000),
  interviewerFeedback: optionalText(5_000),
  nextStep: optionalText(5_000),
}).strict();

export const loopStageSchema = z.object({
  stageId: loopStableIdSchema,
  label: boundedText(240),
  groupId: loopStableIdSchema.optional(),
  groupLabel: optionalText(240),
  order: z.number().int().nonnegative().max(1_000),
  status: z.enum(["planned", "scheduled", "completed", "cancelled", "skipped"]),
  format: optionalText(240),
  interviewers: z.array(boundedText(240)).max(25).optional(),
  scheduledAt: z.number().int().positive().optional(),
  startedAt: z.number().int().positive().optional(),
  completedAt: z.number().int().positive().optional(),
  cancelledAt: z.number().int().positive().optional(),
  outcome: z.enum(["advanced", "not_advanced", "offer", "rejected", "withdrawn", "cancelled"]).optional(),
  debrief: loopRoundDebriefSchema.optional(),
}).strict().superRefine((stage, context) => {
  if (Boolean(stage.groupId) !== Boolean(stage.groupLabel)) {
    context.addIssue({
      code: "custom",
      path: ["groupLabel"],
      message: "A stage group requires both stable identity and display label.",
    });
  }
});

export const loopSnapshotSchema = z.object({
  loopId: loopStableIdSchema,
  state: z.enum(["active", "archived"]),
  company: boundedText(240),
  roleTitle: boundedText(240),
  jobReference: optionalText(240),
  location: optionalText(240),
  status: z.enum(["active", "paused", "completed", "withdrawn"]),
  openedAt: z.number().int().positive().optional(),
  closedAt: z.number().int().positive().optional(),
  outcome: z.enum(["offer", "rejected", "withdrawn", "closed"]).nullable(),
  stages: z.array(loopStageSchema).max(100),
}).strict().superRefine((loop, context) => {
  const stageIds = new Set<string>();
  const orders = new Set<number>();
  const groups = new Map<string, string>();
  loop.stages.forEach((stage, index) => {
    if (stageIds.has(stage.stageId)) {
      context.addIssue({ code: "custom", path: ["stages", index, "stageId"], message: "Stage IDs must be unique in one Loop." });
    }
    stageIds.add(stage.stageId);
    if (orders.has(stage.order)) {
      context.addIssue({ code: "custom", path: ["stages", index, "order"], message: "Stage order values must be unique in one Loop." });
    }
    orders.add(stage.order);
    if (stage.groupId && stage.groupLabel) {
      const prior = groups.get(stage.groupId);
      if (prior && prior !== stage.groupLabel) {
        context.addIssue({ code: "custom", path: ["stages", index, "groupLabel"], message: "One stage group must keep one display label." });
      }
      groups.set(stage.groupId, stage.groupLabel);
    }
  });
});

export const loopRoleBriefReferenceSourceSchema = z.object({
  kind: z.literal("public_posting_reference"),
  displayLocator: z.string().trim().url().max(240),
  capturedAt: z.number().int().positive(),
}).strict();

const loopRoleBriefCoreSchema = behavioralTargetProfileInputSchema.omit({ targetId: true, source: true });
export const loopRoleBriefSourceSchema = z.discriminatedUnion("kind", [
  behavioralTargetPastedSourceSchema,
  behavioralTargetPublicSourceSchema,
  loopRoleBriefReferenceSourceSchema,
]);
export const loopRoleBriefInputSchema = loopRoleBriefCoreSchema.extend({ source: loopRoleBriefSourceSchema });
export const loopRoleBriefMcpInputSchema = loopRoleBriefCoreSchema.extend({
  source: behavioralTargetPastedSourceSchema,
});
export const loopRoleBriefDisplaySourceSchema = z.discriminatedUnion("kind", [
  behavioralTargetPastedSourceSchema.omit({ jdText: true }),
  behavioralTargetPublicSourceSchema.omit({ jdText: true }),
  loopRoleBriefReferenceSourceSchema,
]);
export const loopRoleBriefDisplaySnapshotSchema = loopRoleBriefCoreSchema
  .omit({ ownerNotes: true })
  .extend({ source: loopRoleBriefDisplaySourceSchema });
export const displaySafeLoopRoleBriefRevisionSchema = loopRoleBriefDisplaySnapshotSchema.extend({
  revision: z.number().int().positive(),
  source: loopRoleBriefDisplaySourceSchema.and(z.object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })),
  createdAt: z.number().int().positive(),
});

export const loopInterviewMaterialSectionSchema = z.object({
  sectionId: loopStableIdSchema,
  title: boundedText(240),
  body: optionalText(10_000),
  bullets: z.array(boundedText(2_000)).max(100),
}).strict().superRefine((section, context) => {
  if (!section.body && section.bullets.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["body"],
      message: "An interview-material section requires prose or at least one bullet.",
    });
  }
});

export const loopInterviewMaterialSnapshotSchema = z.object({
  materialId: loopStableIdSchema,
  loopId: loopStableIdSchema,
  stageId: loopStableIdSchema.optional(),
  kind: z.literal("interview_prep"),
  state: z.enum(["active", "archived"]),
  label: boundedText(240),
  summary: optionalText(2_000),
  sections: z.array(loopInterviewMaterialSectionSchema).min(1).max(50),
  provenance: z.object({
    kind: z.literal("owner_authorized_synthesis"),
    roleBriefRevision: z.number().int().positive(),
    activityIds: z.array(loopStableIdSchema).max(100),
    sourceLabel: boundedText(240),
    preparedAt: z.number().int().positive(),
  }).strict(),
}).strict().superRefine((material, context) => {
  const sectionIds = new Set<string>();
  material.sections.forEach((section, index) => {
    if (sectionIds.has(section.sectionId)) {
      context.addIssue({
        code: "custom",
        path: ["sections", index, "sectionId"],
        message: "Material section IDs must be unique within one revision.",
      });
    }
    sectionIds.add(section.sectionId);
  });
  const activityIds = new Set(material.provenance.activityIds);
  if (activityIds.size !== material.provenance.activityIds.length) {
    context.addIssue({
      code: "custom",
      path: ["provenance", "activityIds"],
      message: "Material provenance cannot repeat one activity identity.",
    });
  }
});

const loopInterviewMaterialWriteBaseSchema = z.object({
  operationId: loopStableIdSchema,
  authorization: z.literal("loop_recorder"),
  expectedLoopRevision: z.number().int().positive(),
  expectedRoleBriefRevision: z.number().int().positive(),
  material: loopInterviewMaterialSnapshotSchema,
});

export const createLoopInterviewMaterialSchema = loopInterviewMaterialWriteBaseSchema.strict()
  .refine((input) => input.material.provenance.roleBriefRevision === input.expectedRoleBriefRevision, {
    path: ["material", "provenance", "roleBriefRevision"],
    message: "Material provenance must pin the expected Role Brief revision.",
  });

export const reviseLoopInterviewMaterialSchema = loopInterviewMaterialWriteBaseSchema.extend({
  materialId: loopStableIdSchema,
  expectedRevision: z.number().int().positive(),
}).strict().superRefine((input, context) => {
  if (input.materialId !== input.material.materialId) {
    context.addIssue({
      code: "custom",
      path: ["material", "materialId"],
      message: "Interview material identity cannot change during revision.",
    });
  }
  if (input.material.provenance.roleBriefRevision !== input.expectedRoleBriefRevision) {
    context.addIssue({
      code: "custom",
      path: ["material", "provenance", "roleBriefRevision"],
      message: "Material provenance must pin the expected Role Brief revision.",
    });
  }
});

export const queryLoopInterviewMaterialsSchema = z.object({
  loopId: loopStableIdSchema.optional(),
  stageId: loopStableIdSchema.optional(),
  materialId: loopStableIdSchema.optional(),
  revision: z.number().int().positive().optional(),
  includeArchived: z.boolean().optional(),
}).strict().superRefine((input, context) => {
  if (input.stageId && !input.loopId) {
    context.addIssue({ code: "custom", path: ["loopId"], message: "Round filtering requires one Loop." });
  }
  if (input.revision && !input.materialId) {
    context.addIssue({ code: "custom", path: ["materialId"], message: "Historical material reads require one material ID." });
  }
});

const createLoopPayloadSchema = z.object({
  operationId: loopStableIdSchema,
  loop: loopSnapshotSchema,
  roleBrief: loopRoleBriefMcpInputSchema,
});

export const createLoopSchema = createLoopPayloadSchema.extend({
  authorization: z.literal("loop_recorder"),
}).strict();

export const createLoopCommandSchema = createLoopPayloadSchema.extend({
  authorization: z.enum(["loop_recorder", "website_owner"]),
  roleBrief: loopRoleBriefInputSchema,
}).strict();

const websiteOptionalText = (max: number) => z.string().trim().max(max).optional();
const websiteDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a calendar date.")
  .refine((value) => {
    const timestamp = Date.parse(`${value}T12:00:00.000Z`);
    return !Number.isNaN(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  }, "Use a real calendar date.");
export const websiteCreateLoopSchema = z.object({
  schemaVersion: z.literal(1),
  operationId: loopStableIdSchema,
  company: boundedText(240),
  roleTitle: boundedText(240),
  location: websiteOptionalText(240),
  openedOn: websiteDateSchema.optional(),
  jobDescription: z.object({
    text: websiteOptionalText(100_000),
    sourceUrl: z.string().trim().url().max(240).optional(),
  }).strict(),
  stages: z.array(z.object({
    label: boundedText(240),
    status: z.enum(["planned", "scheduled"]),
    scheduledOn: websiteDateSchema.optional(),
    format: websiteOptionalText(240),
  }).strict()).max(25),
  unknowns: z.array(z.enum(["location", "openedOn", "stages", "jobDescriptionText"])).max(4),
}).strict().superRefine((input, context) => {
  const unknowns = new Set(input.unknowns);
  if (unknowns.size !== input.unknowns.length) {
    context.addIssue({ code: "custom", path: ["unknowns"], message: "Each unknown fact may be recorded only once." });
  }
  const pairs: Array<["location" | "openedOn" | "stages", boolean]> = [
    ["location", Boolean(input.location)],
    ["openedOn", Boolean(input.openedOn)],
    ["stages", input.stages.length > 0],
  ];
  for (const [field, present] of pairs) {
    if (present === unknowns.has(field)) {
      context.addIssue({
        code: "custom",
        path: field === "stages" ? ["unknowns"] : [field],
        message: present
          ? `${field} cannot be both supplied and marked unknown.`
          : `${field} must be supplied or explicitly marked unknown.`,
      });
    }
  }
  const hasText = Boolean(input.jobDescription.text);
  if (!hasText && !input.jobDescription.sourceUrl) {
    context.addIssue({
      code: "custom",
      path: ["jobDescription"],
      message: "Provide job-description text or one HTTPS source URL.",
    });
  }
  if (hasText === unknowns.has("jobDescriptionText")) {
    context.addIssue({
      code: "custom",
      path: ["jobDescription", "text"],
      message: hasText
        ? "Job-description text cannot be both supplied and marked unknown."
        : "Missing job-description text must be explicitly marked unknown.",
    });
  }
  if (input.jobDescription.sourceUrl) {
    try {
      const source = new URL(input.jobDescription.sourceUrl);
      if (source.protocol !== "https:" || source.username || source.password) throw new Error("unsafe");
    } catch {
      context.addIssue({
        code: "custom",
        path: ["jobDescription", "sourceUrl"],
        message: "Use a credential-free HTTPS job source URL.",
      });
    }
  }
  const stageLabels = new Set<string>();
  input.stages.forEach((stage, index) => {
    const canonicalLabel = stage.label.normalize("NFKC").toLocaleLowerCase("en-US");
    if (stageLabels.has(canonicalLabel)) {
      context.addIssue({ code: "custom", path: ["stages", index, "label"], message: "Stage labels must be unique in one Loop." });
    }
    stageLabels.add(canonicalLabel);
    if (stage.status === "scheduled" && !stage.scheduledOn) {
      context.addIssue({ code: "custom", path: ["stages", index, "scheduledOn"], message: "A scheduled stage needs its known date." });
    }
    if (stage.status === "planned" && stage.scheduledOn) {
      context.addIssue({ code: "custom", path: ["stages", index, "scheduledOn"], message: "Choose Scheduled before adding a stage date." });
    }
  });
});

export const reviseLoopSchema = z.object({
  operationId: loopStableIdSchema,
  loopId: loopStableIdSchema,
  expectedRevision: z.number().int().positive(),
  authorization: z.literal("loop_recorder"),
  loop: loopSnapshotSchema,
}).strict().refine((input) => input.loopId === input.loop.loopId, {
  path: ["loop", "loopId"],
  message: "Loop identity cannot change during revision.",
});

export const reviseLoopRoleBriefSchema = z.object({
  operationId: loopStableIdSchema,
  loopId: loopStableIdSchema,
  expectedRevision: z.number().int().positive(),
  authorization: z.literal("loop_recorder"),
  roleBrief: loopRoleBriefMcpInputSchema,
}).strict();

export const queryLoopsSchema = z.object({
  loopId: loopStableIdSchema.optional(),
  loopRevision: z.number().int().positive().optional(),
  roleBriefRevision: z.number().int().positive().optional(),
  includeArchived: z.boolean().optional(),
}).strict().superRefine((input, context) => {
  if ((input.loopRevision || input.roleBriefRevision) && !input.loopId) {
    context.addIssue({ code: "custom", path: ["loopId"], message: "Historical revisions require a Loop ID." });
  }
});

export const queryLoopRoleBriefSourceSchema = z.object({
  loopId: loopStableIdSchema,
  roleBriefRevision: z.number().int().positive().optional(),
  includeArchived: z.boolean().optional(),
}).strict();

const targetProfileMigrationBaseSchema = z.object({
  operationId: loopStableIdSchema,
  targetId: loopStableIdSchema,
  targetRevision: z.number().int().positive(),
  authorization: z.literal("loop_recorder"),
});

export const targetProfileMigrationSchema = z.discriminatedUnion("action", [
  targetProfileMigrationBaseSchema.extend({
    action: z.literal("create_loop"),
    loop: loopSnapshotSchema,
  }).strict(),
  targetProfileMigrationBaseSchema.extend({
    action: z.literal("attach_existing_loop"),
    loopId: loopStableIdSchema,
    expectedRoleBriefRevision: z.number().int().positive(),
  }).strict(),
  targetProfileMigrationBaseSchema.extend({
    action: z.literal("archive"),
  }).strict(),
]);

export const queryRoleBriefMigrationInboxSchema = z.object({
  includeDecided: z.boolean().optional(),
  includeArchivedTargets: z.boolean().optional(),
}).strict();

export const loopCapturePacketSnapshotSchema = z.object({
  packetId: loopStableIdSchema,
  company: boundedText(240),
  roleTitle: boundedText(240),
  jobReference: optionalText(240),
  capturedAt: z.number().int().positive(),
  stage: loopStageSchema,
}).strict().superRefine((packet, context) => {
  if (!packet.stage.debrief) {
    context.addIssue({ code: "custom", path: ["stage", "debrief"], message: "A capture packet requires the remembered round debrief." });
  }
});

export const captureLoopPacketSchema = z.object({
  operationId: loopStableIdSchema,
  authorization: z.literal("loop_recorder"),
  packet: loopCapturePacketSnapshotSchema,
}).strict();

export const queryLoopCapturePacketsSchema = z.object({
  packetId: loopStableIdSchema.optional(),
  includeImported: z.boolean().optional(),
}).strict();

export const importLoopCapturePacketSchema = z.object({
  operationId: loopStableIdSchema,
  packetId: loopStableIdSchema,
  loopId: loopStableIdSchema,
  expectedLoopRevision: z.number().int().positive(),
  backfilledAt: z.number().int().positive(),
  authorization: z.literal("loop_recorder"),
}).strict().refine((input) => input.backfilledAt > 0, {
  path: ["backfilledAt"],
  message: "Backfilled time must be explicit.",
});

export type LoopSnapshot = z.infer<typeof loopSnapshotSchema>;
export type LoopRoleBriefInput = z.infer<typeof loopRoleBriefInputSchema>;
export type LoopRoleBriefDisplaySnapshot = z.infer<typeof loopRoleBriefDisplaySnapshotSchema>;
export type LoopInterviewMaterialSnapshot = z.infer<typeof loopInterviewMaterialSnapshotSchema>;
export type CreateLoopInterviewMaterialInput = z.infer<typeof createLoopInterviewMaterialSchema>;
export type ReviseLoopInterviewMaterialInput = z.infer<typeof reviseLoopInterviewMaterialSchema>;
export type CreateLoopInput = z.infer<typeof createLoopSchema>;
export type CreateLoopCommandInput = z.infer<typeof createLoopCommandSchema>;
export type WebsiteCreateLoopInput = z.infer<typeof websiteCreateLoopSchema>;
export type ReviseLoopInput = z.infer<typeof reviseLoopSchema>;
export type ReviseLoopRoleBriefInput = z.infer<typeof reviseLoopRoleBriefSchema>;
export type DisplaySafeLoopRoleBriefRevision = z.infer<typeof displaySafeLoopRoleBriefRevisionSchema>;
export type TargetProfileMigrationInput = z.infer<typeof targetProfileMigrationSchema>;
export type LoopCapturePacketSnapshot = z.infer<typeof loopCapturePacketSnapshotSchema>;
export type CaptureLoopPacketInput = z.infer<typeof captureLoopPacketSchema>;
export type ImportLoopCapturePacketInput = z.infer<typeof importLoopCapturePacketSchema>;
export type LoopActivityContextRequest = z.infer<typeof loopActivityContextRequestSchema>;
export type LoopActivityContextProjection = z.infer<typeof loopActivityContextProjectionSchema>;
export type BindPlannedActivityInput = z.infer<typeof bindPlannedActivitySchema>;
export type LinkCompletedActivityInput = z.infer<typeof linkCompletedActivitySchema>;
