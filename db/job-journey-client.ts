import { normalizeCareerSummary, normalizeJobPage, type CareerJobPage, type CareerSummary } from "../app/career-work.ts";
import {
  normalizeJobJourneyCoverLetterPage,
  type JobJourneyCoverLetterPage,
} from "../app/cover-letter-contract.ts";

type JobJourneyEnv = {
  JOB_JOURNEY_BASE_URL?: string;
  JOB_JOURNEY_SITE_TOKEN?: string;
};

const CACHE_TTL_MS = 5 * 60 * 1_000;
const cache = new Map<string, { expiresAt: number; value: unknown }>();
export type CachedJobJourneyValue<T> = { value: T; stale: boolean };

async function readJson<T>(
  env: JobJourneyEnv,
  ownerId: string,
  path: string,
  params: URLSearchParams,
  normalize: (value: unknown) => T,
  authorizationHeader: "authorization" | "OAI-Sites-Authorization" = "authorization",
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
    const value = normalize(await response.json());
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
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
  return readJson(
    env,
    ownerId,
    "/api/integrations/interview-arc/v1/cover-letters",
    params,
    normalizeJobJourneyCoverLetterPage,
    "OAI-Sites-Authorization",
  );
}

export function resolveJobJourneyDownloadUrl(
  env: JobJourneyEnv,
  downloadPath: string | null,
): string | null {
  if (!downloadPath) return null;
  const baseUrl = env.JOB_JOURNEY_BASE_URL?.replace(/\/$/, "");
  if (!baseUrl) throw new Error("Job Journey integration is not configured.");
  const base = new URL(baseUrl);
  if (base.protocol !== "https:") throw new Error("Job Journey must use HTTPS.");
  if (!/^\/api\/assets\/cover-letters\/[A-Za-z0-9%_-]+$/.test(downloadPath)) {
    throw new Error("Job Journey returned an invalid cover-letter link.");
  }
  return new URL(downloadPath, base).toString();
}
