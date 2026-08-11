import { z } from "zod";

import {
  behavioralTargetDisplaySourceSchema,
  behavioralTargetPastedSourceSchema,
  behavioralTargetProfileInputSchema,
} from "./behavioral-target-profile-policy";

export const loopStableIdSchema = z.string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use a lowercase stable ID.");

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => boundedText(max).optional();

export const loopMemoryConfidenceSchema = z.enum(["exact", "reconstructed"]);
export const loopSpecialtySchema = z.enum(["leetcode", "system_design", "behavioral"]);

export const loopQuestionMemorySchema = z.object({
  memoryId: loopStableIdSchema,
  specialty: loopSpecialtySchema,
  canonicalQuestionId: loopStableIdSchema.optional(),
  promptMemory: optionalText(5_000),
  promptConfidence: loopMemoryConfidenceSchema,
  answerMemory: optionalText(5_000),
  answerConfidence: loopMemoryConfidenceSchema.optional(),
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
  selfAssessment: optionalText(5_000),
  nextStep: optionalText(5_000),
}).strict();

export const loopStageSchema = z.object({
  stageId: loopStableIdSchema,
  label: boundedText(240),
  groupId: loopStableIdSchema.optional(),
  groupLabel: optionalText(240),
  order: z.number().int().nonnegative().max(1_000),
  status: z.enum(["planned", "scheduled", "completed", "cancelled", "skipped"]),
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
  openedAt: z.number().int().positive(),
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

export const loopRoleBriefInputSchema = behavioralTargetProfileInputSchema.omit({ targetId: true });
export const loopRoleBriefMcpInputSchema = loopRoleBriefInputSchema.extend({
  source: behavioralTargetPastedSourceSchema,
});
export const loopRoleBriefDisplaySnapshotSchema = loopRoleBriefInputSchema
  .omit({ source: true, ownerNotes: true })
  .extend({ source: behavioralTargetDisplaySourceSchema });
export const displaySafeLoopRoleBriefRevisionSchema = loopRoleBriefDisplaySnapshotSchema.extend({
  revision: z.number().int().positive(),
  source: behavioralTargetDisplaySourceSchema.and(z.object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })),
  createdAt: z.number().int().positive(),
});

export const createLoopSchema = z.object({
  operationId: loopStableIdSchema,
  authorization: z.literal("loop_recorder"),
  loop: loopSnapshotSchema,
  roleBrief: loopRoleBriefMcpInputSchema,
}).strict();

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
export type CreateLoopInput = z.infer<typeof createLoopSchema>;
export type ReviseLoopInput = z.infer<typeof reviseLoopSchema>;
export type ReviseLoopRoleBriefInput = z.infer<typeof reviseLoopRoleBriefSchema>;
export type DisplaySafeLoopRoleBriefRevision = z.infer<typeof displaySafeLoopRoleBriefRevisionSchema>;
export type TargetProfileMigrationInput = z.infer<typeof targetProfileMigrationSchema>;
export type LoopCapturePacketSnapshot = z.infer<typeof loopCapturePacketSnapshotSchema>;
export type CaptureLoopPacketInput = z.infer<typeof captureLoopPacketSchema>;
export type ImportLoopCapturePacketInput = z.infer<typeof importLoopCapturePacketSchema>;
