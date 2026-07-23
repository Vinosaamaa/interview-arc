export type MutationFailureDisposition = "discard" | "retry";

// Validation and state conflicts cannot become valid by replaying the exact
// same mutation. Keeping one at the front of the durable queue would prevent
// every later timer, result, and note mutation from reaching D1.
export function mutationFailureDisposition(status: number): MutationFailureDisposition {
  return status === 400 || status === 404 || status === 409 || status === 422
    ? "discard"
    : "retry";
}
