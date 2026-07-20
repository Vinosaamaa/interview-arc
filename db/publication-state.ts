import type { PublicationStatusValue } from "./live-state";

export function derivePublicationStatus({
  hasArtifact,
  storedPublication,
  completed,
}: {
  hasArtifact: boolean;
  storedPublication?: PublicationStatusValue;
  completed: boolean;
}): PublicationStatusValue {
  if (hasArtifact || storedPublication === "published") return "published";
  if (completed || storedPublication === "ready") return "ready";
  return "draft";
}
