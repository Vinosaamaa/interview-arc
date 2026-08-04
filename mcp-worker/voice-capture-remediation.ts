import { z } from "zod";
import {
  voiceCaptureRemediationDisposition,
  type VoiceIntentStatus,
} from "../db/practice-exchange-policy.ts";
import { SpecialistControlError } from "../db/specialist-controls-policy.ts";

export const voiceCaptureRemediationInputSchema = z.object({
  captureId: z.string().min(1),
  activityId: z.string().min(1),
  turnId: z.string().min(1),
  authorization: z.literal("explicit_user_instruction"),
  reason: z.string().min(1).max(2_000),
});

export const voiceCaptureRemediationAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
} as const;

export type VoiceCaptureRemediationInput = z.infer<typeof voiceCaptureRemediationInputSchema>;

type RemediationIntent = {
  captureId: string;
  activityId: string;
  turnId: string;
  status: VoiceIntentStatus;
};

type RemediationDependencies = {
  readIntent: (captureId: string) => Promise<RemediationIntent | null | undefined>;
  deleteCapture: (captureId: string, reason: string) => Promise<void>;
};

export async function remediateRelatedVoiceCapture(
  input: VoiceCaptureRemediationInput,
  dependencies: RemediationDependencies,
) {
  const intent = await dependencies.readIntent(input.captureId);
  const disposition = voiceCaptureRemediationDisposition(intent, input);
  if (disposition.action === "reject") {
    throw new SpecialistControlError(disposition.code, disposition.message);
  }
  if (disposition.action === "delete") {
    await dependencies.deleteCapture(input.captureId, input.reason);
  }
  const receipt = disposition.action === "already_deleted"
    ? "Voice capture already deleted · Exact remediation retry acknowledged"
    : "Voice capture deleted · Transcript, response, recording, and delivery analysis removed";
  return {
    captureId: input.captureId,
    activityId: input.activityId,
    turnId: input.turnId,
    status: "deleted" as const,
    idempotent: disposition.idempotent,
    receipt,
  };
}
