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

const CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 100;
const cache = new Map<string, { expiresAt: number; value: unknown }>();
export type CachedJobJourneyValue<T> = { value: T; stale: boolean };

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
  if (!baseUrl || !token) throw new Error("Job Journey integration is not configured.");
  const cacheKey = `${ownerId}:v1:${path}?${params.toString()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { value: cached.value as T, stale: false };
  try {
    const response = await fetch(`${baseUrl}${path}?${params.toString()}`, {
      headers: { [authorizationHeader]: `Bearer ${token}`, accept: "application/json" },
      cf: { cacheTtl: 0 },
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Job Journey returned ${response.status}.`);
    let responseValue: unknown;
    if (maximumResponseBytes) {
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maximumResponseBytes) {
        throw new Error("Job Journey returned an oversized response.");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maximumResponseBytes) {
        throw new Error("Job Journey returned an oversized response.");
      }
      responseValue = JSON.parse(new TextDecoder().decode(bytes));
    } else {
      responseValue = await response.json();
    }
    const value = normalize(responseValue);
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
  if (!raw) throw new Error("Job Journey integration is not configured.");
  const base = new URL(raw);
  if (base.protocol !== "https:" || base.username || base.password) {
    throw new Error("Job Journey must use credential-free HTTPS.");
  }
  return base;
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
