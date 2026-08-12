import { normalizeCareerSummary, normalizeJobPage, type CareerJobPage, type CareerSummary } from "../app/career-work.ts";
import {
  normalizeJobJourneyCoverLetterPage,
  privateCoverLetterDownloadPathSchema,
  type JobJourneyCoverLetterPage,
} from "../app/cover-letter-contract.ts";

type JobJourneyEnv = {
  JOB_JOURNEY_BASE_URL?: string;
  JOB_JOURNEY_SITE_TOKEN?: string;
};

export type JobJourneyReadFailure = {
  code:
    | "not_configured"
    | "invalid_provider_origin"
    | "provider_http_error"
    | "provider_response_too_large"
    | "provider_invalid_json"
    | "provider_contract_invalid"
    | "provider_network_error"
    | "provider_unknown_error";
  status?: number;
  detail?: string;
};

class JobJourneyReadError extends Error {
  readonly code: JobJourneyReadFailure["code"];
  readonly status?: number;
  readonly detail?: string;

  constructor(code: JobJourneyReadFailure["code"], status?: number, detail?: string) {
    super(code);
    this.name = "JobJourneyReadError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function redactedNetworkDetail(error: unknown, env: JobJourneyEnv): string {
  const name = error instanceof Error ? error.name : "NonError";
  let message = error instanceof Error ? error.message : typeof error;
  const privateValues = [env.JOB_JOURNEY_BASE_URL, env.JOB_JOURNEY_SITE_TOKEN];
  try {
    privateValues.push(env.JOB_JOURNEY_BASE_URL ? new URL(env.JOB_JOURNEY_BASE_URL).hostname : undefined);
  } catch {}
  for (const value of privateValues) {
    if (value) message = message.replaceAll(value, "<redacted>");
  }
  message = message
    .replace(/https?:\/\/[^\s"'<>]+/gi, "<url>")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<email>")
    .replace(/\/(?:Users|home|private|tmp|var)\/[^\s"'<>]+/g, "<path>")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "<opaque>")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 240);
  return `${name}: ${message || "no message"}`;
}

const CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 100;
const cache = new Map<string, { expiresAt: number; value: unknown }>();
export type CachedJobJourneyValue<T> = { value: T; stale: boolean };

async function readBoundedResponse(response: Response, maximumBytes: number) {
  const contentLength = response.headers.get("content-length");
  const declaredLength = contentLength === null ? null : Number(contentLength);
  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new JobJourneyReadError("provider_response_too_large");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new JobJourneyReadError("provider_response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readJson<T>(
  env: JobJourneyEnv,
  ownerId: string,
  path: string,
  params: URLSearchParams,
  normalize: (value: unknown) => T,
  authorizationHeader: "authorization" | "OAI-Sites-Authorization" = "authorization",
  maximumResponseBytes?: number,
): Promise<CachedJobJourneyValue<T>> {
  const baseUrl = env.JOB_JOURNEY_BASE_URL?.replace(/\/$/, "");
  const token = env.JOB_JOURNEY_SITE_TOKEN;
  if (!baseUrl || !token) throw new JobJourneyReadError("not_configured");
  const cacheKey = `${ownerId}:v1:${path}?${params.toString()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { value: cached.value as T, stale: false };
  try {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}?${params.toString()}`, {
        headers: { [authorizationHeader]: `Bearer ${token}`, accept: "application/json" },
        cf: { cacheTtl: 0 },
        redirect: "error",
      });
    } catch (error) {
      throw new JobJourneyReadError(
        "provider_network_error",
        undefined,
        redactedNetworkDetail(error, env),
      );
    }
    if (!response.ok) throw new JobJourneyReadError("provider_http_error", response.status);
    let responseValue: unknown;
    try {
      if (maximumResponseBytes) {
        const bytes = await readBoundedResponse(response, maximumResponseBytes);
        responseValue = JSON.parse(new TextDecoder().decode(bytes));
      } else {
        responseValue = await response.json();
      }
    } catch (error) {
      if (error instanceof JobJourneyReadError) throw error;
      throw new JobJourneyReadError("provider_invalid_json");
    }
    let value: T;
    try {
      value = normalize(responseValue);
    } catch {
      throw new JobJourneyReadError("provider_contract_invalid");
    }
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (key !== cacheKey && entry.expiresAt <= now) cache.delete(key);
    }
    cache.delete(cacheKey);
    cache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, value });
    while (cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (typeof oldestKey !== "string") break;
      cache.delete(oldestKey);
    }
    return { value, stale: false };
  } catch (error) {
    if (cached) return { value: cached.value as T, stale: true };
    throw error;
  }
}

export function fetchCareerSummary(
  env: JobJourneyEnv,
  ownerId: string,
  from: string,
  to: string,
): Promise<CachedJobJourneyValue<CareerSummary>> {
  return readJson(
    env,
    ownerId,
    "/api/integrations/interview-arc/v1/career-summary",
    new URLSearchParams({ from, to }),
    normalizeCareerSummary,
  );
}

export function fetchCareerJobs(
  env: JobJourneyEnv,
  ownerId: string,
  params: URLSearchParams,
): Promise<CachedJobJourneyValue<CareerJobPage>> {
  return readJson(
    env,
    ownerId,
    "/api/integrations/interview-arc/v1/jobs",
    params,
    normalizeJobPage,
  );
}

export function fetchCoverLetters(
  env: JobJourneyEnv,
  ownerId: string,
  params = new URLSearchParams({ limit: "100" }),
): Promise<CachedJobJourneyValue<JobJourneyCoverLetterPage>> {
  validateCoverLetterProviderBase(env);
  return readJson(
    env,
    ownerId,
    "/api/integrations/interview-arc/v1/cover-letters",
    params,
    normalizeJobJourneyCoverLetterPage,
    "OAI-Sites-Authorization",
    1024 * 1024,
  );
}

function validateCoverLetterProviderBase(env: JobJourneyEnv): URL {
  const raw = env.JOB_JOURNEY_BASE_URL;
  if (!raw) throw new JobJourneyReadError("not_configured");
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    throw new JobJourneyReadError("invalid_provider_origin");
  }
  if (
    base.protocol !== "https:"
    || base.username
    || base.password
    || base.pathname !== "/"
    || base.search
    || base.hash
  ) {
    throw new JobJourneyReadError("invalid_provider_origin");
  }
  return new URL(base.origin);
}

export function describeJobJourneyReadFailure(error: unknown): JobJourneyReadFailure {
  if (error instanceof JobJourneyReadError) {
    return {
      code: error.code,
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    };
  }
  return { code: "provider_unknown_error" };
}

export function resolveJobJourneyDownloadUrl(
  env: JobJourneyEnv,
  downloadPath: string | null,
): string | null {
  if (!downloadPath) return null;
  const baseUrl = env.JOB_JOURNEY_BASE_URL?.replace(/\/$/, "");
  if (!baseUrl) throw new Error("Job Journey integration is not configured.");
  const base = validateCoverLetterProviderBase({ ...env, JOB_JOURNEY_BASE_URL: baseUrl });
  if (!privateCoverLetterDownloadPathSchema.safeParse(downloadPath).success) {
    throw new Error("Job Journey returned an invalid cover-letter link.");
  }
  return new URL(downloadPath, base).toString();
}
