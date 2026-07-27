import { normalizeCareerSummary, normalizeJobPage, type CareerJobPage, type CareerSummary } from "../app/career-work";

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
): Promise<CachedJobJourneyValue<T>> {
  const baseUrl = env.JOB_JOURNEY_BASE_URL?.replace(/\/$/, "");
  const token = env.JOB_JOURNEY_SITE_TOKEN;
  if (!baseUrl || !token) throw new Error("Job Journey integration is not configured.");
  const cacheKey = `${ownerId}:v1:${path}?${params.toString()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { value: cached.value as T, stale: false };
  try {
    const response = await fetch(`${baseUrl}${path}?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cf: { cacheTtl: 0 },
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
