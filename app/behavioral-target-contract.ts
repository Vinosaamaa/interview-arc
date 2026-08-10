import { z } from "zod";

import {
  behavioralTargetProfileListSchema,
  displaySafeBehavioralTargetRevisionSchema,
} from "../db/behavioral-target-profile-policy";

export { behavioralTargetProfileListSchema, displaySafeBehavioralTargetRevisionSchema };
export type { DisplaySafeBehavioralTargetRevision } from "../db/behavioral-target-profile-policy";

export const behavioralTargetDirectBindingSchema = z.object({
  scopeType: z.enum(["session", "activity"]),
  scopeId: z.string().min(1),
  targetId: z.string().min(1).nullable(),
  targetRevision: z.number().int().positive().nullable(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).nullable();

export const behavioralTargetResolutionSchema = z.object({
  source: z.enum(["activity", "session", "none"]),
  binding: behavioralTargetDirectBindingSchema,
  target: displaySafeBehavioralTargetRevisionSchema.nullable(),
});

export const behavioralTargetBindingReadSchema = z.object({
  directBinding: behavioralTargetDirectBindingSchema,
  resolution: behavioralTargetResolutionSchema,
});

export const behavioralTargetPublicPreviewSchema = z.object({
  status: z.literal("available"),
  change: z.enum(["new", "unchanged", "changed"]),
  freshness: z.literal("current"),
  source: z.object({
    kind: z.literal("public_posting"),
    displayLocator: z.string().url(),
    capturedAt: z.number().int().positive(),
    jdText: z.string().min(1).max(100_000),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});

export type BehavioralTargetBindingRead = z.infer<typeof behavioralTargetBindingReadSchema>;
export type BehavioralTargetPublicPreview = z.infer<typeof behavioralTargetPublicPreviewSchema>;
