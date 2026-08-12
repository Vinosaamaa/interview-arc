import { env } from "cloudflare:workers";

import { careerMaterialsCoverLetterResponseSchema } from "../../../cover-letter-contract";
import {
  fetchCoverLetters,
  resolveJobJourneyDownloadUrl,
} from "../../../../db/job-journey-client";
import { resolveOwnerId } from "../../../../db/owner";
import { getResumeLibrary } from "../../../../db/resume-revisions";
import { toRouteErrorMessage } from "../../route-helpers";

const NO_STORE = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const ownerId = await resolveOwnerId(request);
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    if ([...url.searchParams.keys()].some((key) => key !== "cursor")) {
      return Response.json({ error: "Only the cover-letter cursor is supported." }, {
        status: 400,
        headers: NO_STORE,
      });
    }

    let provider;
    try {
      provider = await fetchCoverLetters(env, ownerId, params);
    } catch {
      const unavailable = careerMaterialsCoverLetterResponseSchema.parse({
        schemaVersion: 1,
        status: "unavailable",
        stale: false,
        generatedAt: null,
        artifacts: null,
        page: null,
        message: "Cover-letter history is temporarily unavailable. The Resume Library remains authoritative and usable.",
      });
      return Response.json(unavailable, { headers: NO_STORE });
    }

    const library = await getResumeLibrary(ownerId).catch(() => null);
    const labels = new Map<string, { label: string; revisions: Set<string> }>();
    for (const source of library?.sources ?? []) {
      labels.set(source.resumeId, {
        label: source.sourceLabel,
        revisions: new Set(source.revisions.map((revision) => revision.revisionId)),
      });
    }
    const available = careerMaterialsCoverLetterResponseSchema.parse({
      schemaVersion: 1,
      status: "available",
      stale: provider.stale,
      generatedAt: provider.value.generatedAt,
      artifacts: provider.value.artifacts.map((artifact) => {
        const resume = labels.get(artifact.resumeId);
        return {
          ...artifact,
          resumeLabel: resume?.label ?? null,
          resumeRevisionKnown: resume?.revisions.has(artifact.resumeRevisionId) ?? false,
          downloadUrl: resolveJobJourneyDownloadUrl(env, artifact.downloadPath),
        };
      }),
      page: provider.value.page,
    });
    return Response.json(available, { headers: NO_STORE });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, {
      status: 500,
      headers: NO_STORE,
    });
  }
}
