export type VoiceDeliveryBlocker = {
  captureId: string;
  retryable: boolean;
  allowedActions: string[];
  [key: string]: unknown;
};

export type VoiceDeliveryBlockerSnapshot = {
  activityId: string;
  blockers: VoiceDeliveryBlocker[];
};

export async function requestVoiceDeliveryRetry(
  activityId: string,
  readBlockers: () => Promise<VoiceDeliveryBlockerSnapshot>,
  publishSignal: () => Promise<boolean>,
) {
  const before = await readBlockers();
  const retryableCaptureIds = before.blockers
    .filter((blocker) => blocker.retryable && blocker.allowedActions.includes("retry_delivery"))
    .map((blocker) => blocker.captureId);
  if (retryableCaptureIds.length === 0) {
    return {
      activityId,
      status: "not_needed" as const,
      retryRequested: false,
      signalPublished: false,
      retryableCaptureIds,
      blockers: before.blockers,
      message: "No retryable Voice delivery blocker is present. Re-read the blockers and follow the listed action for each capture.",
    };
  }

  // The native Voice client owns the protected local originals. A voice_capture
  // event wakes its existing reconciliation/retry queue; this MCP call never
  // fabricates an upload or claims that the asynchronous retry has completed.
  const signalPublished = await publishSignal();
  return {
    activityId,
    status: signalPublished ? "retry_requested" as const : "retry_signal_unavailable" as const,
    retryRequested: true,
    signalPublished,
    retryableCaptureIds,
    blockers: before.blockers,
    message: signalPublished
      ? "The local Voice retry queue was signaled. Re-read get_voice_delivery_blockers after the companion retries; finish only when every required audioState is available."
      : "A retry was eligible, but the live Voice companion could not be signaled. Open the companion and press Retry now, then re-read the blockers.",
  };
}
