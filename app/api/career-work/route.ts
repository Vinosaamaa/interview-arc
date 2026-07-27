import { env } from "cloudflare:workers";
import { JOB_STATUSES } from "../../career-work";
import { readCareerFocusMetrics } from "../../../db/career-work";
import { fetchCareerJobs, fetchCareerSummary } from "../../../db/job-journey-client";
import { resolveOwnerId } from "../../../db/owner";
import { toRouteErrorMessage } from "../route-helpers";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const rangeDays = from && to
      ? Math.floor((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1
      : 0;
    if (!from || !to || !DATE_KEY.test(from) || !DATE_KEY.test(to) || from > to || rangeDays > 730) {
      return Response.json({ error: "Valid inclusive `from` and `to` Pacific dates are required." }, { status: 400 });
    }
    const focus = await readCareerFocusMetrics(ownerId, from, to);
    const jobParams = new URLSearchParams({ from, to });
    for (const key of ["q", "status", "source", "referral", "cursor", "limit"]) {
      const value = url.searchParams.get(key);
      if (value) jobParams.set(key, value);
    }
    if ((jobParams.get("q")?.length ?? 0) > 300) {
      return Response.json({ error: "Career search is too long." }, { status: 400 });
    }
    const referral = jobParams.get("referral");
    if (referral && !["all", "only", "exclude"].includes(referral)) {
      return Response.json({ error: "Referral filter is invalid." }, { status: 400 });
    }
    const limit = Number(jobParams.get("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return Response.json({ error: "Career job limit must be between 1 and 100." }, { status: 400 });
    }
    const statuses = jobParams.get("status")?.split(",").filter(Boolean) ?? [];
    if (statuses.some((status) => !JOB_STATUSES.includes(status as (typeof JOB_STATUSES)[number]))) {
      return Response.json({ error: "One or more Job Journey statuses are invalid." }, { status: 400 });
    }
    try {
      const [summaryResult, jobsResult] = await Promise.all([
        fetchCareerSummary(env, ownerId, from, to),
        fetchCareerJobs(env, ownerId, jobParams),
      ]);
      return Response.json({
        focus,
        jobJourney: {
          status: "available",
          stale: summaryResult.stale || jobsResult.stale,
          summary: summaryResult.value,
          jobs: jobsResult.value,
        },
      }, { headers: { "cache-control": "private, no-store" } });
    } catch {
      return Response.json({
        focus,
        jobJourney: {
          status: "unavailable",
          stale: false,
          summary: null,
          jobs: null,
          message: "Application data is temporarily unavailable. Your Interview Arc focus time is still current.",
        },
      }, { headers: { "cache-control": "private, no-store" } });
    }
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
