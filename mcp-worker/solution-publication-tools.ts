import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpecialistFinalization } from "../db/durable-practice";
import type { PracticeSolutionPublicationInput } from "../db/practice-solution-publication";
import { enqueueSpecialistWriteJob, readSpecialistWriteJobs, type SpecialistWriteReceipt } from "../db/specialist-write-jobs";
import { specialistWritePayloadDigest } from "./specialist-write-policy";

type WithoutOperation<T> = T extends unknown ? Omit<T, "operationId"> : never;
export type SolutionPublicationBatch = { batchId: string; items: WithoutOperation<PracticeSolutionPublicationInput>[] };

export async function solutionBatchJobId(batchId: string) {
  return `solution-batch-${await specialistWritePayloadDigest({ batchId })}`;
}

export async function solutionItemJobId(batchId: string, activityId: string) {
  return `solution-publication-${await specialistWritePayloadDigest({ batchId, activityId })}`;
}

// The parent reserves the immutable manifest. Its execution only enqueues
// children; each child owns a separate durable result and retry boundary.
export async function enqueueSolutionBatchItems(ownerId: string, batch: SolutionPublicationBatch) {
  const items = [];
  for (const item of batch.items) {
    const jobId = await solutionItemJobId(batch.batchId, item.activityId);
    await enqueueSpecialistWriteJob(ownerId, {
      jobId, operation: "practice_solution_publication", payload: { ...item, operationId: jobId },
    });
    items.push({ activityId: item.activityId, jobId });
  }
  return { batchId: batch.batchId, items };
}

export function summarizeSolutionBatch(parent: SpecialistWriteReceipt, children: SpecialistWriteReceipt[]) {
  const manifest = parent.result as { items?: { activityId: string; jobId: string }[] } | null;
  const byId = new Map(children.map(item => [item.jobId, item]));
  const items = (manifest?.items ?? []).map(item => ({ ...item, receipt: byId.get(item.jobId) ?? null }));
  const settled = items.length > 0 && items.every(item => item.receipt && ["saved", "failed"].includes(item.receipt.status));
  const status = parent.status === "failed" ? "failed"
    : !settled ? "pending"
    : items.some(item => item.receipt?.status === "failed") ? "partial_failure" : "saved";
  return { status, batchReceipt: parent, items };
}

export async function readSolutionBatch(ownerId: string, batchId: string) {
  const [parent] = await readSpecialistWriteJobs(ownerId, [await solutionBatchJobId(batchId)]);
  if (!parent || parent.operation !== "practice_solution_batch") throw new Error("No solution batch belongs to this owner and ID.");
  const manifest = parent.result as { items?: { jobId: string }[] } | null;
  const children = await readSpecialistWriteJobs(ownerId, (manifest?.items ?? []).map(item => item.jobId));
  return { batchId, ...summarizeSolutionBatch(parent, children) };
}

export function registerSolutionPublicationTools(
  server: McpServer,
  ownerId: string,
  profileSchema: z.ZodType<NonNullable<SpecialistFinalization["solutionProfile"]>>,
  scheduleProcessing: () => void,
) {
  const item = z.object({
    activityId: z.string().trim().min(1).max(240),
    specialty: z.enum(["leetcode", "system_design", "behavioral"]),
    questionId: z.string().trim().min(1).max(240),
    expectedPracticeRevision: z.number().int().positive(),
    expectedPracticeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    expectedSolutionRevision: z.number().int().nonnegative(),
    action: z.enum(["create_or_revise", "reuse_current"]),
    solutionProfile: profileSchema.optional(),
  });
  server.registerTool("publish_practice_solutions", {
    title: "Publish practice solutions",
    description: "Durably queue full reusable solutions for one or up to ten already-saved native or imported practices. Save new day-end attempts first with preview/apply_practice_backfill, then use their exact record revision/fingerprint and current Solution revision (0 if absent). Author the complete specialty-quality profile before enqueue; the Worker persists supplied content and does not research or write missing solutions. Use reuse_current when no revision is needed. Reuse exact batchId/items after uncertainty. Each item has an independent receipt; original practice history is never rewritten. Poll get_practice_solution_batch until each item is saved or failed; queued is not published.",
    inputSchema: { batchId: z.string().trim().min(1).max(200), items: z.array(item).min(1).max(10) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (batch) => {
    try {
      if (new Set(batch.items.map(item => item.activityId)).size !== batch.items.length) throw new Error("Each activity may appear only once in a solution batch.");
      if (new TextEncoder().encode(JSON.stringify(batch)).byteLength > 1_000_000) throw new Error("Solution batch exceeds 1 MB; split it into smaller stable batches.");
      await enqueueSpecialistWriteJob(ownerId, {
        jobId: await solutionBatchJobId(batch.batchId), operation: "practice_solution_batch", payload: batch,
      });
      scheduleProcessing();
      const result = await readSolutionBatch(ownerId, batch.batchId);
      return { structuredContent: result, content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Solution batch could not be queued." }] };
    }
  });
  server.registerTool("get_practice_solution_batch", {
    description: "Read one owner's durable solution-publication batch and every per-item receipt. A saved batch manifest alone is not completion; inspect aggregate status and each child's saved/failed/pending result. Retry only failed items with corrected payloads, fresh expected revisions and a new batch ID; preserve successful receipts.",
    inputSchema: { batchId: z.string().trim().min(1).max(200) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ batchId }) => {
    try {
      const result = await readSolutionBatch(ownerId, batchId);
      return { structuredContent: result, content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Solution batch could not be read." }] };
    }
  });
}
