import { z } from "zod";
import type { VoiceResponseGroupReceipt } from "../db/durable-practice";

const orderedCapturesSchema = z.array(z.object({
  captureId: z.string().min(1),
  userTurnId: z.string().min(1),
})).min(2).max(20).superRefine((captures, context) => {
  const captureIds = new Set<string>();
  const turnIds = new Set<string>();
  captures.forEach((capture, index) => {
    if (captureIds.has(capture.captureId)) {
      context.addIssue({ code: "custom", path: [index, "captureId"], message: "Capture IDs must be unique." });
    }
    if (turnIds.has(capture.userTurnId)) {
      context.addIssue({ code: "custom", path: [index, "userTurnId"], message: "User turn IDs must be unique." });
    }
    captureIds.add(capture.captureId);
    turnIds.add(capture.userTurnId);
  });
});

export const voiceCaptureBatchInputSchema = z.object({
  activityId: z.string().min(1),
  activityTitle: z.string().min(1).max(500),
  specialty: z.enum(["leetcode", "system_design", "behavioral"]),
  captures: orderedCapturesSchema,
  responseTurnId: z.string().min(1),
  responseBody: z.string().min(1).max(100_000),
  responseOccurredAt: z.number().int().positive(),
  reason: z.string().min(1).max(2_000),
});

export type VoiceCaptureBatchInput = z.infer<typeof voiceCaptureBatchInputSchema>;

type VoiceCaptureBatchReservation = {
  duplicate: boolean;
  status: string;
  canonicalReceipt?: VoiceResponseGroupReceipt;
};

export async function resolveVoiceCaptureBatch(
  input: VoiceCaptureBatchInput,
  reserve: (input: Omit<VoiceCaptureBatchInput, "activityTitle">) => Promise<VoiceCaptureBatchReservation>,
) {
  const { activityTitle, ...reservation } = input;
  const saved = await reserve(reservation);
  const receipt = saved.duplicate
    ? "✓ Voice capture group already processed · Existing specialist response reused"
    : `✓ Attached ${input.captures.length} recordings to ${activityTitle} · Voice evidence syncing`;
  return {
    activityId: input.activityId,
    captureIds: input.captures.map((capture) => capture.captureId),
    userTurnIds: input.captures.map((capture) => capture.userTurnId),
    responseTurnId: input.responseTurnId,
    status: saved.status,
    canonicalReceipt: saved.canonicalReceipt ?? null,
    duplicate: saved.duplicate,
    receipt,
  };
}
