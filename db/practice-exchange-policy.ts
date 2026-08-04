export type VoiceIntentStatus =
  | "pending"
  | "activity_related"
  | "accepted"
  | "unrelated"
  | "uncertain"
  | "deleting"
  | "deleted"
  | "discarded_unclassified"
  | "expired_unclassified"
  | "quarantined_conflict";

export type VoiceFinishDisposition =
  | "discard_unclassified"
  | "block_for_delivery"
  | "needs_user_decision"
  | "block_for_deletion"
  | "nonblocking";

export type VoiceFinishGuard = {
  discardedUnclassified: string[];
  awaitingDelivery: string[];
  missingDurableExchange: string[];
  awaitingAudio: string[];
  audioLostNeedsAcknowledgement: string[];
  needsDecision: string[];
  deleting: string[];
  conflicts: string[];
};

export function finishDispositionForVoiceStatus(status: VoiceIntentStatus): VoiceFinishDisposition {
  if (status === "pending") return "discard_unclassified";
  if (status === "activity_related") return "block_for_delivery";
  if (status === "uncertain") return "needs_user_decision";
  if (status === "deleting") return "block_for_deletion";
  return "nonblocking";
}

export function voiceCommitStatusAllowsReplay(status: VoiceIntentStatus) {
  return status === "activity_related" || status === "accepted";
}

export type VoiceCommitIdentity = {
  activityId: string;
  specialty: string;
  turnId: string;
  checksum: string;
};

export function voiceCaptureAllowsCommit(
  intent: (VoiceCommitIdentity & { status: VoiceIntentStatus }) | null | undefined,
  incoming: VoiceCommitIdentity,
) {
  return Boolean(
    intent
    && voiceCommitStatusAllowsReplay(intent.status)
    && intent.activityId === incoming.activityId
    && intent.specialty === incoming.specialty
    && intent.turnId === incoming.turnId
    && intent.checksum === incoming.checksum,
  );
}

export type VoiceCommitTurnIdentity = {
  specialty: string;
  speaker: string;
  body: string;
  source: string;
  sequence: number;
  occurredAt: number;
};

export function sameVoiceCommitTurn(
  existing: VoiceCommitTurnIdentity,
  incoming: VoiceCommitTurnIdentity,
) {
  return existing.specialty === incoming.specialty
    && existing.speaker === incoming.speaker
    && existing.body === incoming.body
    && existing.source === incoming.source
    && existing.sequence === incoming.sequence
    && existing.occurredAt === incoming.occurredAt;
}

export function voiceCaptureDeleteTurnIds(
  userTurnId: string,
  response: { userTurnId: string; responseTurnId: string } | null | undefined,
) {
  return [...new Set([
    userTurnId,
    ...(response?.userTurnId === userTurnId ? [response.responseTurnId] : []),
  ])];
}

export type VoiceCaptureRemediationIdentity = {
  captureId: string;
  activityId: string;
  turnId: string;
};

export type VoiceCaptureRemediationDisposition =
  | { action: "delete"; idempotent: boolean }
  | { action: "already_deleted"; idempotent: true }
  | { action: "reject"; code: string; message: string };

export function voiceCaptureRemediationDisposition(
  intent: (VoiceCaptureRemediationIdentity & { status: VoiceIntentStatus }) | null | undefined,
  expected: VoiceCaptureRemediationIdentity,
): VoiceCaptureRemediationDisposition {
  if (!intent) {
    return {
      action: "reject",
      code: "voice_capture_not_found",
      message: "That owner-scoped Voice capture does not exist.",
    };
  }
  if (
    intent.captureId !== expected.captureId
    || intent.activityId !== expected.activityId
    || intent.turnId !== expected.turnId
  ) {
    return {
      action: "reject",
      code: "voice_capture_identity_mismatch",
      message: "The remediation request does not match the registered Voice envelope identity.",
    };
  }
  if (intent.status === "deleted") {
    return { action: "already_deleted", idempotent: true };
  }
  if (intent.status === "activity_related" || intent.status === "accepted") {
    return { action: "delete", idempotent: false };
  }
  if (intent.status === "deleting") {
    return { action: "delete", idempotent: true };
  }
  return {
    action: "reject",
    code: "voice_capture_not_remediable",
    message: intent.status === "pending"
      ? "This Voice capture is still pending; classify it as unrelated instead of using destructive remediation."
      : `A Voice capture in ${intent.status} state cannot use post-acceptance remediation.`,
  };
}

export function voiceFinishGuardMessage(guard: VoiceFinishGuard) {
  if (guard.conflicts.length) {
    return `${guard.conflicts.length} voice capture ${guard.conflicts.length === 1 ? "has" : "have"} conflicting durable content. Review or discard before finishing.`;
  }
  if (guard.needsDecision.length) {
    return `${guard.needsDecision.length} uncertain voice capture${guard.needsDecision.length === 1 ? "" : "s"} need Attach or Discard before finishing.`;
  }
  if (guard.awaitingDelivery.length) {
    return `${guard.awaitingDelivery.length} related voice capture${guard.awaitingDelivery.length === 1 ? " is" : "s are"} still syncing. Retry delivery or Discard before finishing.`;
  }
  if (guard.missingDurableExchange.length) {
    return `${guard.missingDurableExchange.length} accepted voice exchange${guard.missingDurableExchange.length === 1 ? " is" : "s are"} missing canonical D1 transcript content. Retry delivery or repair the capture before finishing.`;
  }
  if (guard.audioLostNeedsAcknowledgement.length) {
    return `${guard.audioLostNeedsAcknowledgement.length} voice recording${guard.audioLostNeedsAcknowledgement.length === 1 ? " is" : "s are"} permanently unavailable. Acknowledge the preserved transcript and recording-loss incident before finishing.`;
  }
  if (guard.awaitingAudio.length) {
    return `${guard.awaitingAudio.length} related voice recording${guard.awaitingAudio.length === 1 ? " has" : "s have"} not reached private cloud storage. The original is protected locally; Retry upload before finishing.`;
  }
  if (guard.deleting.length) {
    return `${guard.deleting.length} voice capture deletion${guard.deleting.length === 1 ? " is" : "s are"} still in progress. Retry or wait before finishing.`;
  }
  return null;
}

export type CanonicalExchangeIdentity = {
  activityId: string;
  userTurnId: string;
  responseTurnId: string;
  specialty: string;
  responseBody: string;
  responseOccurredAt: number;
};

export function sameCanonicalExchange(
  existing: CanonicalExchangeIdentity,
  incoming: CanonicalExchangeIdentity,
) {
  return existing.activityId === incoming.activityId
    && existing.userTurnId === incoming.userTurnId
    && existing.responseTurnId === incoming.responseTurnId
    && existing.specialty === incoming.specialty
    && existing.responseBody === incoming.responseBody
    && existing.responseOccurredAt === incoming.responseOccurredAt;
}

export type VoiceReceiptState =
  | "activity_related"
  | "unrelated"
  | "uncertain"
  | "failed"
  | "duplicate";

export function voiceDecisionReceipt(state: VoiceReceiptState, activityTitle: string) {
  if (state === "activity_related") {
    return `✓ Attached to ${activityTitle} · Voice evidence syncing`;
  }
  if (state === "unrelated") {
    return "Not attached to this practice activity · Transcript not saved · Recording not uploaded";
  }
  if (state === "uncertain") {
    return "⚠ Voice capture needs your decision · Attach or Discard";
  }
  if (state === "failed") {
    return "⚠ Voice classification was not saved · Retry or Discard";
  }
  return "✓ Capture already processed · Existing specialist response reused";
}

export function typedExchangeReceipt(activityTitle: string) {
  return `✓ Saved to ${activityTitle} practice draft`;
}
