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
