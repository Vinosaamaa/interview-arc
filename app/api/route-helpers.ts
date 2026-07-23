// Turns a thrown database error into an actionable message. The most common
// first-run failure is a missing table because migrations have not been applied
// to the real D1 database yet.
export function toRouteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const detail = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const combined = `${message}\n${detail}`;

  if (combined.includes("no such table") || combined.includes("D1 binding")) {
    return "Live-state tables are unavailable. For local development run `pnpm dev:prepare`; production applies migrations through the deployment workflow.";
  }

  return message;
}
