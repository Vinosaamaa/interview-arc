const unavailable = "Saved role context could not be loaded. Reload this page to reconnect, then retry.";

class BehavioralTargetResponseError extends Error {}

export function behavioralTargetErrorMessage(reason: unknown) {
  return reason instanceof BehavioralTargetResponseError ? reason.message : unavailable;
}

/** Auth gateways may return HTML with a successful status. Never parse it as JSON. */
export async function readBehavioralTargetResponse(response: Response) {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error(unavailable);
  }
  let payload: { error?: string };
  try {
    payload = JSON.parse(await response.text()) as { error?: string };
  } catch {
    throw new Error(unavailable);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(unavailable);
  if (!response.ok) throw new BehavioralTargetResponseError(typeof payload.error === "string" ? payload.error : unavailable);
  return payload;
}
