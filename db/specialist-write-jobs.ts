import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { getDb } from "./index";
import { specialistWriteJobs, type SpecialistWriteJobRow } from "./schema";
import {
  deterministicSpecialistWriteRepairable,
  specialistWriteFailureTransition,
  specialistWritePayloadDigest,
} from "../mcp-worker/specialist-write-policy";

export type SpecialistWriteOperation =
  | "leetcode_code_attempt"
  | "personal_bank_question"
  | "behavioral_evidence_item"
  | "behavioral_claim_status"
  | "specialist_finalization";

export type SpecialistWriteStatus = SpecialistWriteJobRow["status"];

export class SpecialistWriteJobError extends Error {
  readonly code: string;
  readonly retryable = false;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SpecialistWriteJobError";
    this.code = code;
  }
}

export type SpecialistWriteReceipt = {
  jobId: string;
  operation: SpecialistWriteOperation;
  payloadHash: string;
  status: SpecialistWriteStatus;
  attemptCount: number;
  totalAttemptCount: number;
  nextAttemptAt: number | null;
  result: unknown;
  failure: null | { code: string; message: string; retryable: boolean };
  duplicate: boolean;
};

function receipt(row: SpecialistWriteJobRow, duplicate = false): SpecialistWriteReceipt {
  return {
    jobId: row.jobId,
    operation: row.operation,
    payloadHash: row.payloadHash,
    status: row.status,
    attemptCount: row.attemptCount,
    totalAttemptCount: row.totalAttemptCount,
    nextAttemptAt: row.status === "retry_wait" ? row.nextAttemptAt : null,
    result: row.result ?? null,
    failure: row.errorCode ? {
      code: row.errorCode,
      message: row.errorMessage ?? "The durable specialist write failed.",
      retryable: row.errorRetryable === true,
    } : null,
    duplicate,
  };
}

async function readOne(ownerId: string, jobId: string) {
  const rows = await getDb().select().from(specialistWriteJobs).where(and(
    eq(specialistWriteJobs.ownerId, ownerId),
    eq(specialistWriteJobs.jobId, jobId),
  ));
  return rows[0] ?? null;
}

export async function enqueueSpecialistWriteJob(
  ownerId: string,
  input: { jobId: string; operation: SpecialistWriteOperation; payload: unknown },
  nowMs = Date.now(),
) {
  const payloadHash = await specialistWritePayloadDigest(input.payload);
  const existing = await readOne(ownerId, input.jobId);
  if (existing) {
    if (existing.operation !== input.operation || existing.payloadHash !== payloadHash) {
      throw new SpecialistWriteJobError(
        "specialist_write_identity_conflict",
        "That specialist write operation ID was already reserved for different content.",
      );
    }
    return receipt(existing, true);
  }
  await getDb().insert(specialistWriteJobs).values({
    ownerId,
    jobId: input.jobId,
    operation: input.operation,
    payloadHash,
    payload: input.payload,
    status: "queued",
    attemptCount: 0,
    totalAttemptCount: 0,
    nextAttemptAt: nowMs,
    leaseExpiresAt: null,
    result: null,
    errorCode: null,
    errorMessage: null,
    errorRetryable: null,
    createdAt: nowMs,
    updatedAt: nowMs,
    completedAt: null,
  }).onConflictDoNothing();
  const reserved = await readOne(ownerId, input.jobId);
  if (!reserved) throw new Error("The durable specialist write receipt could not be reserved.");
  if (reserved.operation !== input.operation || reserved.payloadHash !== payloadHash) {
    throw new SpecialistWriteJobError(
      "specialist_write_identity_conflict",
      "That specialist write operation ID was concurrently reserved for different content.",
    );
  }
  return receipt(reserved, reserved.createdAt !== nowMs);
}

export async function readSpecialistWriteJobs(ownerId: string, jobIds: string[]) {
  if (!jobIds.length) return [];
  const rows = await getDb().select().from(specialistWriteJobs).where(and(
    eq(specialistWriteJobs.ownerId, ownerId),
    inArray(specialistWriteJobs.jobId, [...new Set(jobIds)]),
  ));
  const byId = new Map(rows.map((row) => [row.jobId, row]));
  return [...new Set(jobIds)].map((jobId) => {
    const row = byId.get(jobId);
    if (!row) {
      throw new SpecialistWriteJobError(
        "specialist_write_not_found",
        `No durable specialist write receipt exists for ${jobId}.`,
      );
    }
    return receipt(row);
  });
}

export async function retrySpecialistWriteJobs(
  ownerId: string,
  jobIds: string[],
  nowMs = Date.now(),
) {
  const jobs = await readSpecialistWriteJobs(ownerId, jobIds);
  for (const job of jobs) {
    if (job.status !== "failed"
        || (job.failure?.retryable !== true && !deterministicSpecialistWriteRepairable(job))) {
      throw new SpecialistWriteJobError(
        "specialist_write_not_retryable",
        `Specialist write ${job.jobId} is not a retryable or deterministic-repairable failed operation.`,
      );
    }
  }
  await getDb().update(specialistWriteJobs).set({
    status: "queued",
    attemptCount: 0,
    nextAttemptAt: nowMs,
    leaseExpiresAt: null,
    errorCode: null,
    errorMessage: null,
    errorRetryable: null,
    completedAt: null,
    updatedAt: nowMs,
  }).where(and(
    eq(specialistWriteJobs.ownerId, ownerId),
    inArray(specialistWriteJobs.jobId, jobIds),
  ));
  return readSpecialistWriteJobs(ownerId, jobIds);
}

async function claimSpecialistWriteJob(nowMs: number, leaseMs: number) {
  const noActiveLease = sql`not exists (
    select 1
    from specialist_write_jobs as active_specialist_write
    where active_specialist_write.status = 'processing'
      and active_specialist_write.lease_expires_at > ${nowMs}
  )`;
  const candidates = await getDb().select({
    ownerId: specialistWriteJobs.ownerId,
    jobId: specialistWriteJobs.jobId,
  }).from(specialistWriteJobs).where(and(
    or(
      and(
        inArray(specialistWriteJobs.status, ["queued", "retry_wait"]),
        lte(specialistWriteJobs.nextAttemptAt, nowMs),
      ),
      and(
        eq(specialistWriteJobs.status, "processing"),
        lte(specialistWriteJobs.leaseExpiresAt, nowMs),
      ),
    ),
    noActiveLease,
  )).orderBy(asc(specialistWriteJobs.nextAttemptAt)).limit(1);
  const candidate = candidates[0];
  if (!candidate) return null;
  const claimed = await getDb().update(specialistWriteJobs).set({
    status: "processing",
    attemptCount: sql`${specialistWriteJobs.attemptCount} + 1`,
    totalAttemptCount: sql`${specialistWriteJobs.totalAttemptCount} + 1`,
    leaseExpiresAt: nowMs + leaseMs,
    updatedAt: nowMs,
  }).where(and(
    eq(specialistWriteJobs.ownerId, candidate.ownerId),
    eq(specialistWriteJobs.jobId, candidate.jobId),
    or(
      and(
        inArray(specialistWriteJobs.status, ["queued", "retry_wait"]),
        lte(specialistWriteJobs.nextAttemptAt, nowMs),
      ),
      and(
        eq(specialistWriteJobs.status, "processing"),
        lte(specialistWriteJobs.leaseExpiresAt, nowMs),
      ),
    ),
    noActiveLease,
  )).returning();
  return claimed[0] ?? null;
}

function logTransition(row: SpecialistWriteJobRow, status: SpecialistWriteStatus, durationMs: number) {
  console.log(JSON.stringify({
    event: "specialist_write_transition",
    operation: row.operation,
    status,
    attemptCount: row.attemptCount,
    totalAttemptCount: row.totalAttemptCount,
    durationMs,
    payloadHashPrefix: row.payloadHash.slice(0, 12),
  }));
}

export async function processSpecialistWriteJobs(
  execute: (job: SpecialistWriteJobRow) => Promise<unknown>,
  options: { maxJobs?: number; leaseMs?: number; now?: () => number; random?: () => number } = {},
) {
  const maxJobs = Math.max(1, Math.min(25, options.maxJobs ?? 8));
  const leaseMs = Math.max(10_000, options.leaseMs ?? 120_000);
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const processed: SpecialistWriteReceipt[] = [];
  for (let index = 0; index < maxJobs; index += 1) {
    const claimedAt = now();
    const job = await claimSpecialistWriteJob(claimedAt, leaseMs);
    if (!job) break;
    const startedAt = now();
    try {
      const result = await execute(job);
      const completedAt = now();
      await getDb().update(specialistWriteJobs).set({
        status: "saved",
        nextAttemptAt: completedAt,
        leaseExpiresAt: null,
        result,
        errorCode: null,
        errorMessage: null,
        errorRetryable: null,
        completedAt,
        updatedAt: completedAt,
      }).where(and(
        eq(specialistWriteJobs.ownerId, job.ownerId),
        eq(specialistWriteJobs.jobId, job.jobId),
        eq(specialistWriteJobs.status, "processing"),
        eq(specialistWriteJobs.leaseExpiresAt, job.leaseExpiresAt!),
      ));
      const saved = await readOne(job.ownerId, job.jobId);
      if (saved) {
        logTransition(saved, saved.status, completedAt - startedAt);
        processed.push(receipt(saved));
      }
    } catch (error) {
      const failedAt = now();
      const transition = specialistWriteFailureTransition(
        job.attemptCount,
        error,
        failedAt,
        random,
      );
      const { failure, status } = transition;
      await getDb().update(specialistWriteJobs).set({
        status,
        nextAttemptAt: transition.nextAttemptAt ?? failedAt,
        leaseExpiresAt: null,
        result: null,
        errorCode: failure.code,
        errorMessage: failure.message,
        errorRetryable: failure.retryable,
        completedAt: status === "failed" ? failedAt : null,
        updatedAt: failedAt,
      }).where(and(
        eq(specialistWriteJobs.ownerId, job.ownerId),
        eq(specialistWriteJobs.jobId, job.jobId),
        eq(specialistWriteJobs.status, "processing"),
        eq(specialistWriteJobs.leaseExpiresAt, job.leaseExpiresAt!),
      ));
      const failed = await readOne(job.ownerId, job.jobId);
      if (failed) {
        logTransition(failed, failed.status, failedAt - startedAt);
        processed.push(receipt(failed));
      }
    }
  }
  return processed;
}
