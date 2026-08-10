import { sql, type SQL } from "drizzle-orm";
import type { getDb } from "./index";

export function d1TransactionalInvariantGuard(
  db: ReturnType<typeof getDb>,
  condition: SQL,
) {
  return db.select({
    allowed: sql<number>`json_extract(
      CASE WHEN ${condition} THEN '{"allowed":1}' ELSE 'invalid' END,
      '$.allowed'
    )`,
  }).from(sql`(SELECT 1) AS invariant_guard`);
}

export function isD1TransactionalInvariantFailure(error: unknown) {
  return String(error).toLowerCase().includes("malformed json");
}

export type D1TransactionalFailureKind =
  | "invariant_conflict"
  | "constraint_conflict"
  | "unknown";

// Keep platform-specific error adaptation at the D1 boundary. Domain modules
// consume this stable classification and never parse or expose raw SQL errors.
export function classifyD1TransactionalFailure(error: unknown): D1TransactionalFailureKind {
  if (isD1TransactionalInvariantFailure(error)) return "invariant_conflict";
  const code = typeof error === "object" && error
    ? (error as { code?: unknown }).code
    : null;
  if (code === "SQLITE_CONSTRAINT" || code === "D1_CONSTRAINT_ERROR") {
    return "constraint_conflict";
  }
  // Miniflare currently omits SQLite's stable code from this exception. Keep
  // the compatibility fallback centralized here until its typed code ships.
  if (String(error).toLowerCase().includes("constraint failed")) {
    return "constraint_conflict";
  }
  return "unknown";
}
