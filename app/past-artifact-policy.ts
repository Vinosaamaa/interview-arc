import type { ContentArtifact } from "./content-types";

/** Past is an attempt timeline; canonical reference revisions are not attempts. */
export function isPastAttemptArtifact(artifact: Pick<ContentArtifact, "activityId">): boolean {
  return artifact.activityId.trim().length > 0;
}
