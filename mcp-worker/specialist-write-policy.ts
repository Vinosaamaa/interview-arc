export type SpecialistWriteFailure = {
  code: string;
  message: string;
  retryable: boolean;
};

const pendingCodeAttemptReviewTurnError = "A pending Code Attempt review cannot name a specialist review turn.";

export function deterministicSpecialistWriteRepairable(job: {
  operation: string;
  failure: SpecialistWriteFailure | null;
}) {
  return job.operation === "leetcode_code_attempt"
    && job.failure?.code === "specialist_write_rejected"
    && job.failure.message === pendingCodeAttemptReviewTurnError;
}

const SPECIALIST_WRITE_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 60_000, 300_000] as const;

export const SPECIALIST_WRITE_REQUEST_DRAIN_LIMIT = 1;
export const SPECIALIST_WRITE_SCHEDULED_DRAIN_LIMIT = 25;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export async function specialistWritePayloadDigest(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function specialistWriteRetryDelayMs(
  attempt: number,
  random: () => number = Math.random,
) {
  const base = SPECIALIST_WRITE_RETRY_DELAYS_MS[attempt - 1];
  if (base === undefined) return null;
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  return Math.round(base * jitter);
}

export type SpecialistWriteAttemptState<TPayload, TResult> = {
  status: "retry_wait" | "saved" | "failed";
  attemptCount: number;
  nextAttemptAt: number | null;
  payload: TPayload;
  result?: TResult;
  failure?: SpecialistWriteFailure;
};

export function specialistWriteFailureTransition(
  attemptCount: number,
  error: unknown,
  nowMs: number,
  random: () => number = Math.random,
) {
  const failure = classifySpecialistWriteFailure(error);
  const delay = failure.retryable
    ? specialistWriteRetryDelayMs(attemptCount, random)
    : null;
  return {
    status: (delay === null ? "failed" : "retry_wait") as "failed" | "retry_wait",
    nextAttemptAt: delay === null ? null : nowMs + delay,
    failure,
  };
}

export async function executeSpecialistWriteAttempt<TPayload, TResult>(
  job: { attemptCount: number; payload: TPayload },
  execute: (payload: TPayload) => Promise<TResult>,
  nowMs: number,
  random: () => number = Math.random,
): Promise<SpecialistWriteAttemptState<TPayload, TResult>> {
  const attemptCount = job.attemptCount + 1;
  try {
    return {
      status: "saved",
      attemptCount,
      nextAttemptAt: null,
      payload: job.payload,
      result: await execute(job.payload),
    };
  } catch (error) {
    const transition = specialistWriteFailureTransition(attemptCount, error, nowMs, random);
    return {
      status: transition.status,
      attemptCount,
      nextAttemptAt: transition.nextAttemptAt,
      payload: job.payload,
      failure: transition.failure,
    };
  }
}

function errorField(error: unknown, field: string) {
  if (!error || typeof error !== "object") return undefined;
  return (error as Record<string, unknown>)[field];
}

export function classifySpecialistWriteFailure(error: unknown): SpecialistWriteFailure {
  const status = Number(errorField(error, "status"));
  const rawCode = errorField(error, "code");
  const code = typeof rawCode === "string" || typeof rawCode === "number"
    ? String(rawCode)
    : "";
  const name = String(errorField(error, "name") ?? "").toLowerCase();
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = `${code} ${name} ${message}`.toLowerCase();

  if (errorField(error, "retryable") === true) {
    return { code: code || "specialist_write_retryable", message, retryable: true };
  }

  if ([502, 503, 504].includes(status)
      || code === "1102"
      || normalized.includes("exceededcpu")
      || normalized.includes("exceeded cpu")
      || normalized.includes("worker exceeded cpu time")
      || normalized.includes("timeout")
      || normalized.includes("timed out")
      || normalized.includes("connection reset")
      || normalized.includes("connection closed")
      || normalized.includes("network error")
      || normalized.includes("transport send error")) {
    return {
      code: code === "1102" || normalized.includes("cpu")
        ? "worker_resource_exhausted"
        : "specialist_write_transport_failure",
      message: "The durable write was interrupted by a retryable service failure.",
      retryable: true,
    };
  }

  return {
    code: code || "specialist_write_rejected",
    message: message || "The durable write was rejected.",
    retryable: false,
  };
}
