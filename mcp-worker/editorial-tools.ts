import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { practiceEditorialSchema, readPracticeEditorial, savePracticeEditorial } from "../db/practice-editorial.ts";

export function registerEditorialTools(server: McpServer, db: Pick<D1Database, "prepare" | "batch">, owner: string) {
  server.registerTool("backfill_practice_editorial", {
    description: "Append official-editorial research to a completed native or imported LeetCode Practice Record. Read the real editorial first and supply its matching canonical URL, observed time, SHA256 and approaches. Use expectedRevision=0 initially, or read the current editorial revision before correction. Retry identical operationId/content after uncertainty. Preserves transcript, timing, outcome and original practice; does not generate research or promote a reusable Solution Profile.",
    inputSchema: practiceEditorialSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (input) => {
    try { const result = await savePracticeEditorial(db, owner, input); return { content: [{ type: "text", text: `Editorial revision ${result.editorial.revision} saved and verified.` }], structuredContent: result }; }
    catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Editorial save failed." }] }; }
  });
  server.registerTool("get_practice_editorial", {
    description: "Read the latest or exact historical owner-private editorial addition for a native or imported Practice Record. Null means no editorial addition is saved.",
    inputSchema: { activityId: z.string().min(1).max(240), revision: z.number().int().positive().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ activityId, revision }) => {
    const editorial = await readPracticeEditorial(db, owner, activityId, revision);
    return { content: [{ type: "text", text: JSON.stringify({ editorial }) }], structuredContent: { editorial } };
  });
}
