// Turns a thrown database error into an actionable message. The most common
// first-run failure is a missing table because migrations have not been applied
// to the real D1 database yet.
export function toRouteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const detail = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const combined = `${message}\n${detail}`;

  if (combined.includes("no such table") || combined.includes("D1 binding")) {
    return "Live-state tables are unavailable. Generate the migration with `pnpm db:generate`, then deploy so the platform applies the SQL to the real D1 database.";
  }

  return message;
}
